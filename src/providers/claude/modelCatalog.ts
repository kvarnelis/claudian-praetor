/**
 * Session-level cache of the models the installed Claude Code CLI reports via
 * the SDK's supportedModels(). Populated by the runtime on system/init;
 * consumers fall back to the static DEFAULT_CLAUDE_MODELS until then.
 */

import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

export interface CliModelOption {
  value: string;
  label: string;
  description: string;
}

const ONE_M_SUFFIX = '[1m]';
// Families whose 1M variant is a Praetor-side toggle rather than a CLI-listed model
const FAMILIES_WITH_1M_VARIANT = new Set(['opus', 'sonnet']);

let cliModelCatalog: ModelInfo[] | null = null;

export function setCliModelCatalog(models: ModelInfo[]): void {
  cliModelCatalog = models;
}

export function clearCliModelCatalog(): void {
  cliModelCatalog = null;
}

/**
 * CLI-reported models mapped to selector options, or null before the first
 * fetch. The CLI lists most-capable-first; Praetor stores ascending capability
 * (the dropdown renders reversed), so the order is flipped here. The 'default'
 * pseudo-entry is dropped — the selector semantics are an explicit model
 * choice. For the opus/sonnet family aliases a [1m] variant is synthesized so
 * the 1M visibility toggles keep working.
 */
export function getCliModelOptions(): CliModelOption[] | null {
  if (!cliModelCatalog) {
    return null;
  }

  const options: CliModelOption[] = [];
  for (const info of [...cliModelCatalog].reverse()) {
    const value = info.value.trim();
    const normalized = value.toLowerCase();
    if (!value || normalized === 'default') {
      continue;
    }

    options.push({ value, label: info.displayName, description: info.description });

    if (FAMILIES_WITH_1M_VARIANT.has(normalized)) {
      options.push({
        value: `${value}${ONE_M_SUFFIX}`,
        label: `${info.displayName} 1M`,
        description: `${info.description} (1M context window)`,
      });
    }
  }

  return options.length > 0 ? options : null;
}

/**
 * Effort levels the CLI reports for a model, or null when the catalog is unset,
 * the model is unknown, or the model does not support effort. Synthesized [1m]
 * variants resolve to their base entry.
 */
export function getCliEffortLevels(model: string): string[] | null {
  if (!cliModelCatalog) {
    return null;
  }

  const normalized = model.trim().toLowerCase();
  const base = normalized.endsWith(ONE_M_SUFFIX)
    ? normalized.slice(0, -ONE_M_SUFFIX.length)
    : normalized;

  const entry =
    cliModelCatalog.find((info) => info.value.trim().toLowerCase() === normalized)
    ?? cliModelCatalog.find((info) => info.value.trim().toLowerCase() === base);

  if (!entry?.supportsEffort || !entry.supportedEffortLevels?.length) {
    return null;
  }

  return entry.supportedEffortLevels;
}
