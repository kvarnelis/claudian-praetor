import type { ChatMessage } from '../../../core/types';
import { extractUserDisplayContent } from '../../../utils/context';

function getPromptContent(message: ChatMessage): string {
  return message.displayContent
    ?? extractUserDisplayContent(message.content)
    ?? message.content;
}

export function buildLastInteractionPayload(messages: readonly ChatMessage[]): string | null {
  let nextUserIndex = messages.length;

  for (let userIndex = messages.length - 1; userIndex >= 0; userIndex--) {
    const userMessage = messages[userIndex];
    if (
      userMessage.role !== 'user'
      || userMessage.isInterrupt
      || userMessage.isRebuiltContext
    ) {
      continue;
    }

    const prompt = getPromptContent(userMessage).trim();
    const responseParts: string[] = [];
    for (let index = userIndex + 1; index < nextUserIndex; index++) {
      const message = messages[index];
      if (
        message.role !== 'assistant'
        || message.isInterrupt
        || message.isRebuiltContext
      ) {
        continue;
      }

      const content = message.content.trim();
      if (content) {
        responseParts.push(content);
      }
    }

    if (prompt && responseParts.length > 0) {
      return `## Prompt\n\n${prompt}\n\n## Response\n\n${responseParts.join('\n\n')}`;
    }

    nextUserIndex = userIndex;
  }

  return null;
}
