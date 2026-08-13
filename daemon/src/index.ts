/**
 * pocket-codexd entry point: boot the headless plugin against a vault, register
 * the real providers, and serve the wire protocol.
 */

import './globalsPolyfill';

import { ProviderWorkspaceRegistry } from '../../src/core/providers/ProviderWorkspaceRegistry';
import { registerBuiltInProviders } from '../../src/providers';
import { loadConfig, parseCliArgs, printUsage } from './config';
import { createHeadlessPlugin } from './headlessPlugin';
import { createNodeVaultApp } from './nodeVaultApp';
import { PocketCodexServer } from './server';

const log = (message: string): void => {
  console.error(`${new Date().toISOString()} ${message}`);
};

async function main(): Promise<void> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const { config, configPath, created } = loadConfig(options);
  if (created) {
    log(`[pocket-codexd] created config at ${configPath}`);
  }
  if (options.printConfig) {
    console.log(JSON.stringify({ ...config, configPath }, null, 2));
    return;
  }

  log(`[pocket-codexd] vault: ${config.vaultPath}`);
  const app = createNodeVaultApp(config.vaultPath);
  const handle = await createHeadlessPlugin({ app, vaultPath: config.vaultPath, log });

  registerBuiltInProviders();
  await ProviderWorkspaceRegistry.initializeAll(handle.plugin);
  log('[pocket-codexd] providers initialized');

  const server = new PocketCodexServer({
    plugin: handle.plugin,
    settings: handle.settings,
    vaultPath: config.vaultPath,
    host: config.host,
    port: config.port,
    configPath,
    log,
  });
  await server.start();
  log(`[pocket-codexd] connect clients to ws://${config.host}:${config.port} (pair devices from Pocket Codex settings)`);

  const shutdown = (): void => {
    log('[pocket-codexd] shutting down');
    handle.dispose();
    void server.stop().then(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err: unknown) => {
  console.error('[pocket-codexd] fatal:', err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
