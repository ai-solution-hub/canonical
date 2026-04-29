import type Anthropic from '@anthropic-ai/sdk';
import type { z } from 'zod';

/**
 * Extract the tool_use result from a Claude response.
 * Used by all AI endpoints that require structured JSON output via tool-use mode.
 *
 * When a Zod schema is provided, the extracted result is validated against it.
 * Validation failures are logged but do not throw — the unvalidated result is
 * returned as a fallback to avoid breaking features due to schema drift.
 */
export function extractToolResult<T>(
  response: Anthropic.Messages.Message,
  toolName: string,
  schema?: z.ZodType<T>,
): T {
  const toolBlock = response.content.find(
    (block): block is Anthropic.Messages.ToolUseBlock =>
      block.type === 'tool_use' && block.name === toolName,
  );
  if (!toolBlock) {
    throw new Error(`Claude did not return a ${toolName} tool call`);
  }

  if (schema) {
    const parsed = schema.safeParse(toolBlock.input);
    if (!parsed.success) {
      console.error(
        `AI response validation failed for ${toolName}:`,
        parsed.error.issues,
      );
      // Fall back to unvalidated result — log the issue but don't break the feature
      return toolBlock.input as T;
    }
    return parsed.data;
  }

  return toolBlock.input as T;
}
