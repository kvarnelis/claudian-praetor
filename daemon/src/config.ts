/**
 * Daemon configuration: a JSON file at ~/.config/claudian-praetor/daemon.json
 * (overridable with --config), seeded on first run with a random token.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { DEFAULT_DAEMON_PORT } from '../../src/remote/protocol';

export interface DaemonConfig {
  token: string;
  host: string;
  port: number;
  vaultPath: string;
}

export interface CliOptions {
  config?: string;
  vault?: string;
  host?: string;
  port?: number;
  printConfig: boolean;
}

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
        printUsage();
        process.exit(0);
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export function printUsage(): void {
  console.log(`praetord - Claudian Praetor daemon

Usage: node praetord.cjs [options]

Options:
  --vault <path>     Vault directory to serve (required on first run)
  --host <host>      Bind host (default 127.0.0.1)
  --port <port>      Bind port (default ${DEFAULT_DAEMON_PORT})
  --config <path>    Config file (default ${DEFAULT_CONFIG_PATH})
  --print-config     Print the active config (including token) and exit
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

/**
 * Loads the config, applying CLI overrides and persisting the merged result.
 * First run requires --vault and generates the auth token.
 */
export function loadConfig(options: CliOptions): { config: DaemonConfig; configPath: string; created: boolean } {
  const configPath = path.resolve(options.config ?? DEFAULT_CONFIG_PATH);
  const stored = readConfigFile(configPath);
  const created = stored === null;

  const vaultPath = options.vault ?? (typeof stored?.vaultPath === 'string' ? stored.vaultPath : undefined);
  if (!vaultPath) {
    throw new Error(`No vault configured. Run with --vault <path> (config: ${configPath})`);
  }
  const resolvedVault = path.resolve(vaultPath);
  if (!fs.existsSync(resolvedVault) || !fs.statSync(resolvedVault).isDirectory()) {
    throw new Error(`Vault path is not a directory: ${resolvedVault}`);
  }

  const config: DaemonConfig = {
    token: typeof stored?.token === 'string' && stored.token.length > 0
      ? stored.token
      : crypto.randomBytes(24).toString('hex'),
    host: options.host ?? (typeof stored?.host === 'string' ? stored.host : '127.0.0.1'),
    port: options.port ?? (typeof stored?.port === 'number' ? stored.port : DEFAULT_DAEMON_PORT),
    vaultPath: resolvedVault,
  };

  const changed = created
    || stored?.token !== config.token
    || stored?.host !== config.host
    || stored?.port !== config.port
    || stored?.vaultPath !== config.vaultPath;
  if (changed) {
    writeConfigFile(configPath, config);
  }

  return { config, configPath, created };
}
