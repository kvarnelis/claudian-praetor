/**
 * Daemon configuration: a JSON file at ~/.config/claudian-praetor/daemon.json
 * (overridable with --config). Authentication is local to the Mac: clients are
 * paired by Tailscale/loopback address and stable client id, never by a synced
 * bearer token.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_DAEMON_PORT } from '../../src/remote/protocol';

export interface PairedClient {
  clientId: string;
  address: string;
  name?: string;
  pairedAt: number;
  lastSeenAt: number;
}

export interface DaemonConfig {
  host: string;
  port: number;
  vaultPath: string;
  pairedClients: PairedClient[];
  pairingExpiresAt?: number;
}

export interface CliOptions {
  config?: string;
  vault?: string;
  host?: string;
  port?: number;
  printConfig: boolean;
  help?: boolean;
}

export interface ClientAuthorizationRequest {
  clientId: string;
  clientInfo?: string;
  remoteAddress?: string;
}

export interface ClientAuthorizationResult {
  ok: boolean;
  reason?: string;
  paired?: boolean;
}

const PAIRING_WINDOW_MS = 5 * 60 * 1000;
const CGNAT_FIRST_OCTET = 100;
const CGNAT_SECOND_MIN = 64;
const CGNAT_SECOND_MAX = 127;

export const DEFAULT_CONFIG_PATH = path.join(
  os.homedir(),
  '.config',
  'claudian-praetor',
  'daemon.json',
);

export function parseCliArgs(argv: string[]): CliOptions {
  const options: CliOptions = { printConfig: false };

  const readValue = (flag: string, index: number): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case '--config':
        options.config = readValue(arg, i);
        i++;
        break;
      case '--vault':
        options.vault = readValue(arg, i);
        i++;
        break;
      case '--host':
        options.host = readValue(arg, i);
        i++;
        break;
      case '--port': {
        const raw = readValue(arg, i);
        const port = Number.parseInt(raw, 10);
        if (!Number.isInteger(port) || port <= 0 || port > 65535) {
          throw new Error(`Invalid --port value: ${raw}`);
        }
        options.port = port;
        i++;
        break;
      }
      case '--print-config':
        options.printConfig = true;
        break;
      case '--help':
      case '-h':
        options.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function printUsage(): void {
  console.log(`praetord - Praetor daemon

Usage: node praetord.cjs [options]

Options:
  --vault <path>     Vault directory to serve (required on first run)
  --host <host>      Bind host (default 127.0.0.1)
  --port <port>      Bind port (default ${DEFAULT_DAEMON_PORT})
  --config <path>    Config file (default ${DEFAULT_CONFIG_PATH})
  --print-config     Print the active config and exit
  -h, --help         Show this help`);
}

function readConfigFile(configPath: string): Partial<DaemonConfig> | null {
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<DaemonConfig>;
  } catch {
    return null;
  }
}

function writeConfigFile(configPath: string, config: DaemonConfig): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
}

function normalizePairedClients(value: unknown): PairedClient[] {
  if (!Array.isArray(value)) return [];

  const clients: PairedClient[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    if (typeof record.clientId !== 'string' || !record.clientId) continue;
    if (typeof record.address !== 'string' || !record.address) continue;

    const pairedAt = typeof record.pairedAt === 'number' ? record.pairedAt : Date.now();
    const lastSeenAt = typeof record.lastSeenAt === 'number' ? record.lastSeenAt : pairedAt;
    clients.push({
      clientId: record.clientId,
      address: record.address,
      ...(typeof record.name === 'string' && record.name ? { name: record.name } : {}),
      pairedAt,
      lastSeenAt,
    });
  }
  return clients;
}

function normalizeRemoteAddress(address?: string): string | null {
  if (!address) return null;
  if (address.startsWith('::ffff:')) return address.slice('::ffff:'.length);
  if (address === '::1') return '127.0.0.1';
  return address;
}

function isLoopbackAddress(address: string): boolean {
  return address === '127.0.0.1' || address === 'localhost';
}

function isTailscaleAddress(address: string): boolean {
  const octets = address.split('.').map(Number);
  return octets.length === 4
    && octets.every(Number.isInteger)
    && octets[0] === CGNAT_FIRST_OCTET
    && octets[1] >= CGNAT_SECOND_MIN
    && octets[1] <= CGNAT_SECOND_MAX;
}

function isTrustedRemoteAddress(address: string): boolean {
  return isTailscaleAddress(address) || isLoopbackAddress(address);
}

function toDaemonConfig(stored: Partial<DaemonConfig>, options: CliOptions): DaemonConfig {
  const vaultPath = options.vault ?? (typeof stored?.vaultPath === 'string' ? stored.vaultPath : undefined);
  if (!vaultPath) {
    throw new Error(`No vault configured. Run with --vault <path>`);
  }
  const resolvedVault = path.resolve(vaultPath);
  if (!fs.existsSync(resolvedVault) || !fs.statSync(resolvedVault).isDirectory()) {
    throw new Error(`Vault path is not a directory: ${resolvedVault}`);
  }

  const pairingExpiresAt = typeof stored?.pairingExpiresAt === 'number'
    && stored.pairingExpiresAt > Date.now()
    ? stored.pairingExpiresAt
    : undefined;

  return {
    host: options.host ?? (typeof stored?.host === 'string' ? stored.host : '127.0.0.1'),
    port: options.port ?? (typeof stored?.port === 'number' ? stored.port : DEFAULT_DAEMON_PORT),
    vaultPath: resolvedVault,
    pairedClients: normalizePairedClients(stored?.pairedClients),
    ...(pairingExpiresAt ? { pairingExpiresAt } : {}),
  };
}

/**
 * Loads the config, applying CLI overrides and persisting the merged result.
 * First run requires --vault.
 */
export function loadConfig(options: CliOptions): { config: DaemonConfig; configPath: string; created: boolean } {
  const configPath = path.resolve(options.config ?? DEFAULT_CONFIG_PATH);
  const stored = readConfigFile(configPath);
  const created = stored === null;

  let config: DaemonConfig;
  try {
    config = toDaemonConfig(stored ?? {}, options);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('No vault configured.')) {
      throw new Error(`No vault configured. Run with --vault <path> (config: ${configPath})`);
    }
    throw error;
  }

  const changed = created
    || 'token' in (stored ?? {})
    || stored?.host !== config.host
    || stored?.port !== config.port
    || stored?.vaultPath !== config.vaultPath
    || JSON.stringify(normalizePairedClients(stored?.pairedClients)) !== JSON.stringify(config.pairedClients)
    || stored?.pairingExpiresAt !== config.pairingExpiresAt;
  if (changed) {
    writeConfigFile(configPath, config);
  }

  return { config, configPath, created };
}

export function openPairingWindow(configPath = DEFAULT_CONFIG_PATH, durationMs = PAIRING_WINDOW_MS): {
  config: DaemonConfig;
  expiresAt: number;
} {
  const stored = readConfigFile(configPath);
  if (!stored) {
    throw new Error(`No daemon config found at ${configPath}`);
  }

  const config = toDaemonConfig(stored, { printConfig: false, vault: stored.vaultPath });
  const expiresAt = Date.now() + durationMs;
  const next = {
    ...config,
    pairingExpiresAt: expiresAt,
  };
  writeConfigFile(configPath, next);
  return { config: next, expiresAt };
}

export function authorizeClient(configPath: string, request: ClientAuthorizationRequest): ClientAuthorizationResult {
  const stored = readConfigFile(configPath);
  if (!stored) return { ok: false, reason: 'daemon config not found' };

  const address = normalizeRemoteAddress(request.remoteAddress);
  if (!address || !isTrustedRemoteAddress(address)) {
    return { ok: false, reason: 'connection must come through Tailscale' };
  }
  if (!request.clientId) {
    return { ok: false, reason: 'missing client id' };
  }

  const config = toDaemonConfig(stored, { printConfig: false, vault: stored.vaultPath });
  const now = Date.now();
  const existing = config.pairedClients.find(client =>
    client.clientId === request.clientId && client.address === address
  );
  if (existing) {
    existing.lastSeenAt = now;
    writeConfigFile(configPath, config);
    return { ok: true };
  }

  if (config.pairingExpiresAt && config.pairingExpiresAt > now) {
    const nextClients = config.pairedClients.filter(client => client.clientId !== request.clientId);
    nextClients.push({
      clientId: request.clientId,
      address,
      ...(request.clientInfo ? { name: request.clientInfo.slice(0, 120) } : {}),
      pairedAt: now,
      lastSeenAt: now,
    });
    const next = {
      ...config,
      pairedClients: nextClients,
    };
    writeConfigFile(configPath, next);
    return { ok: true, paired: true };
  }

  return {
    ok: false,
    reason: 'device not paired; open pairing in Praetor settings on your Mac',
  };
}
