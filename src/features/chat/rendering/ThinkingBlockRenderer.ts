import { collapseElement, setupCollapsible } from './collapsible';

export type RenderContentFn = (el: HTMLElement, markdown: string) => Promise<void>;

export interface ThinkingBlockState {
  wrapperEl: HTMLElement;
  contentEl: HTMLElement;
  labelEl: HTMLElement;
  content: string;
  startTime: number;
  timerInterval: number | null;
  isExpanded: boolean;
}

export function createThinkingBlock(
  parentEl: HTMLElement,
  renderContent: RenderContentFn
): ThinkingBlockState {
  const wrapperEl = parentEl.createDiv({ cls: 'claudes-codex-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudes-codex-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-expanded', 'false');
  header.setAttribute('aria-label', 'Extended thinking - click to expand');

  // Label with timer
  const labelEl = header.createSpan({ cls: 'claudes-codex-thinking-label' });
  const startTime = Date.now();
  labelEl.setText('Thinking 0s...');

  // Start timer interval to update label every second
  const timerInterval = window.setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    labelEl.setText(`Thinking ${elapsed}s...`);
  }, 1000);

  // Collapsible content (collapsed by default)
  const contentEl = wrapperEl.createDiv({ cls: 'claudes-codex-thinking-content' });

  // Create state object first so toggle can reference it
  const state: ThinkingBlockState = {
    wrapperEl,
    contentEl,
    labelEl,
    content: '',
    startTime,
    timerInterval,
    isExpanded: false,
  };

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  setupCollapsible(wrapperEl, header, contentEl, state);

  return state;
}

export async function appendThinkingContent(
  state: ThinkingBlockState,
  content: string,
  renderContent: RenderContentFn
) {
  state.content += content;
  await renderContent(state.contentEl, state.content);
}

export function finalizeThinkingBlock(state: ThinkingBlockState): number {
  // Stop the timer
  if (state.timerInterval) {
    window.clearInterval(state.timerInterval);
    state.timerInterval = null;
  }

  // Calculate final duration
  const durationSeconds = Math.floor((Date.now() - state.startTime) / 1000);

  // Update label to show final duration (without "...")
  state.labelEl.setText(`Thought for ${durationSeconds}s`);

  // Collapse when done and sync state
  const header = state.wrapperEl.querySelector('.claudes-codex-thinking-header');
  if (header) {
    collapseElement(state.wrapperEl, header as HTMLElement, state.contentEl, state);
  }

  return durationSeconds;
}

export function cleanupThinkingBlock(state: ThinkingBlockState | null) {
  if (state?.timerInterval) {
    window.clearInterval(state.timerInterval);
  }
}

export function renderStoredThinkingBlock(
  parentEl: HTMLElement,
  content: string,
  durationSeconds: number | undefined,
  renderContent: RenderContentFn
): HTMLElement {
  const wrapperEl = parentEl.createDiv({ cls: 'claudes-codex-thinking-block' });

  // Header (clickable to expand/collapse)
  const header = wrapperEl.createDiv({ cls: 'claudes-codex-thinking-header' });
  header.setAttribute('tabindex', '0');
  header.setAttribute('role', 'button');
  header.setAttribute('aria-label', 'Extended thinking - click to expand');

  // Label with duration
  const labelEl = header.createSpan({ cls: 'claudes-codex-thinking-label' });
  const labelText = durationSeconds !== undefined ? `Thought for ${durationSeconds}s` : 'Thought';
  labelEl.setText(labelText);

  // Collapsible content
  const contentEl = wrapperEl.createDiv({ cls: 'claudes-codex-thinking-content' });

  // Stored thinking is collapsed by default. Defer its Markdown work until the
  // user actually opens the panel so restoring a long conversation does not
  // eagerly render content that may never be viewed.
  let hasRendered = false;
  const ensureRendered = async () => {
    if (hasRendered) return;
    hasRendered = true;
    contentEl.setAttribute('aria-busy', 'true');
    try {
      await renderContent(contentEl, content);
    } catch {
      contentEl.setText(content);
    } finally {
      contentEl.removeAttribute('aria-busy');
    }
  };

  header.addEventListener('click', () => {
    void ensureRendered();
  });
  header.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.key === 'Enter' || event.key === ' ') {
      void ensureRendered();
    }
  });

  // Setup collapsible behavior (handles click, keyboard, ARIA, CSS)
  const state = { isExpanded: false };
  setupCollapsible(wrapperEl, header, contentEl, state);

  return wrapperEl;
}
