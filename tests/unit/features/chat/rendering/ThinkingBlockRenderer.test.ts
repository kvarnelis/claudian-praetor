import { createMockEl } from '@test/helpers/mockElement';

import {
  createThinkingBlock,
  finalizeThinkingBlock,
  renderStoredThinkingBlock,
} from '@/features/chat/rendering/ThinkingBlockRenderer';

// Mock renderContent function
const mockRenderContent = jest.fn().mockResolvedValue(undefined);

describe('ThinkingBlockRenderer', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('createThinkingBlock', () => {
    it('should show timer label', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      expect(state.labelEl.textContent).toContain('Thinking');
    });

    it('should clean up timer on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      expect(state.timerInterval).not.toBeNull();

      finalizeThinkingBlock(state);

      expect(state.timerInterval).toBeNull();
    });
  });

  describe('finalizeThinkingBlock', () => {
    it('should collapse the block when finalized', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      // Manually expand first
      state.wrapperEl.addClass('expanded');
      state.contentEl.style.display = 'block';

      finalizeThinkingBlock(state);

      expect(state.wrapperEl.hasClass('expanded')).toBe(false);
      expect(state.contentEl.style.display).toBe('none');
    });

    it('should update label with final duration', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);

      // Advance time by 5 seconds
      jest.advanceTimersByTime(5000);

      const duration = finalizeThinkingBlock(state);

      expect(duration).toBeGreaterThanOrEqual(5);
      expect(state.labelEl.textContent).toContain('Thought for');
    });

    it('should sync isExpanded state so toggle works correctly after finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);
      const header = (state.wrapperEl as any)._children[0];

      // Expand the block
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);

      // Finalize (which collapses)
      finalizeThinkingBlock(state);
      expect(state.isExpanded).toBe(false);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(false);

      // Now click once - should expand (not require two clicks)
      clickHandlers[0]();
      expect(state.isExpanded).toBe(true);
      expect((state.wrapperEl as any).hasClass('expanded')).toBe(true);
      expect((state.contentEl as any).hasClass('claudian-hidden')).toBe(false);
    });

    it('should update aria-expanded on finalize', () => {
      const parentEl = createMockEl();

      const state = createThinkingBlock(parentEl, mockRenderContent);
      const header = (state.wrapperEl as any)._children[0];

      // Expand first
      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers[0]();
      expect(header.getAttribute('aria-expanded')).toBe('true');

      // Finalize
      finalizeThinkingBlock(state);
      expect(header.getAttribute('aria-expanded')).toBe('false');
    });
  });

  describe('renderStoredThinkingBlock', () => {
    it('should defer rendering stored content until first expansion', async () => {
      const parentEl = createMockEl();

      const wrapperEl = renderStoredThinkingBlock(parentEl, 'thinking content', 10, mockRenderContent);
      const header = (wrapperEl as any)._children[0];
      const contentEl = (wrapperEl as any)._children[1];

      expect(mockRenderContent).not.toHaveBeenCalled();

      const clickHandlers = header._eventListeners.get('click') || [];
      clickHandlers.forEach((handler: () => void) => handler());
      await Promise.resolve();

      expect(mockRenderContent).toHaveBeenCalledTimes(1);
      expect(mockRenderContent).toHaveBeenCalledWith(contentEl, 'thinking content');

      clickHandlers.forEach((handler: () => void) => handler());
      await Promise.resolve();

      expect(mockRenderContent).toHaveBeenCalledTimes(1);
    });

    it('should render stored content when expanded with the keyboard', async () => {
      const parentEl = createMockEl();

      const wrapperEl = renderStoredThinkingBlock(parentEl, 'thinking content', undefined, mockRenderContent);
      const header = (wrapperEl as any)._children[0];

      const keydownHandlers = header._eventListeners.get('keydown') || [];
      keydownHandlers.forEach((handler: (event: KeyboardEvent) => void) =>
        handler({ key: 'Enter', preventDefault: jest.fn() } as unknown as KeyboardEvent)
      );
      await Promise.resolve();

      expect(mockRenderContent).toHaveBeenCalledTimes(1);
    });
  });
});
