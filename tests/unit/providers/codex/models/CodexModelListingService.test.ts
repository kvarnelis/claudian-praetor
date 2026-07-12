import { CodexModelListingService } from '@/providers/codex/models/CodexModelListingService';
import type { CodexAppServerModel } from '@/providers/codex/runtime/codexAppServerTypes';

const mockTransportRequest = jest.fn();
const mockTransportDispose = jest.fn();
const mockTransportStart = jest.fn();
const mockProcessStart = jest.fn();
const mockProcessShutdown = jest.fn().mockResolvedValue(undefined);
const mockResolveLaunchSpec = jest.fn();

jest.mock('@/providers/codex/runtime/CodexRpcTransport', () => ({
  CodexRpcTransport: jest.fn().mockImplementation(() => ({
    request: mockTransportRequest,
    dispose: mockTransportDispose,
    start: mockTransportStart,
    notify: jest.fn(),
  })),
}));

jest.mock('@/providers/codex/runtime/CodexAppServerProcess', () => ({
  CodexAppServerProcess: jest.fn().mockImplementation(() => ({
    start: mockProcessStart,
    shutdown: mockProcessShutdown,
  })),
}));

jest.mock('@/providers/codex/runtime/codexAppServerSupport', () => ({
  initializeCodexAppServerTransport: jest.fn().mockResolvedValue({
    userAgent: 'test/0.1',
    codexHome: '/home/user/.codex',
    platformFamily: 'unix',
    platformOs: 'linux',
  }),
  resolveCodexAppServerLaunchSpec: (...args: unknown[]) => mockResolveLaunchSpec(...args),
}));

function makeModel(model: string): CodexAppServerModel {
  return {
    id: model,
    model,
    displayName: model,
    description: `${model} description`,
    hidden: false,
    isDefault: false,
    defaultReasoningEffort: 'medium',
    supportedReasoningEfforts: [],
  };
}

describe('CodexModelListingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResolveLaunchSpec.mockReturnValue({
      target: { method: 'local', platformFamily: 'unix', platformOs: 'linux' },
      targetCwd: '/repo',
      pathMapper: { toHostPath: jest.fn((value: string) => value) },
    });
  });

  function createService(ttlMs = 5_000) {
    let currentTime = 1_000;
    const service = new CodexModelListingService({} as any, {
      ttlMs,
      now: () => currentTime,
    });
    const fetchModels = jest.fn<Promise<CodexAppServerModel[]>, []>();
    jest.spyOn(service as any, 'fetchModels').mockImplementation(fetchModels);

    return {
      service,
      fetchModels,
      setNow(value: number) {
        currentTime = value;
      },
    };
  }

  it('paginates model/list and disposes the ephemeral process', async () => {
    const alpha = makeModel('gpt-alpha');
    const beta = makeModel('gpt-beta');
    mockTransportRequest
      .mockResolvedValueOnce({ data: [alpha], nextCursor: 'page-2' })
      .mockResolvedValueOnce({ data: [beta], nextCursor: null });

    const service = new CodexModelListingService({} as any, { ttlMs: 0 });

    await expect(service.listModels()).resolves.toEqual([alpha, beta]);
    expect(mockTransportRequest).toHaveBeenNthCalledWith(1, 'model/list', {
      includeHidden: false,
    });
    expect(mockTransportRequest).toHaveBeenNthCalledWith(2, 'model/list', {
      includeHidden: false,
      cursor: 'page-2',
    });
    expect(mockTransportDispose).toHaveBeenCalledTimes(1);
    expect(mockProcessShutdown).toHaveBeenCalledTimes(1);
  });

  it('returns cached results until the TTL expires', async () => {
    const { service, fetchModels, setNow } = createService();
    const alpha = [makeModel('gpt-alpha')];
    const beta = [makeModel('gpt-beta')];
    fetchModels.mockResolvedValueOnce(alpha).mockResolvedValueOnce(beta);

    await expect(service.listModels()).resolves.toEqual(alpha);
    await expect(service.listModels()).resolves.toEqual(alpha);
    setNow(6_000);
    await expect(service.listModels()).resolves.toEqual(beta);

    expect(fetchModels).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent requests', async () => {
    const { service, fetchModels } = createService();
    const models = [makeModel('gpt-alpha')];
    let resolveFetch!: (value: CodexAppServerModel[]) => void;
    fetchModels.mockReturnValue(new Promise(resolve => { resolveFetch = resolve; }));

    const first = service.listModels();
    const second = service.listModels();
    resolveFetch(models);

    await expect(Promise.all([first, second])).resolves.toEqual([models, models]);
    expect(fetchModels).toHaveBeenCalledTimes(1);
  });

  it('forceReload bypasses and replaces the cache, while invalidate clears it', async () => {
    const { service, fetchModels } = createService();
    const alpha = [makeModel('gpt-alpha')];
    const beta = [makeModel('gpt-beta')];
    const gamma = [makeModel('gpt-gamma')];
    fetchModels.mockResolvedValueOnce(alpha).mockResolvedValueOnce(beta).mockResolvedValueOnce(gamma);

    await expect(service.listModels()).resolves.toEqual(alpha);
    await expect(service.listModels({ forceReload: true })).resolves.toEqual(beta);
    service.invalidate();
    await expect(service.listModels()).resolves.toEqual(gamma);

    expect(fetchModels).toHaveBeenCalledTimes(3);
  });
});
