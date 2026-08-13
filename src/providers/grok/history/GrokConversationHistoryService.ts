import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ProviderConversationHistoryService } from '../../../core/providers/types';
import type { ChatMessage, Conversation } from '../../../core/types';
import { readGrokString } from '../runtime/GrokHeadlessRunner';
import { getGrokState } from '../types';

function resolveGrokHistoryFile(
  vaultPath: string | null,
  sessionId: string | null,
): string | null {
  if (!vaultPath || !sessionId) return null;
  const historyPath = path.join(
    os.homedir(),
    '.grok',
    'sessions',
    encodeURIComponent(vaultPath),
    sessionId,
    'chat_history.jsonl',
  );
  try {
    return fs.statSync(historyPath).isFile() ? historyPath : null;
  } catch {
    return null;
  }
}

export function extractGrokHistoryText(content: unknown): string {
  return readGrokString(content);
}

function extractGrokUserQueryText(text: string): string {
  const match = text.match(/<user_query>\s*([\s\S]*?)\s*<\/user_query>/);
  return (match ? match[1] : text).trim();
}

function shouldSkipGrokHistoryUser(record: Record<string, unknown>, text: string): boolean {
  const trimmed = text.trim();
  return !!record.synthetic_reason
    || !trimmed
    || trimmed.startsWith('<user_info>')
    || trimmed.startsWith('<system-reminder>');
}

function loadGrokHistoryMessages(
  historyPath: string,
  sessionId: string,
  baseTimestamp: number,
): ChatMessage[] {
  let content: string;
  try {
    content = fs.readFileSync(historyPath, 'utf-8');
  } catch {
    return [];
  }

  const messages: ChatMessage[] = [];
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;
    const record = parsed as Record<string, unknown>;

    const role = typeof record.type === 'string' ? record.type : '';
    const timestamp = baseTimestamp + messages.length;

    if (role === 'user') {
      const rawText = extractGrokHistoryText(record.content);
      if (shouldSkipGrokHistoryUser(record, rawText)) continue;
      const userText = extractGrokUserQueryText(rawText);
      if (!userText) continue;
      const id = `grok-${sessionId}-${i}-user`;
      messages.push({
        content: userText,
        displayContent: userText,
        id,
        role: 'user',
        timestamp,
        userMessageId: id,
      });
      continue;
    }

    if (role === 'assistant') {
      const assistantText = extractGrokHistoryText(record.content);
      if (!assistantText.trim()) continue;
      const id = `grok-${sessionId}-${i}-assistant`;
      messages.push({
        assistantMessageId: id,
        content: assistantText,
        contentBlocks: [{ type: 'text', content: assistantText }],
        id,
        role: 'assistant',
        timestamp,
      });
    }
  }

  return messages;
}

export class GrokConversationHistoryService implements ProviderConversationHistoryService {
  private hydratedKeys = new Map<string, string>();

  async hydrateConversationHistory(
    conversation: Conversation,
    vaultPath: string | null,
  ): Promise<void> {
    const sessionId = this.resolveSessionIdForConversation(conversation);
    const historyPath = resolveGrokHistoryFile(vaultPath, sessionId);
    if (!sessionId || !historyPath) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    let stat: fs.Stats;
    try {
      stat = fs.statSync(historyPath);
    } catch {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    const hydrationKey = `${sessionId}::${historyPath}::${stat.mtimeMs}::${stat.size}`;
    if (
      conversation.messages.length > 0
      && this.hydratedKeys.get(conversation.id) === hydrationKey
    ) {
      return;
    }

    const messages = loadGrokHistoryMessages(
      historyPath,
      sessionId,
      typeof conversation.createdAt === 'number' ? conversation.createdAt : Date.now(),
    );
    if (messages.length === 0) {
      this.hydratedKeys.delete(conversation.id);
      return;
    }

    conversation.messages = messages;
    this.hydratedKeys.set(conversation.id, hydrationKey);
  }

  async deleteConversationSession(
    _conversation: Conversation,
    _vaultPath: string | null,
  ): Promise<void> {
    // Never delete ~/.grok transcripts
  }

  resolveSessionIdForConversation(conversation: Conversation | null): string | null {
    if (!conversation) return null;
    const state = getGrokState(conversation.providerState);
    return state.sessionId ?? conversation.sessionId;
  }

  isPendingForkConversation(_conversation: Conversation): boolean {
    return false;
  }

  buildForkProviderState(
    sourceSessionId: string,
    resumeAt: string,
    sourceProviderState?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      ...(sourceProviderState ?? {}),
      forkSource: { sessionId: sourceSessionId, resumeAt },
    };
  }

  buildPersistedProviderState(
    conversation: Conversation,
  ): Record<string, unknown> | undefined {
    const state = getGrokState(conversation.providerState);
    const providerState: Record<string, unknown> = {
      ...(state.sessionId ? { sessionId: state.sessionId } : {}),
    };
    return Object.keys(providerState).length > 0 ? providerState : undefined;
  }
}
