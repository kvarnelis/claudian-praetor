import { type ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { getRuntimeEnvironmentText } from '../../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../../core/providers/ProviderHost';
import { ProviderSettingsCoordinator } from '../../../core/providers/ProviderSettingsCoordinator';
import type { PermissionMode } from '../../../core/types/settings';
import { parseEnvironmentVariables } from '../../../utils/env';
import { getVaultPath } from '../../../utils/path';
import { extractGrokHistoryText } from '../history/GrokConversationHistoryService';
import type { GrokSafeMode } from '../settings';
import { getGrokProviderSettings } from '../settings';

export function buildGrokEnv(
  settings: Record<string, unknown>,
  cliPath: string,
): NodeJS.ProcessEnv {
  const customEnv = parseEnvironmentVariables(getRuntimeEnvironmentText(settings, 'grok'));
  const env: NodeJS.ProcessEnv = { ...process.env, ...customEnv };
  const pathEntries = [
    path.dirname(cliPath),
    path.join(os.homedir(), '.grok', 'bin'),
    env.PATH,
  ].filter((entry): entry is string => Boolean(entry));
  env.PATH = pathEntries.join(path.delimiter);
  env.TERM = env.TERM || 'xterm-256color';
  env.COLORTERM = env.COLORTERM || 'truecolor';
  if (env.GROK_TELEMETRY_TRACE_UPLOAD === undefined) {
    env.GROK_TELEMETRY_TRACE_UPLOAD = '0';
  }
  return env;
}

interface GrokArgsOptions {
  cwd: string;
  promptFile: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  permissionMode?: PermissionMode;
  safeMode?: GrokSafeMode;
  systemRules?: string;
}

function buildGrokArgs(options: GrokArgsOptions): string[] {
  const args = [
    '--cwd',
    options.cwd,
    '--no-auto-update',
    '--no-alt-screen',
    '--output-format',
    'streaming-json',
  ];
  if (options.model) {
    args.push('-m', options.model);
  }
  if (options.effort) {
    args.push('--effort', options.effort);
  }
  if (options.systemRules) {
    args.push('--system-prompt-override', options.systemRules);
  }
  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }
  if (options.permissionMode === 'yolo') {
    args.push('--always-approve');
  } else if (options.permissionMode === 'plan') {
    args.push('--permission-mode', 'plan');
  } else if (options.safeMode) {
    args.push('--sandbox', options.safeMode);
  }
  args.push('--prompt-file', options.promptFile);
  return args;
}

function writeGrokPromptFile(prompt: string): string {
  const filePath = path.join(
    os.tmpdir(),
    `pocket-codex-grok-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`,
  );
  fs.writeFileSync(filePath, prompt, 'utf-8');
  return filePath;
}

export function readGrokString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(readGrokString).filter(Boolean).join('');
  }
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string') return record.text;
  if (typeof record.delta === 'string') return record.delta;
  if (typeof record.data === 'string') return record.data;
  if (typeof record.content === 'string') return record.content;
  if (Array.isArray(record.data)) return readGrokString(record.data);
  if (record.data && typeof record.data === 'object') return readGrokString(record.data);
  if (Array.isArray(record.content)) return readGrokString(record.content);
  if (record.content && typeof record.content === 'object') return readGrokString(record.content);
  if (record.message) return readGrokString(record.message);
  if (record.update) return readGrokString(record.update);
  if (record.params) return readGrokString(record.params);
  if (record.result) return readGrokString(record.result);
  if (Array.isArray(record.choices)) return readGrokString(record.choices);
  if (typeof record.output_text === 'string') return record.output_text;
  if (typeof record.response === 'string') return record.response;
  return '';
}

function extractGrokEventText(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (type.includes('error')) return '';

  const method = typeof record.method === 'string' ? record.method : '';
  if (method === 'session/update' || method === '_x.ai/session/update') {
    const params = record.params && typeof record.params === 'object'
      ? record.params as Record<string, unknown>
      : null;
    const update = params && params.update && typeof params.update === 'object'
      ? params.update as Record<string, unknown>
      : null;
    const sessionUpdate = update && typeof update.sessionUpdate === 'string'
      ? update.sessionUpdate
      : '';
    if (update && sessionUpdate === 'agent_message_chunk') {
      return readGrokString(update.content);
    }
    return '';
  }

  if (
    record.data !== undefined &&
    (!type || type === 'text' || type === 'delta' || type.includes('message') ||
      type.includes('chunk') || type.includes('output') || type.includes('response'))
  ) {
    return readGrokString(record.data);
  }
  if (record.delta !== undefined) return readGrokString(record.delta);
  if (record.text !== undefined) return readGrokString(record.text);
  if (record.content !== undefined) return readGrokString(record.content);
  if (record.message !== undefined) return readGrokString(record.message);
  if (record.update !== undefined) return readGrokString(record.update);
  if (record.params !== undefined) return readGrokString(record.params);
  if (record.result !== undefined) return readGrokString(record.result);
  if (record.output_text !== undefined) return readGrokString(record.output_text);
  if (record.response !== undefined) return readGrokString(record.response);
  return '';
}

function extractGrokEventError(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  const type = typeof record.type === 'string' ? record.type.toLowerCase() : '';
  if (!type.includes('error') && record.error === undefined) return '';
  return readGrokString(record.message)
    || readGrokString(record.error)
    || readGrokString(record.params)
    || 'Grok returned an error';
}

function extractGrokSessionId(event: unknown): unknown {
  if (!event || typeof event !== 'object') return null;
  const record = event as Record<string, unknown>;
  const direct = record.session_id ?? record.sessionId ?? record.session ?? null;
  if (direct) return direct;
  return extractGrokSessionId(record.params)
    || extractGrokSessionId(record.update)
    || extractGrokSessionId(record.result);
}

// Grok Build persists chat history under ~/.grok/sessions; these helpers let
// callers recover assistant text that the streaming-json output did not emit.
function readGrokHistoryLines(historyPath: string): string[] {
  try {
    return fs.readFileSync(historyPath, 'utf-8').split(/\r?\n/).filter(line => line.trim());
  } catch {
    return [];
  }
}

export function countGrokHistoryLines(historyPath: string): number {
  return readGrokHistoryLines(historyPath).length;
}

export function loadGrokAssistantTextSince(historyPath: string, startLine: number): string {
  const lines = readGrokHistoryLines(historyPath).slice(Math.max(0, startLine));
  let assistantText = '';
  for (const line of lines) {
    let record: { type?: unknown; content?: unknown } | null;
    try {
      record = JSON.parse(line) as { type?: unknown; content?: unknown } | null;
    } catch {
      continue;
    }
    if (record?.type !== 'assistant') continue;
    const text = extractGrokHistoryText(record.content);
    if (text.trim()) {
      assistantText = text;
    }
  }
  return assistantText;
}

export function getGrokMissingAssistantText(emittedText: string, persistedText: string): string {
  if (!persistedText.trim()) return '';
  if (!emittedText) return persistedText;
  if (persistedText === emittedText) return '';
  if (persistedText.startsWith(emittedText)) {
    return persistedText.slice(emittedText.length);
  }
  return '';
}

export interface GrokHistoryFileInfo {
  historyPath: string;
  mtimeMs: number;
  sessionId: string;
}

export function resolveLatestGrokHistoryFile(
  vaultPath: string | null,
  afterMtimeMs = 0,
): GrokHistoryFileInfo | null {
  if (!vaultPath) return null;
  const sessionsRoot = path.join(os.homedir(), '.grok', 'sessions', encodeURIComponent(vaultPath));
  let best: GrokHistoryFileInfo | null = null;
  try {
    for (const sessionId of fs.readdirSync(sessionsRoot)) {
      const historyPath = path.join(sessionsRoot, sessionId, 'chat_history.jsonl');
      let stat: fs.Stats;
      try {
        stat = fs.statSync(historyPath);
      } catch {
        continue;
      }
      if (!stat.isFile() || stat.mtimeMs < afterMtimeMs) continue;
      if (!best || stat.mtimeMs > best.mtimeMs) {
        best = { historyPath, mtimeMs: stat.mtimeMs, sessionId };
      }
    }
  } catch {
    return null;
  }
  return best;
}

// Resumed sessions replay the vault's CLAUDE.md rules, so follow-up turns must
// explicitly suppress the startup-greeting ritual.
export function buildGrokSystemPrompt(baseSystemPrompt: string, isFollowupTurn: boolean): string {
  if (!isFollowupTurn) return baseSystemPrompt;
  return `${baseSystemPrompt}
## Grok Build Pocket Codex Integration
The vault"s CLAUDE.md "Startup Greeting" rule applies only to the first assistant reply in a new Pocket Codex conversation. This is a resumed conversation, so do not repeat startup ASCII art, Ajman cat art, NETLAB banners, or dry one-line welcomes. Answer the user"s current message directly using the existing conversation context.`;
}

export function buildGrokTurnPrompt(prompt: string, isFollowupTurn: boolean): string {
  if (!isFollowupTurn) return prompt;
  return `<pocket_codex_followup_reminder>
This is a follow-up turn in an existing Pocket Codex conversation using Grok Build session resume. Continue the prior conversation and answer the user's current message directly.
Do not run startup behavior on this turn. Do not include startup ASCII art, Ajman cat art, NETLAB banners, dry one-line welcomes, or first-run/session-start rituals. Do not claim Pocket Codex, Grok Build, or claude-anywhere has no carryover memory between prompts.
</pocket_codex_followup_reminder>
${prompt}`;
}

export interface GrokHeadlessOptions {
  cwd?: string;
  model?: string;
  effort?: string;
  sessionId?: string;
  systemPrompt?: string;
  signal?: AbortSignal;
  onDelta?: (text: string) => void;
  onTextChunk?: (accumulatedText: string) => void;
  onSessionId?: (sessionId: string) => void;
  onProcess?: (proc: ChildProcess) => void;
}

export function runGrokHeadless(
  plugin: ProviderHost,
  cliPath: string,
  prompt: string,
  options: GrokHeadlessOptions = {},
): Promise<string> {
  const settings = ProviderSettingsCoordinator.getProviderSettingsSnapshot(plugin.settings, 'grok');
  const grokSettings = getGrokProviderSettings(settings);
  const cwd = options.cwd || getVaultPath(plugin.app) || process.cwd();
  const promptFile = writeGrokPromptFile(prompt);
  const args = buildGrokArgs({
    cwd,
    promptFile,
    model: options.model || settings.model,
    effort: options.effort || settings.effortLevel,
    sessionId: options.sessionId,
    permissionMode: settings.permissionMode,
    safeMode: grokSettings.safeMode,
    systemRules: options.systemPrompt,
  });
  const env = buildGrokEnv(settings, cliPath);
  const proc = spawn(cliPath, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdoutBuffer = '';
  let stderrText = '';
  let accumulated = '';
  let eventError = '';

  const appendText = (text: string) => {
    if (!text) return;
    accumulated += text;
    if (options.onDelta) options.onDelta(text);
    if (options.onTextChunk) options.onTextChunk(accumulated);
  };

  const handleLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const event: unknown = JSON.parse(trimmed);
      const sessionId = extractGrokSessionId(event);
      if (sessionId && options.onSessionId) {
        options.onSessionId(String(sessionId));
      }
      const err = extractGrokEventError(event);
      if (err) {
        eventError = err;
        return;
      }
      appendText(extractGrokEventText(event));
    } catch {
      // Non-JSON output is surfaced as plain text.
      appendText(line.endsWith('\n') ? line : `${line}\n`);
    }
  };

  proc.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8');
    let newlineIndex: number;
    while ((newlineIndex = stdoutBuffer.indexOf('\n')) >= 0) {
      const line = stdoutBuffer.slice(0, newlineIndex);
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      handleLine(line);
    }
  });

  proc.stderr.on('data', (chunk: Buffer) => {
    stderrText += chunk.toString('utf8');
  });

  const kill = () => {
    if (!proc.killed) {
      proc.kill('SIGTERM');
      window.setTimeout(() => {
        if (proc.exitCode === null && !proc.killed) {
          try {
            proc.kill('SIGKILL');
          } catch {
            // Process already exited.
          }
        }
      }, 1500);
    }
  };

  if (options.signal) {
    if (options.signal.aborted) {
      kill();
    } else {
      options.signal.addEventListener('abort', kill, { once: true });
    }
  }

  if (options.onProcess) {
    options.onProcess(proc);
  }

  return new Promise<string>((resolve, reject) => {
    proc.on('error', (err) => {
      try {
        fs.unlinkSync(promptFile);
      } catch {
        // Prompt file may already be gone.
      }
      reject(err);
    });

    proc.on('close', (code, signal) => {
      if (stdoutBuffer.trim()) {
        handleLine(stdoutBuffer);
      }
      try {
        fs.unlinkSync(promptFile);
      } catch {
        // Prompt file may already be gone.
      }
      if (options.signal) {
        options.signal.removeEventListener('abort', kill);
      }
      if (options.signal && options.signal.aborted) {
        resolve(accumulated);
        return;
      }
      if (eventError) {
        reject(new Error(eventError));
        return;
      }
      if (code && code !== 0) {
        reject(new Error(
          (stderrText.trim() || `Grok exited with code ${code}${signal ? ` (${signal})` : ''}`).trim(),
        ));
        return;
      }
      resolve(accumulated);
    });
  });
}
