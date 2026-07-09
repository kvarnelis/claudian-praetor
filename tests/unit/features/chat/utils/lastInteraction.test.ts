import type { ChatMessage } from '@/core/types';
import { buildLastInteractionPayload } from '@/features/chat/utils/lastInteraction';

function message(
  id: string,
  role: ChatMessage['role'],
  content: string,
  extras: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role,
    content,
    timestamp: Number(id.replace(/\D/g, '')) || 0,
    ...extras,
  };
}

describe('buildLastInteractionPayload', () => {
  it('formats the latest prompt and response as markdown', () => {
    const messages = [
      message('1', 'user', 'Earlier prompt'),
      message('2', 'assistant', 'Earlier response'),
      message('3', 'user', 'Explain **this**.'),
      message('4', 'assistant', 'Here is the answer:\n\n```ts\nconst value = 1;\n```'),
    ];

    expect(buildLastInteractionPayload(messages)).toBe(
      '## Prompt\n\nExplain **this**.\n\n## Response\n\n'
      + 'Here is the answer:\n\n```ts\nconst value = 1;\n```',
    );
  });

  it('uses user-facing prompt content instead of injected context', () => {
    const messages = [
      message(
        '1',
        'user',
        'Stored prompt\n\n<current_note>\nNote.md\n</current_note>',
        { displayContent: 'Visible prompt' },
      ),
      message('2', 'assistant', 'Response'),
    ];

    expect(buildLastInteractionPayload(messages)).toContain('## Prompt\n\nVisible prompt');
    expect(buildLastInteractionPayload(messages)).not.toContain('<current_note>');
  });

  it('combines assistant segments from the same user turn', () => {
    const messages = [
      message('1', 'user', 'Prompt'),
      message('2', 'assistant', 'First part.'),
      message('3', 'assistant', 'Second part.'),
    ];

    expect(buildLastInteractionPayload(messages)).toBe(
      '## Prompt\n\nPrompt\n\n## Response\n\nFirst part.\n\nSecond part.',
    );
  });

  it('falls back to the previous completed turn when the latest prompt is unanswered', () => {
    const messages = [
      message('1', 'user', 'Completed prompt'),
      message('2', 'assistant', 'Completed response'),
      message('3', 'user', 'Unanswered prompt'),
    ];

    expect(buildLastInteractionPayload(messages)).toBe(
      '## Prompt\n\nCompleted prompt\n\n## Response\n\nCompleted response',
    );
  });

  it('ignores rebuilt context and interrupted assistant records', () => {
    const messages = [
      message('1', 'user', 'Completed prompt'),
      message('2', 'assistant', 'Completed response'),
      message('3', 'user', 'Internal context', { isRebuiltContext: true }),
      message('4', 'user', 'Interrupted prompt'),
      message('5', 'assistant', 'Partial response', { isInterrupt: true }),
    ];

    expect(buildLastInteractionPayload(messages)).toBe(
      '## Prompt\n\nCompleted prompt\n\n## Response\n\nCompleted response',
    );
  });

  it('returns null when no completed text interaction exists', () => {
    expect(buildLastInteractionPayload([])).toBeNull();
    expect(buildLastInteractionPayload([
      message('1', 'user', 'Prompt'),
      message('2', 'assistant', '   '),
    ])).toBeNull();
  });
});
