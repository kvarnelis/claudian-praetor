import type { Plugin } from 'obsidian';

import { SharedStorageService } from '@/app/storage/SharedStorageService';

describe('SharedStorageService plugin data mutations', () => {
  it('serializes tab-state and remote-daemon writes without losing either field', async () => {
    let persisted: Record<string, unknown> = {};
    const plugin = {
      app: { vault: { adapter: {} } },
      loadData: jest.fn(() => Promise.resolve({ ...persisted })),
      saveData: jest.fn(async (data: Record<string, unknown>) => {
        persisted = { ...data };
      }),
    } as unknown as Plugin;
    const storage = new SharedStorageService(plugin);
    const tabManagerState = {
      openTabs: [{ tabId: 'tab-1', conversationId: 'conversation-1' }],
      activeTabId: 'tab-1',
    };

    await Promise.all([
      storage.setTabManagerState(tabManagerState),
      storage.setRemoteDaemonConfig({ url: 'ws://100.64.1.2:8423' }),
    ]);

    expect(persisted).toEqual({
      tabManagerState,
      remoteDaemon: { url: 'ws://100.64.1.2:8423' },
    });
  });
});
