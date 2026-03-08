import type { SystemMessageFunction } from '@copilotkit/react-core';
import type { CopilotPage } from '@/contexts/copilot-page-context';
import { BASE_PROMPT, PAGE_PROMPTS } from './page-prompts';

// ---------------------------------------------------------------------------
// Exported builders
// ---------------------------------------------------------------------------

/**
 * Build a page-aware system prompt for the global CopilotKit sidebar.
 */
export function buildSystemPrompt(
  page: CopilotPage,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pageMetadata: Record<string, string> = {},
): SystemMessageFunction {
  return (contextString: string) => {
    const pagePrompt = PAGE_PROMPTS[page] ?? PAGE_PROMPTS.unknown;
    return `${BASE_PROMPT}\n\n${pagePrompt}\n\n## Context\n\n${contextString}`;
  };
}

/**
 * Build the CopilotKit system message for the bid workspace.
 * Preserved for backward compatibility with the bid session page.
 */
export function buildBidSystemPrompt(
  bidName?: string,
  buyerName?: string,
): SystemMessageFunction {
  return (contextString: string) => {
    const bidContext = bidName
      ? `\nYou are currently assisting with the bid "${bidName}"${buyerName ? ` for ${buyerName}` : ''}.`
      : '';

    return `${BASE_PROMPT}
${bidContext}

${PAGE_PROMPTS['bid-session']}

## Context

The following context describes the current state of the bid workspace:

${contextString}`;
  };
}
