/**
 * Canonical `ItemData` + `ContentListItem` prop factories for component tests.
 *
 * Replaces 4 copy-pasted `createMockItem(overrides?)` definitions across
 * `__tests__/components/item-detail/` and 2 copy-pasted `createQAItem`
 * definitions in `__tests__/components/`. Per W-RG in
 * `remediation-plan.md` §3.8 and S37 audit Agent B finding C6
 * (`agent-b-output.md` §2.F component-prop-factory cluster).
 *
 * Pattern reference: `validCreateBody(overrides)` and
 * `createMockMcpServer(overrides)` — `Partial<T>` overrides convention
 * per Test Philosophy §1 #6.
 */
import { vi } from 'vitest';
import type { ItemData } from '@/app/item/[id]/item-detail-client';
import type { ItemDetailData } from '@/hooks/use-item-detail-data';
import type { ContentListItem } from '@/types/content';

/**
 * Build an `ItemData` fixture with sensible nullable defaults. Used by
 * `item-detail/editor-view`, `reader-view`, `content-body`, and
 * `item-title-section` component test suites.
 *
 * @example Minimal fixture
 * ```ts
 * const item = createMockItem();
 * ```
 *
 * @example Override specific fields for a test case
 * ```ts
 * const item = createMockItem({
 *   title: 'A custom title',
 *   primary_domain: 'security',
 *   classification_confidence: 0.92,
 * });
 * ```
 */
export function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: null,
    content: null,
    summary: null,
    ai_keywords: null,
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: null,
    author_name: null,
    source_url: null,
    file_path: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: null,
    classification_confidence: null,
    classification_reasoning: null,
    classified_at: null,
    summary_data: null,
    priority: null,
    user_tags: null,
    freshness: null,
    governance_review_status: null,
    metadata: null,
    ...overrides,
  };
}

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

/**
 * Build the full `ItemDetailData` bag returned by the `useItemDetailData`
 * hook, used by `ItemDetailClient` orchestrator tests (which mock the hook)
 * and by view-component suites. All sub-objects (router, inlineEdit,
 * qaProvenance) are stubbed with `vi.fn()` no-ops; override any field via the
 * `Partial<ItemDetailData>` argument.
 *
 * Role defaults are editor-capable (`canEdit: true`, `canAdmin: false`) — the
 * `item-detail-client` orchestrator default. Reader-mode suites that need a
 * viewer should pass `{ canEdit: false }`.
 *
 * @example Default (editor-capable) data bag
 * ```ts
 * mockUseItemDetailData.mockReturnValue(createMockData());
 * ```
 *
 * @example Viewer override
 * ```ts
 * createMockData({ canEdit: false });
 * ```
 */
export function createMockData(
  overrides: Partial<ItemDetailData> = {},
): ItemDetailData {
  // Extract the item property from overrides before spreading
  const { item: itemOverride, ...restOverrides } = overrides;
  const item = createMockItem(
    itemOverride ? (itemOverride as Partial<ItemData>) : {},
  );
  return {
    item,
    setItem: vi.fn(),
    relatedItems: [],
    title: 'Test Item',
    isQAPair: false,
    hasReaderContent: false,
    transcriptChapters: undefined,
    visionAnalysis: undefined,
    isMobile: false,
    canEdit: true,
    canAdmin: false,
    router: {
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    } as unknown as ItemDetailData['router'],
    toggleRead: vi.fn(),
    segments: null,
    highlights: null,
    fontSize: 'medium' as const,
    maxWidth: 'medium' as const,
    panelLayout: {} as ItemDetailData['panelLayout'],
    readerOpen: false,
    setFontSize: vi.fn(),
    setMaxWidth: vi.fn(),
    setPanelLayout: vi.fn(),
    setReaderOpen: vi.fn(),
    toggleReader: vi.fn(),
    showSplitReader: false,
    inlineEdit: {
      editingField: null,
      editValue: '',
      saveSuccess: null,
      saveAnnouncement: '',
      isSaving: false,
      startEdit: vi.fn(),
      cancelEdit: vi.fn(),
      saveEdit: vi.fn(),
      setEditValue: vi.fn(),
    } as unknown as ItemDetailData['inlineEdit'],
    isAnalysing: false,
    handleVisionAnalysis: vi.fn(),
    qaProvenance: {
      usedInWorkspaces: [],
      relatedQA: [],
      topicLayers: [],
      handleLayerChange: vi.fn(),
    } as unknown as ItemDetailData['qaProvenance'],
    layerContent: {},
    isLayerContentLoading: false,
    copied: false,
    handleCopyLink: vi.fn(),
    handleCopyAnswer: vi.fn(),
    handleStarToggle: vi.fn(),
    handlePriorityCycle: vi.fn(),
    getActiveTabContent: vi.fn(() => ''),
    tabEditConfig: undefined,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn(),
    ...restOverrides,
  } as unknown as ItemDetailData;
}
