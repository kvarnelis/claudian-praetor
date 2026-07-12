import { createCodexWorkspaceServices } from '@/providers/codex/app/CodexWorkspaceServices';

const mockListModels = jest.fn();
const mockSetCodexModelCatalog = jest.fn();
const mockLoadAgents = jest.fn().mockResolvedValue(undefined);

jest.mock('@/providers/codex/models/CodexModelListingService', () => ({
  CodexModelListingService: jest.fn().mockImplementation(() => ({
    listModels: mockListModels,
    invalidate: jest.fn(),
  })),
}));

jest.mock('@/providers/codex/codexModelCatalog', () => ({
  setCodexModelCatalog: (...args: unknown[]) => mockSetCodexModelCatalog(...args),
}));

jest.mock('@/providers/codex/agents/CodexAgentMentionProvider', () => ({
  CodexAgentMentionProvider: jest.fn().mockImplementation(() => ({
    loadAgents: mockLoadAgents,
  })),
}));

describe('createCodexWorkspaceServices model catalog initialization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListModels.mockResolvedValue([]);
  });

  it('eagerly populates the catalog when Codex is enabled', async () => {
    const visible = { model: 'gpt-visible', hidden: false };
    const hidden = { model: 'gpt-hidden', hidden: true };
    mockListModels.mockResolvedValue([visible, hidden]);

    await createCodexWorkspaceServices({
      settings: { providerConfigs: { codex: { enabled: true } } },
      app: { vault: { adapter: {} } },
    } as any, {} as any, {} as any);
    await Promise.resolve();

    expect(mockListModels).toHaveBeenCalledTimes(1);
    expect(mockSetCodexModelCatalog).toHaveBeenCalledWith([visible]);
  });

  it('does not fetch models when Codex is disabled', async () => {
    await createCodexWorkspaceServices({
      settings: { providerConfigs: { codex: { enabled: false } } },
      app: { vault: { adapter: {} } },
    } as any, {} as any, {} as any);
    await Promise.resolve();

    expect(mockListModels).not.toHaveBeenCalled();
    expect(mockSetCodexModelCatalog).not.toHaveBeenCalled();
  });
});
