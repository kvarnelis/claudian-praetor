import { execFile } from 'child_process';

import type { ProviderUIOption } from '@/core/providers/types';
import { GrokModelListingService } from '@/providers/grok/models/GrokModelListingService';

jest.mock('child_process', () => ({
  execFile: jest.fn(),
}));

// The service resolves the CLI path via its own GrokCliResolver (not the
// workspace-services registry, which isn't populated yet during provider init).
let mockResolvedGrokPath: string | null = '/usr/local/bin/grok';
jest.mock('@/providers/grok/runtime/GrokCliResolver', () => ({
  GrokCliResolver: jest.fn().mockImplementation(() => ({
    resolveFromSettings: jest.fn(() => mockResolvedGrokPath),
  })),
}));

const mockExecFile = execFile as jest.MockedFunction<typeof execFile>;

function createPlugin(resolvedPath: string | null = '/usr/local/bin/grok') {
  mockResolvedGrokPath = resolvedPath;
  return {
    app: {
      vault: {
        adapter: {
          basePath: '/tmp/vault',
        },
      },
    },
    settings: {
      providerConfigs: {
        grok: {
          environmentVariables: 'GROK_TEST=enabled',
        },
      },
    },
  } as any;
}

describe('GrokModelListingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolvedGrokPath = '/usr/local/bin/grok';
  });

  function createService(ttlMs = 5_000) {
    let currentTime = 1_000;
    const service = new GrokModelListingService(createPlugin(), {
      ttlMs,
      now: () => currentTime,
    });
    const fetchModels = jest.fn<Promise<ProviderUIOption[]>, []>();
    jest.spyOn(service as any, 'fetchModels').mockImplementation(fetchModels);

    return {
      service,
      fetchModels,
      setNow(value: number) {
        currentTime = value;
      },
    };
  }

  it('runs grok models and parses authenticated ANSI-colored output', async () => {
    mockExecFile.mockImplementation((_file: any, _args: any, _options: any, callback: any) => {
      callback(null, {
        stdout: [
          '\u001B[32mYou are logged in with grok.com.\u001B[0m',
          '',
          'Default model: grok-4.5',
          '',
          '\u001B[1mAvailable models:\u001B[0m',
          '  * \u001B[36mgrok-4.5\u001B[0m (default)',
          '  - grok-composer-2.5-fast',
        ].join('\n'),
        stderr: '',
      });
      return undefined as any;
    });

    const models = await new GrokModelListingService(createPlugin()).listModels();

    expect(models).toEqual([
      { value: 'grok-4.5', label: 'grok-4.5', description: 'Default' },
      { value: 'grok-composer-2.5-fast', label: 'grok-composer-2.5-fast', description: '' },
    ]);
    expect(mockExecFile).toHaveBeenCalledWith(
      '/usr/local/bin/grok',
      ['models'],
      expect.objectContaining({
        cwd: '/tmp/vault',
        env: expect.objectContaining({ GROK_TEST: 'enabled' }),
        encoding: 'utf8',
        timeout: 10_000,
      }),
      expect.any(Function),
    );
  });

  it('returns cached results until the TTL expires', async () => {
    const { service, fetchModels, setNow } = createService();
    const alpha = [{ value: 'grok-alpha', label: 'grok-alpha', description: '' }];
    const beta = [{ value: 'grok-beta', label: 'grok-beta', description: '' }];
    fetchModels.mockResolvedValueOnce(alpha).mockResolvedValueOnce(beta);

    await expect(service.listModels()).resolves.toEqual(alpha);
    await expect(service.listModels()).resolves.toEqual(alpha);
    setNow(6_000);
    await expect(service.listModels()).resolves.toEqual(beta);

    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests', async () => {
    const { service, fetchModels } = createService();
    const models = [{ value: 'grok-alpha', label: 'grok-alpha', description: '' }];
    let resolveFetch!: (value: ProviderUIOption[]) => void;
    fetchModels.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));

    const first = service.listModels();
    const second = service.listModels();
    resolveFetch(models);

    await expect(Promise.all([first, second])).resolves.toEqual([models, models]);
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it('forceReload replaces the cache and invalidate clears it', async () => {
    const { service, fetchModels } = createService();
    const alpha = [{ value: 'grok-alpha', label: 'grok-alpha', description: '' }];
    const beta = [{ value: 'grok-beta', label: 'grok-beta', description: '' }];
    const gamma = [{ value: 'grok-gamma', label: 'grok-gamma', description: '' }];
    fetchModels.mockResolvedValueOnce(alpha).mockResolvedValueOnce(beta).mockResolvedValueOnce(gamma);

    await expect(service.listModels()).resolves.toEqual(alpha);
    await expect(service.listModels({ forceReload: true })).resolves.toEqual(beta);
    service.invalidate();
    await expect(service.listModels()).resolves.toEqual(gamma);

    expect(fetchModels).toHaveBeenCalledTimes(3);
  });

  it('skips discovery when the Grok CLI is unresolved', async () => {
    await expect(new GrokModelListingService(createPlugin(null)).listModels()).resolves.toEqual([]);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
