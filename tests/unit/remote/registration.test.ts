import { PocketCodexSettingsStorage } from '@/app/settings/PocketCodexSettingsStorage';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import { registerRemoteProviders } from '@/remote/registration';

describe('remote provider registration settings storage', () => {
  const adapter = {
    exists: jest.fn(),
    read: jest.fn(),
    write: jest.fn(),
    delete: jest.fn(),
  } as unknown as jest.Mocked<VaultFileAdapter>;

  beforeAll(() => {
    registerRemoteProviders({} as never);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    adapter.exists.mockImplementation(async (path: string) => (
      path === '.claudian/pocket-codex-settings.json'
    ));
    adapter.read.mockResolvedValue(JSON.stringify({ userName: 'Mobile user' }));
    adapter.write.mockResolvedValue(undefined);
    adapter.delete.mockResolvedValue(undefined);
  });

  it('loads an existing settings file without requiring desktop normalization', async () => {
    const storage = new PocketCodexSettingsStorage(adapter);

    await expect(storage.load()).resolves.toMatchObject({ userName: 'Mobile user' });
  });

  it('persists settings without requiring desktop normalization', async () => {
    const storage = new PocketCodexSettingsStorage(adapter);
    const settings = await storage.load();

    await expect(storage.save({ ...settings, userName: 'Updated mobile user' })).resolves.toBeUndefined();

    expect(adapter.write).toHaveBeenCalledWith(
      '.claudian/pocket-codex-settings.json',
      expect.stringContaining('Updated mobile user'),
    );
  });
});
