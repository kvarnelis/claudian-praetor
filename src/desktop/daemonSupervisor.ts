import { type ChildProcess, spawn } from 'child_process';
import { openSync } from 'fs';
import * as net from 'net';
import { Notice, Platform } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import type ClaudianPlugin from '../main';
import { DEFAULT_DAEMON_PORT } from '../remote/protocol';
import { findNodeExecutable, getEnhancedPath } from '../utils/env';

/**
 * Desktop-only auto-start for the Praetor daemon (the Claude-Anywhere model).
 *
 * When enabled, the desktop plugin spawns praetord (bundled alongside the
 * plugin) on load so the iPad always has something to reach — without a
 * separate process tied to anything fragile. The daemon is detached so it
 * survives an Obsidian reload/close; a port probe prevents double-spawning, so
 * relaunching Obsidian just reuses an already-running daemon. Everything is
 * guarded: a failure here must never break desktop plugin load.
 *
 * This module is dynamically imported only on desktop — it pulls Node APIs.
 */

const CGNAT_FIRST_OCTET = 100;
const CGNAT_SECOND_MIN = 64;
const CGNAT_SECOND_MAX = 127;

/** This machine's Tailscale IP (CGNAT 100.64.0.0/10), or null if not on a tailnet. */
function findTailnetIp(): string | null {
  const interfaces = os.networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const addr of addresses ?? []) {
      if (addr.family !== 'IPv4' || addr.internal) continue;
      const octets = addr.address.split('.').map(Number);
      if (
        octets[0] === CGNAT_FIRST_OCTET
        && octets[1] >= CGNAT_SECOND_MIN
        && octets[1] <= CGNAT_SECOND_MAX
      ) {
        return addr.address;
      }
    }
  }
  return null;
}

/** Whether something is already accepting connections on host:port. */
function isPortListening(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (listening: boolean): void => {
      socket.destroy();
      resolve(listening);
    };
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.setTimeout(1500, () => finish(false));
  });
}

export class DaemonSupervisor {
  private child: ChildProcess | null = null;
  private disposed = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  /**
   * Spawn the daemon if it isn't already running. Safe to call repeatedly.
   *
   * Tailscale usually connects a few seconds after Obsidian launches, so retry
   * briefly, then give up SILENTLY. Auto-start is opt-in and best-effort — no
   * tailnet is an expected, fine state (Tailscale off, or this just isn't the
   * host machine), not an error worth interrupting the user about.
   */
  async start(): Promise<void> {
    if (!Platform.isDesktopApp) return;

    for (let attempt = 0; attempt < 6 && !this.disposed; attempt++) {
      try {
        const host = findTailnetIp();
        if (host) {
          await this.spawnOnHost(host);
          return;
        }
      } catch {
        return; // best-effort; never break plugin load
      }
      await new Promise<void>((resolve) => window.setTimeout(resolve, 5000));
    }
  }

  private async spawnOnHost(host: string): Promise<void> {
    const port = DEFAULT_DAEMON_PORT;
    if (await isPortListening(host, port)) {
      return; // already running (this session, a prior run, or launchd)
    }

    const vaultPath = this.vaultPath();
    if (!vaultPath) return;

    const node = findNodeExecutable() ?? 'node';
    const scriptPath = this.daemonScriptPath();
    const logFd = this.openLogFile();

    const child = spawn(
      node,
      [scriptPath, '--vault', vaultPath, '--host', host, '--port', String(port)],
      {
        env: { ...process.env, PATH: getEnhancedPath() },
        detached: true,
        stdio: logFd !== null ? ['ignore', logFd, logFd] : 'ignore',
        windowsHide: true,
      },
    );
    child.on('error', () => {
      new Notice('Claudian Praetor: failed to launch the daemon — check the daemon log.', 8000);
    });
    child.unref();
    this.child = child;
  }

  /** Stop the daemon we spawned (only used if the user disables auto-start). */
  stop(): void {
    this.disposed = true;
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    this.child = null;
  }

  private vaultPath(): string | null {
    const basePath = (this.plugin.app.vault.adapter as { basePath?: string }).basePath;
    return typeof basePath === 'string' && basePath ? basePath : null;
  }

  private daemonScriptPath(): string {
    const basePath = this.vaultPath() ?? '';
    const configDir = this.plugin.app.vault.configDir;
    return path.join(basePath, configDir, 'plugins', this.plugin.manifest.id, 'praetord.cjs');
  }

  private openLogFile(): number | null {
    try {
      return openSync(path.join(os.homedir(), '.config', 'claudian-praetor', 'praetord.log'), 'a');
    } catch {
      return null;
    }
  }
}
