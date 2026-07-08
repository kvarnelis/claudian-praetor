import { type ChildProcess, spawn } from 'child_process';
import { openSync } from 'fs';
import * as net from 'net';
import { Notice, Platform } from 'obsidian';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_CONFIG_PATH, loadConfig, openPairingWindow } from '../../daemon/src/config';
import type ClaudianPlugin from '../main';
import { DEFAULT_DAEMON_PORT } from '../remote/protocol';
import { findNodeExecutable, getEnhancedPath } from '../utils/env';

/**
 * Desktop-only auto-start for the Praetor daemon (the Claude-Anywhere model).
 *
 * When enabled on this specific machine, the desktop plugin spawns praetord
 * (bundled alongside the plugin) so mobile clients have something to reach.
 * The enablement flag is intentionally local-only; the generated URL is
 * published separately to plugin data.json so Obsidian Sync can carry it to iOS.
 * Pairing state stays on the host Mac.
 *
 * This module is dynamically imported only on desktop — it pulls Node APIs.
 */

const CGNAT_FIRST_OCTET = 100;
const CGNAT_SECOND_MIN = 64;
const CGNAT_SECOND_MAX = 127;

export type DaemonStartResult =
  | {
      status: 'started' | 'already-running';
      url: string;
      host: string;
      port: number;
      configPath: string;
    }
  | {
      status: 'no-tailnet' | 'missing-vault' | 'error';
      message: string;
      configPath?: string;
    };

export type DaemonPairingResult =
  | {
      status: 'pairing-open';
      url: string;
      host: string;
      port: number;
      configPath: string;
      expiresAt: number;
    }
  | {
      status: 'no-tailnet' | 'missing-vault' | 'error';
      message: string;
      configPath?: string;
    };

/** This machine's Tailscale IP (CGNAT 100.64.0.0/10), or null if not on a tailnet. */
export function findTailnetIp(): string | null {
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class DaemonSupervisor {
  private child: ChildProcess | null = null;
  private disposed = false;

  constructor(private readonly plugin: ClaudianPlugin) {}

  /**
   * Spawn the daemon if it isn't already running. Safe to call repeatedly.
   *
   * Startup from plugin load retries briefly because Tailscale can connect a few
   * seconds after Obsidian opens. Manual settings toggles pass `retry: false` so
   * the UI can report missing Tailscale immediately.
   */
  async start(options: { retry?: boolean } = {}): Promise<DaemonStartResult> {
    if (!Platform.isDesktopApp) {
      return { status: 'error', message: 'The Praetor daemon can only run in the desktop app.' };
    }

    const attempts = options.retry === false ? 1 : 6;
    for (let attempt = 0; attempt < attempts && !this.disposed; attempt++) {
      try {
        const host = findTailnetIp();
        if (host) {
          return await this.spawnOnHost(host);
        }
      } catch (error) {
        return {
          status: 'error',
          message: `Failed to launch the Praetor daemon: ${errorMessage(error)}`,
          configPath: DEFAULT_CONFIG_PATH,
        };
      }
      if (attempt < attempts - 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 5000));
      }
    }

    return {
      status: 'no-tailnet',
      message: 'Tailscale is not connected on this Mac. Turn on Tailscale before hosting the mobile daemon.',
      configPath: DEFAULT_CONFIG_PATH,
    };
  }

  private async spawnOnHost(host: string): Promise<DaemonStartResult> {
    const port = DEFAULT_DAEMON_PORT;
    const vaultPath = this.vaultPath();
    if (!vaultPath) {
      return { status: 'missing-vault', message: 'Could not determine this Obsidian vault path.' };
    }

    const { config, configPath } = loadConfig({
      vault: vaultPath,
      host,
      port,
      printConfig: false,
    });
    const url = `ws://${config.host}:${config.port}`;
    await this.plugin.saveRemoteDaemonConfig({ url });

    if (await isPortListening(config.host, config.port)) {
      return {
        status: 'already-running',
        url,
        host: config.host,
        port: config.port,
        configPath,
      };
    }

    const node = findNodeExecutable() ?? 'node';
    const scriptPath = this.daemonScriptPath();
    const logFd = this.openLogFile();

    const child = spawn(
      node,
      [scriptPath, '--vault', vaultPath, '--host', config.host, '--port', String(config.port)],
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

    return {
      status: 'started',
      url,
      host: config.host,
      port: config.port,
      configPath,
    };
  }

  async openPairing(): Promise<DaemonPairingResult> {
    if (!Platform.isDesktopApp) {
      return { status: 'error', message: 'Pairing is only available in the desktop app.' };
    }

    const host = findTailnetIp();
    if (!host) {
      return {
        status: 'no-tailnet',
        message: 'Tailscale is not connected on this Mac. Turn on Tailscale before pairing a mobile device.',
        configPath: DEFAULT_CONFIG_PATH,
      };
    }

    const vaultPath = this.vaultPath();
    if (!vaultPath) {
      return { status: 'missing-vault', message: 'Could not determine this Obsidian vault path.' };
    }

    try {
      const { config, configPath } = loadConfig({
        vault: vaultPath,
        host,
        port: DEFAULT_DAEMON_PORT,
        printConfig: false,
      });
      const { expiresAt } = openPairingWindow(configPath);
      const url = `ws://${config.host}:${config.port}`;
      await this.plugin.saveRemoteDaemonConfig({ url });
      return {
        status: 'pairing-open',
        url,
        host: config.host,
        port: config.port,
        configPath,
        expiresAt,
      };
    } catch (error) {
      return {
        status: 'error',
        message: `Failed to open pairing: ${errorMessage(error)}`,
        configPath: DEFAULT_CONFIG_PATH,
      };
    }
  }

  /** Stop the daemon we spawned (only used if the user disables local hosting). */
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
