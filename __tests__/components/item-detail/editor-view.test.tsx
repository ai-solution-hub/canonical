/**
 * EditorView Component Tests
 *
 * Tests the editor view for the item detail page — the full editing
 * interface that preserves ALL current editing functionality:
 * - Renders all edit controls (edit button, star, priority, organise section)
 * - Renders layer switcher for editors
 * - Renders Claude prompt buttons when applicable
 * - Renders metadata sidebar in edit mode
 * - Mode toggle slot rendered when provided
 * - Accessibility: heading hierarchy, aria labels
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockIsFeatureEnabled } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn(() => false),
}));

// ---------------------------------------------------------------------------
// Mock all child components to isolate EditorView rendering logic
// ---------------------------------------------------------------------------

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/format', () => ({
  getDisplayTitle: ({
    suggested_title,
    title,
    content,
  }: {
    suggested_title: string | null;
    title: string | null;
    content: string | null;
  }) => suggested_title ?? title ?? content?.slice(0, 50) ?? 'Untitled',
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateIngestUrlPrompt: (url: string) => ({ prompt: `Ingest: ${url}` }),
  generateSummariseAndIngestPrompt: (title: string) => ({
    prompt: `Summarise: ${title}`,
  }),
}));

vi.mock('@/components/shared/thumbnail', () => ({
  Thumbnail: (props: Record<string, unknown>) => (
    <div data-testid="thumbnail" data-alt={props.alt}>
      Thumbnail
    </div>
  ),
}));

vi.mock('@/components/item-detail/content-tabs', () => ({
  ContentTabs: (props: Record<string, unknown>) => (
    <div data-testid="content-tabs" data-can-edit={props.canEdit}>
      ContentTabs
    </div>
  ),
}));

vi.mock('@/components/item-detail/metadata-sidebar', () => ({
  MetadataSidebar: (props: Record<string, unknown>) => (
    <div data-testid="metadata-sidebar" data-read-only={props.readOnly}>
      MetadataSidebar
    </div>
  ),
}));

vi.mock('@/components/item-detail/organise-section', () => ({
  OrganiseSection: () => (
    <div data-testid="organise-section">OrganiseSection</div>
  ),
}));

vi.mock('@/components/item-detail/entity-badges', () => ({
  EntityBadges: () => <div data-testid="entity-badges">EntityBadges</div>,
}));

vi.mock('@/components/source-document/source-document-info', () => ({
  SourceDocumentInfo: () => (
    <div data-testid="source-document-info">SourceDocumentInfo</div>
  ),
}));

vi.mock('@/components/item-detail/version-history', () => ({
  VersionHistory: () => <div data-testid="version-history">VersionHistory</div>,
}));

vi.mock('@/components/item-detail/item-action-bar', () => ({
  ItemActionBar: (props: Record<string, unknown>) => (
    <div data-testid="item-action-bar" data-can-edit={props.canEdit}>
      ItemActionBar
      {props.detailModeToggle as React.ReactNode}
    </div>
  ),
}));

vi.mock('@/components/content/claude-prompt-button', () => ({
  ClaudePromptButton: (props: Record<string, unknown>) => (
    <button data-testid="claude-prompt-button" data-label={props.label}>
      {props.label as string}
    </button>
  ),
}));

vi.mock('@/components/browse/topic-layer-comparison', () => ({
  TopicLayerComparison: () => (
    <div data-testid="topic-layer-comparison">TopicLayerComparison</div>
  ),
}));

vi.mock('@/components/item-detail/collapsible-section', () => ({
  CollapsibleSection: ({
    children,
    title,
  }: {
    children: React.ReactNode;
    title: string;
  }) => (
    <div data-testid={`collapsible-${title.toLowerCase()}`}>{children}</div>
  ),
}));

vi.mock('@/components/item-detail/related-content-section', () => ({
  RelatedContentSection: () => (
    <div data-testid="related-content-section">RelatedContentSection</div>
  ),
}));

vi.mock('@/components/item-detail/qa-provenance-sections', () => ({
  QAUsedInBids: () => <div data-testid="qa-used-in-bids">QAUsedInBids</div>,
  QARelatedPairs: () => (
    <div data-testid="qa-related-pairs">QARelatedPairs</div>
  ),
}));

vi.mock('@/components/item-detail/content-body', () => ({
  ContentBody: (props: {
    contentTabsElement?: React.ReactNode;
    canEdit?: boolean;
  }) => (
    <div data-testid="content-body" data-can-edit={props.canEdit}>
      {props.contentTabsElement}
      ContentBody
    </div>
  ),
}));

vi.mock('@/components/item-detail/layer-switcher-nav', () => ({
  LayerSwitcherNav: () => (
    <div data-testid="layer-switcher-nav">LayerSwitcherNav</div>
  ),
}));

vi.mock('@/components/item-detail/item-title-section', () => ({
  ItemTitleSection: () => (
    <div data-testid="item-title-section">ItemTitleSection</div>
  ),
}));

vi.mock('@/components/item-detail/item-breadcrumb', () => ({
  ItemBreadcrumb: () => (
    <nav data-testid="item-breadcrumb" aria-label="Breadcrumb">
      ItemBreadcrumb
    </nav>
  ),
}));

import { EditorView } from '@/components/item-detail/editor-view';
import type { ItemDetailData } from '@/hooks/use-item-detail-data';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: 'Suggested Title',
    content: 'Test content that is long enough to display.',
    summary: 'AI summary text',
    ai_keywords: ['keyword1', 'keyword2'],
    primary_domain: 'business_operations',
    primary_subtopic: 'procurement',
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: 'Test Author',
    source_url: 'https://example.com/article',
    file_path: null,
    source_domain: 'example.com',
    thumbnail_url: null,
    captured_date: '2026-01-15',
    classification_confidence: 0.95,
    classification_reasoning: 'High confidence match',
    classified_at: '2026-01-15T10:00:00Z',
    summary_data: null,
    priority: null,
    user_tags: [],
    freshness: 'fresh',
    governance_review_status: null,
    metadata: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function createMockData(
  overrides: Partial<ItemDetailData> = {},
): ItemDetailData {
  const item = createMockItem(
    overrides.item ? (overrides.item as Partial<ItemData>) : {},
  );
  return {
    item,
    setItem: vi.fn(),
    relatedItems: [],
    title: 'Suggested Title',
    isQAPair: false,
    hasReaderContent: false,
    transcriptChapters: undefined,
    visionAnalysis: undefined,
    isMobile: false,
    canEdit: true,
    canAdmin: true,
    router: {
      push: vi.fn(),
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
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
    ...overrides,
  } as unknown as ItemDetailData;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EditorView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(false);
  });

  describe('rendering', () => {
    it('renders breadcrumb navigation', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('item-breadcrumb')).toBeInTheDocument();
    });

    it('renders item title section', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('item-title-section')).toBeInTheDocument();
    });

    it('renders item action bar with canEdit=true', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      const actionBar = screen.getByTestId('item-action-bar');
      expect(actionBar).toBeInTheDocument();
      expect(actionBar).toHaveAttribute('data-can-edit', 'true');
    });

    it('renders content body', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('content-body')).toBeInTheDocument();
    });

    it('renders metadata sidebar in edit mode (readOnly=false)', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      const sidebar = screen.getByTestId('metadata-sidebar');
      expect(sidebar).toBeInTheDocument();
      expect(sidebar).toHaveAttribute('data-read-only', 'false');
    });

    it('renders content tabs with canEdit=true', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      const tabs = screen.getByTestId('content-tabs');
      expect(tabs).toBeInTheDocument();
      expect(tabs).toHaveAttribute('data-can-edit', 'true');
    });
  });

  describe('editor-only controls', () => {
    it('renders layer switcher when canEdit is true', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('layer-switcher-nav')).toBeInTheDocument();
    });

    it('renders organise section when canEdit is true', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('organise-section')).toBeInTheDocument();
    });

    it('renders Claude prompt buttons when source_url exists', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({ source_url: 'https://example.com/page' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByTestId('claude-prompt-button')).toBeInTheDocument();
      expect(
        screen.getByText('Replace with fresh copy'),
      ).toBeInTheDocument();
    });

    it('renders Claude prompt buttons when content is long', () => {
      const longContent = 'x'.repeat(6000);
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({ content: longContent, source_url: null }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByText('Summarise and add to knowledge base')).toBeInTheDocument();
    });

    it('does not render Claude prompts when no source_url and content is short', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({ source_url: null, content: 'short' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByTestId('claude-prompt-button'),
      ).not.toBeInTheDocument();
    });
  });

  describe('mode toggle slot', () => {
    it('renders detailModeToggle when provided', () => {
      render(
        <EditorView
          data={createMockData()}
          relatedItems={[]}
          detailModeToggle={<div data-testid="mode-toggle">Toggle</div>}
        />,
      );
      expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    });

    it('does not render mode toggle slot when not provided', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('includes screen reader keyboard shortcut help for editors', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      const note = screen.getByRole('note', { name: 'Keyboard shortcuts' });
      expect(note).toBeInTheDocument();
      expect(note.textContent).toContain('Shift+D to switch to reader mode');
    });

    it('includes screen reader save announcements', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      const liveRegion = document.querySelector('[aria-live="polite"]');
      expect(liveRegion).toBeInTheDocument();
    });

    it('renders article with aria-label', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByRole('article', { name: 'Test Item' }),
      ).toBeInTheDocument();
    });
  });

  describe('relationships section', () => {
    it('renders entity badges in relationships', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('entity-badges')).toBeInTheDocument();
    });

    it('renders version history in relationships', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('version-history')).toBeInTheDocument();
    });

    it('renders related content section', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('related-content-section')).toBeInTheDocument();
    });
  });

  describe('source document', () => {
    it('renders source document info when source_document_id exists', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({ source_document_id: 'doc-1' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByTestId('source-document-info')).toBeInTheDocument();
    });

    it('does not render source document info when source_document_id is null', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({ source_document_id: undefined }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByTestId('source-document-info'),
      ).not.toBeInTheDocument();
    });
  });

  describe('thumbnail', () => {
    it('renders thumbnail when available and not Q&A pair', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({
              thumbnail_url: 'https://example.com/thumb.jpg',
            }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByTestId('thumbnail')).toBeInTheDocument();
    });

    it('does not render thumbnail for Q&A pairs', () => {
      render(
        <EditorView
          data={createMockData({
            isQAPair: true,
            item: createMockItem({
              content_type: 'q_a_pair',
              thumbnail_url: 'https://example.com/thumb.jpg',
            }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.queryByTestId('thumbnail')).not.toBeInTheDocument();
    });
  });

  describe('P1-6 visual nesting fixes', () => {
    it('content section is always visible (not wrapped in a collapsible)', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      // Content body should be in the DOM without a collapsible wrapper
      const contentBody = screen.getByTestId('content-body');
      expect(contentBody).toBeInTheDocument();
      // No collapsible-content wrapper should exist
      expect(
        screen.queryByTestId('collapsible-content'),
      ).not.toBeInTheDocument();
    });

    it('content section has aria-label for accessibility', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      // The content section should be a region with an accessible label
      const contentSection = screen.getByRole('region', { name: 'Content' });
      expect(contentSection).toBeInTheDocument();
    });

    it('relationships section remains collapsible', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      // Relationships should still be inside a collapsible wrapper
      expect(
        screen.getByTestId('collapsible-relationships'),
      ).toBeInTheDocument();
    });

    it('metadata sidebar remains collapsible', () => {
      render(<EditorView data={createMockData()} relatedItems={[]} />);
      // Metadata should still be inside a collapsible wrapper
      expect(screen.getByTestId('collapsible-metadata')).toBeInTheDocument();
    });

    it('does not render Classification Details accordion (P0-3b admin-only policy)', () => {
      render(
        <EditorView
          data={createMockData({
            item: createMockItem({
              classification_confidence: 0.95,
              classification_reasoning: 'High confidence match for domain',
            }),
          })}
          relatedItems={[]}
        />,
      );
      // Classification Details and reasoning must not appear in the editor view
      expect(
        screen.queryByText('Classification Details'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('High confidence match for domain'),
      ).not.toBeInTheDocument();
    });

    it('does not expose classification reasoning to non-admin editors', () => {
      render(
        <EditorView
          data={createMockData({
            canAdmin: false,
            canEdit: true,
            item: createMockItem({
              classification_reasoning: 'Detailed AI reasoning text',
            }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByText('Detailed AI reasoning text'),
      ).not.toBeInTheDocument();
    });
  });
});
