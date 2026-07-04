/**
 * Canonical `ContentListItem` prop factory for component tests.
 *
 * Replaces 2 copy-pasted `createQAItem` definitions in `__tests__/components/`.
 * Per W-RG in `remediation-plan.md` §3.8 and S37 audit Agent B finding C6
 * (`agent-b-output.md` §2.F component-prop-factory cluster).
 *
 * Pattern reference: `validCreateBody(overrides)` and
 * `createMockMcpServer(overrides)` — `Partial<T>` overrides convention
 * per Test Philosophy §1 #6.
 *
 * ID-131.17: `createMockItem` (ItemData-shaped) and `createMockData`
 * (ItemDetailData-shaped) were removed here — both factories existed solely
 * for the now-deleted `components/item-detail/**` IMS surface (editor-view,
 * reader-view, content-body, item-title-section, the ItemDetailClient
 * orchestrator) and had no other consumer once those test suites were
 * deleted in the same commit.
 */
import type { ContentListItem } from '@/types/content';

/**
 * Build a `ContentListItem` fixture shaped as a Q&A pair (the
 * `content_type: 'qa_pair'` variant). Used by component test suites that
 * render Q&A rows / collapsible groups.
 *
 * The audited cohort's two `createQAItem` definitions differed only in
 * default `title`/`primary_domain`/`primary_subtopic` — this factory
 * picks the more permissive nulls and lets callers override.
 *
 * @example Minimal Q&A fixture
 * ```ts
 * const qa = createMockQAItem();
 * ```
 *
 * @example Override fields
 * ```ts
 * const qa = createMockQAItem({
 *   title: 'How does your organisation handle data security?',
 *   primary_subtopic: 'Information Security',
 * });
 * ```
 */
export function createMockQAItem(
  overrides: Partial<ContentListItem> = {},
): ContentListItem {
  return {
    id: 'qa-1',
    title: 'Test Q&A',
    suggested_title: null,
    summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'unclassified',
    content_type: 'qa_pair',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-01',
    ai_keywords: [],
    classification_confidence: null,
    priority: null,
    freshness: null,
    user_tags: [],
    governance_review_status: null,
    metadata: null,
    source_file: null,
    publication_status: null,
    ...overrides,
  };
}
