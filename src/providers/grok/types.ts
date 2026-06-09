import type { ForkSource } from '../../core/types/chat';

export interface GrokProviderState {
  sessionId?: string;
  forkSource?: ForkSource;
}

export function getGrokState(
  providerState?: Record<string, unknown>,
): GrokProviderState {
  return (providerState ?? {}) as GrokProviderState;
}
