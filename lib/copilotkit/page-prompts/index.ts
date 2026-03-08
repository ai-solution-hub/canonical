// ---------------------------------------------------------------------------
// Page prompts — re-exported as a record keyed by CopilotPage type
// ---------------------------------------------------------------------------

import type { CopilotPage } from '@/contexts/copilot-page-context';
import { BID_SESSION_PROMPT } from './bid-session';
import { HOMEPAGE_PROMPT } from './homepage';

export { BASE_PROMPT } from './base';
export { BID_SESSION_PROMPT } from './bid-session';
export { HOMEPAGE_PROMPT } from './homepage';

/**
 * Page-specific prompts keyed by CopilotPage type.
 *
 * Prompts for pages without page-specific files are defined inline here.
 * As prompts grow in complexity, extract them to their own files following
 * the pattern of `bid-session.ts` and `homepage.ts`.
 */
export const PAGE_PROMPTS: Record<CopilotPage, string> = {
  homepage: HOMEPAGE_PROMPT,

  browse: `## Current Page: Content Browser

The user is browsing the knowledge base content library with filters and search.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

On the browse page, you help users find and understand content. Be specific and reference actual items when possible.`,

  library: `## Current Page: Q&A Library

The user is browsing Q&A pairs used for bid responses.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

On the library page, help users find Q&A pairs, understand coverage, and identify gaps.`,

  'item-detail': `## Current Page: Item Detail

The user is viewing a specific content item in the knowledge base.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

On the item detail page, you are a content analyst. Help the user understand this item's role in the KB -- its classification, quality, relationships to other content, and how it could be improved.`,

  'bid-session': BID_SESSION_PROMPT,

  'bid-detail': `## Current Page: Bid Detail

The user is viewing bid overview -- questions, tender documents, and export options.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

Help the user understand the bid's current state and what needs attention.`,

  review: `## Current Page: Content Review

The user is reviewing content items for quality verification, working through a review queue.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

On the review page, help users make review decisions faster. Be decisive -- give clear recommendations with brief reasoning.`,

  coverage: `## Current Page: Coverage Dashboard

The user is analysing taxonomy coverage -- which domains and subtopics have content and where gaps exist.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

Help users identify gaps and understand coverage metrics. Be specific about which domains need attention.`,

  search: `## Current Page: Search Results

The user is viewing search results from a knowledge base query.

## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

Help users refine their search or understand results.`,

  settings: `## Current Page: Settings

The user is viewing application settings.

## Interaction Style

Help with settings questions or general KB queries.`,

  unknown: `## Available Actions

- **searchKnowledgeBase** -- Search for any content in the KB

## Interaction Style

Help the user with knowledge base queries and general navigation.`,
};
