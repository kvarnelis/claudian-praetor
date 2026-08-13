import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { authorizeClient, loadConfig, openPairingWindow } from '../../../daemon/src/config';

describe('daemon config pairing', () => {
  let tempRoot: string;
  let vaultPath: string;
  let configPath: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(path.join(os.tmpdir(), 'pocket-codex-daemon-'));
    vaultPath = path.join(tempRoot, 'vault');
    configPath = path.join(tempRoot, 'daemon.json');
    mkdirSync(vaultPath);
  });

  afterEach(() => {
    rmSync(tempRoot, { recursive: true, force: true });
  });

  function readConfig(): Record<string, unknown> {
    return JSON.parse(readFileSync(configPath, 'utf-8')) as Record<string, unknown>;
  }

  function writeConfig(value: Record<string, unknown>): void {
    writeFileSync(configPath, `${JSON.stringify(value, null, 2)}\n`);
  }

  it('strips legacy synced tokens when loading config', () => {
    writeConfig({
      host: '100.64.1.2',
      port: 8423,
      vaultPath,
      token: 'legacy-token',
      pairedClients: [],
    });

    const result = loadConfig({
      config: configPath,
      vault: vaultPath,
      host: '100.64.1.2',
      port: 8423,
      printConfig: false,
    });

    expect(result.config).not.toHaveProperty('token');
    expect(readConfig()).not.toHaveProperty('token');
  });

  it('rejects an unpaired Tailscale client before pairing is opened', () => {
    loadConfig({
      config: configPath,
      vault: vaultPath,
      host: '100.64.1.2',
      port: 8423,
      printConfig: false,
    });

    expect(authorizeClient(configPath, {
      clientId: 'phone-1',
      remoteAddress: '100.64.1.20',
    })).toEqual({
      ok: false,
      reason: "device not paired; open pairing in Pocket Codex settings on your Mac",
    });
  });

  it('pairs a Tailscale client during an open pairing window', () => {
    loadConfig({
      config: configPath,
      vault: vaultPath,
      host: '100.64.1.2',
      port: 8423,
      printConfig: false,
    });
    openPairingWindow(configPath, 60_000);

    expect(authorizeClient(configPath, {
      clientId: 'phone-1',
      clientInfo: 'Kazys iPhone',
      remoteAddress: '100.64.1.20',
    })).toEqual({ ok: true, paired: true });

    const pairedConfig = readConfig();
    expect(pairedConfig.pairedClients).toEqual([
      expect.objectContaining({
        clientId: 'phone-1',
        address: '100.64.1.20',
        name: 'Kazys iPhone',
      }),
    ]);

    delete pairedConfig.pairingExpiresAt;
    writeConfig(pairedConfig);

    expect(authorizeClient(configPath, {
      clientId: 'phone-1',
      remoteAddress: '100.64.1.20',
    })).toEqual({ ok: true });
  });

  it('rejects non-Tailscale addresses even while pairing is open', () => {
    loadConfig({
      config: configPath,
      vault: vaultPath,
      host: '100.64.1.2',
      port: 8423,
      printConfig: false,
    });
    openPairingWindow(configPath, 60_000);

    expect(authorizeClient(configPath, {
      clientId: 'phone-1',
      remoteAddress: '192.168.1.25',
    })).toEqual({
      ok: false,
      reason: 'connection must come through Tailscale',
    });
  });
});
