import type { AuxQueryConfig, AuxQueryRunner } from '../../../core/auxiliary/AuxQueryRunner';
import { QueryBackedInlineEditService } from '../../../core/auxiliary/QueryBackedInlineEditService';
import { QueryBackedInstructionRefineService } from '../../../core/auxiliary/QueryBackedInstructionRefineService';
import { QueryBackedTitleGenerationService } from '../../../core/auxiliary/QueryBackedTitleGenerationService';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import type {
  ProviderTaskResultInterpreter,
  ProviderTaskTerminalStatus,
} from '../../../core/providers/types';
import { getVaultPath } from '../../../utils/path';
import { runGrokHeadless } from '../runtime/GrokHeadlessRunner';
import { grokChatUIConfig } from '../ui/GrokChatUIConfig';

class GrokAuxQueryRunner implements AuxQueryRunner {
  private abortController: AbortController | null = null;

  constructor(private readonly plugin: ProviderHost) {}

  async query(config: AuxQueryConfig, prompt: string): Promise<string> {
    const cliPath = await this.plugin.getResolvedProviderCliPath('grok');
    if (!cliPath) {
      throw new Error("Grok CLI not found. Install Grok Build or set the Grok CLI path in Claude's Codex settings.");
    }

    this.abortController = config.abortController || new AbortController();

    return runGrokHeadless(this.plugin, cliPath, prompt, {
      cwd: getVaultPath(this.plugin.app) || process.cwd(),
      systemPrompt: config.systemPrompt,
      model: config.model,
      signal: this.abortController.signal,
      onTextChunk: config.onTextChunk,
    });
  }

  reset(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }
}

export class GrokInlineEditService extends QueryBackedInlineEditService {
  constructor(plugin: ProviderHost) {
    super(new GrokAuxQueryRunner(plugin));
  }
}

export class GrokInstructionRefineService extends QueryBackedInstructionRefineService {
  constructor(plugin: ProviderHost) {
    super(new GrokAuxQueryRunner(plugin));
  }
}

export class GrokTitleGenerationService extends QueryBackedTitleGenerationService {
  constructor(plugin: ProviderHost) {
    super({
      createRunner: () => new GrokAuxQueryRunner(plugin),
      resolveModel: () => {
        const settings = plugin.settings as unknown as Record<string, unknown>;
        const titleModel = typeof settings.titleGenerationModel === 'string'
          ? settings.titleGenerationModel
          : '';
        return grokChatUIConfig.ownsModel(titleModel, settings)
          ? titleModel
          : undefined;
      },
    });
  }
}

export class GrokTaskResultInterpreter implements ProviderTaskResultInterpreter {
  hasAsyncLaunchMarker(_toolUseResult: unknown): boolean {
    return false;
  }

  extractAgentId(_toolUseResult: unknown): string | null {
    return null;
  }

  extractStructuredResult(_toolUseResult: unknown): string | null {
    return null;
  }

  resolveTerminalStatus(
    _toolUseResult: unknown,
    fallbackStatus: ProviderTaskTerminalStatus,
  ): ProviderTaskTerminalStatus {
    return fallbackStatus;
  }

  extractTagValue(_payload: string, _tagName: string): string | null {
    return null;
  }
}
