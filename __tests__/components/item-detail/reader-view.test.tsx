/**
 * ReaderView Component Tests
 *
 * Tests the reader view for the item detail page — a genuinely
 * reader-optimised layout (NOT just "editor with buttons hidden"):
 * - Renders content (title, breadcrumb, content tabs)
 * - Does NOT render edit controls (edit button, star, priority, organise
 *   section, layer switcher, Claude prompts, AI indicators)
 * - Renders metadata sidebar in readOnly mode
 * - Renders relationships section
 * - Accessibility: proper heading hierarchy, aria labels
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mock all child components to isolate ReaderView rendering logic
// ---------------------------------------------------------------------------

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

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockPdfViewer = () => <div data-testid="pdf-viewer">PdfViewer</div>;
    MockPdfViewer.displayName = 'MockPdfViewer';
    return MockPdfViewer;
  },
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

vi.mock('@/components/shared/read-toggle-button', () => ({
  ReadToggleButton: () => (
    <button data-testid="read-toggle-button">Read Toggle</button>
  ),
}));

vi.mock('@/components/qa/qa-answer-display', () => ({
  QAAnswerDisplay: () => (
    <div data-testid="qa-answer-display">QAAnswerDisplay</div>
  ),
}));

vi.mock('@/components/shared/content-type-header', () => ({
  ContentTypeHeader: () => (
    <div data-testid="content-type-header">ContentTypeHeader</div>
  ),
}));

vi.mock('@/components/item-detail/table-of-contents', () => ({
  TableOfContents: () => (
    <div data-testid="table-of-contents">TableOfContents</div>
  ),
}));

vi.mock('@/components/reader/transcript-reader', () => ({
  TranscriptReader: () => (
    <div data-testid="transcript-reader">TranscriptReader</div>
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

vi.mock('@/components/item-detail/item-breadcrumb', () => ({
  ItemBreadcrumb: () => (
    <nav data-testid="item-breadcrumb" aria-label="Breadcrumb">
      ItemBreadcrumb
    </nav>
  ),
}));

vi.mock('@/components/shared/verification-badge', () => ({
  VerificationBadge: (props: Record<string, unknown>) => (
    <span data-testid="verification-badge" data-verified={props.verified}>
      {props.verified ? 'Verified' : 'Unverified'}
    </span>
  ),
}));

vi.mock('@/components/shared/freshness-badge', () => ({
  FreshnessBadge: (props: Record<string, unknown>) => (
    <span
      data-testid="freshness-badge"
      data-freshness={props.freshness as string}
    >
      {props.freshness as string}
    </span>
  ),
}));

// ContentEffectivenessPanel triggers a fetch in useEffect on mount; mock it
// out so its async state updates don't fall outside React.act() boundaries
// and emit "wrapped into act(...)" warnings on every render-only assertion.
vi.mock('@/components/item-detail/content-effectiveness-panel', () => ({
  ContentEffectivenessPanel: () => (
    <div data-testid="content-effectiveness-panel">
      ContentEffectivenessPanel
    </div>
  ),
}));

import { ReaderView } from '@/components/item-detail/reader-view';
import type { ItemDetailData } from '@/hooks/use-item-detail-data';
import type { ItemData } from '@/app/item/[id]/item-detail-client';
import { createMockItem as createMockItemFactory } from '@/__tests__/helpers/factories/components/item';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wrapper around the canonical factory that applies ReaderView-specific
 * defaults — same fixture shape as the editor-view test (the reader and
 * editor views render the same fixture; the difference is mode).
 */
function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return createMockItemFactory({
    suggested_title: 'Suggested Title',
    content: 'Test content that is long enough to display.',
    summary: 'AI summary text',
    ai_keywords: ['keyword1', 'keyword2'],
    primary_domain: 'business_operations',
    primary_subtopic: 'procurement',
    platform: 'web',
    author_name: 'Test Author',
    source_url: 'https://example.com/article',
    source_domain: 'example.com',
    captured_date: '2026-01-15',
    classification_confidence: 0.95,
    classification_reasoning: 'High confidence match',
    classified_at: '2026-01-15T10:00:00Z',
    user_tags: [],
    freshness: 'fresh',
    metadata: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  });
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
    canEdit: false,
    canAdmin: false,
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

describe('ReaderView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders breadcrumb navigation', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('item-breadcrumb')).toBeInTheDocument();
    });

    it('renders clean title (h1 heading)', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByRole('heading', { level: 1, name: 'Suggested Title' }),
      ).toBeInTheDocument();
    });

    it('renders content tabs with canEdit=false', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      const tabs = screen.getByTestId('content-tabs');
      expect(tabs).toBeInTheDocument();
      expect(tabs).toHaveAttribute('data-can-edit', 'false');
    });

    it('renders read toggle button', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('read-toggle-button')).toBeInTheDocument();
    });

    it('renders copy content button for non-Q&A items', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByLabelText('Copy content to clipboard'),
      ).toBeInTheDocument();
    });

    it('renders more actions overflow menu', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByLabelText('More actions')).toBeInTheDocument();
    });

    it('renders content type header', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('content-type-header')).toBeInTheDocument();
    });
  });

  describe('does NOT render editor-only controls', () => {
    it('does not render item action bar (uses its own minimal bar instead)', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      // ReaderView builds its own minimal action bar — no ItemActionBar component
      expect(screen.queryByTestId('item-action-bar')).not.toBeInTheDocument();
    });

    it('does not render layer switcher', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.queryByTestId('layer-switcher-nav'),
      ).not.toBeInTheDocument();
    });

    it('does not render topic layer comparison', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.queryByTestId('topic-layer-comparison'),
      ).not.toBeInTheDocument();
    });

    it('does not render organise section', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.queryByTestId('organise-section')).not.toBeInTheDocument();
    });

    it('does not render Claude prompt buttons', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ source_url: 'https://example.com/page' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByTestId('claude-prompt-button'),
      ).not.toBeInTheDocument();
    });

    it('does not render star button', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.queryByTestId('star-button')).not.toBeInTheDocument();
    });

    it('does not render priority selector', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.queryByTestId('priority-selector')).not.toBeInTheDocument();
    });

    it('does not render edit button', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      // The ReaderView has no edit button — check for any button with "Edit" text
      // that is NOT inside the mode toggle
      const toolbar = screen.getByRole('toolbar');
      const editButtons = within(toolbar).queryAllByRole('button');
      const editButton = editButtons.find(
        (btn) =>
          btn.textContent === 'Edit' &&
          !btn.closest('[data-testid="mode-toggle"]'),
      );
      expect(editButton).toBeUndefined();
    });

    it('does not render delete option', () => {
      render(
        <ReaderView
          data={createMockData({ canAdmin: true })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByTestId('delete-content-dialog'),
      ).not.toBeInTheDocument();
    });
  });

  describe('metadata sidebar', () => {
    it('renders metadata sidebar in readOnly mode', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      const sidebar = screen.getByTestId('metadata-sidebar');
      expect(sidebar).toBeInTheDocument();
      expect(sidebar).toHaveAttribute('data-read-only', 'true');
    });

    it('renders source document info when source_document_id exists', () => {
      render(
        <ReaderView
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
        <ReaderView
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

  describe('relationships section', () => {
    it('renders entity badges', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('entity-badges')).toBeInTheDocument();
    });

    it('renders version history', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('version-history')).toBeInTheDocument();
    });

    it('renders related content section', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('related-content-section')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('includes screen reader keyboard shortcut help for viewers', () => {
      render(
        <ReaderView
          data={createMockData({ canEdit: false })}
          relatedItems={[]}
        />,
      );
      const note = screen.getByRole('note', { name: 'Keyboard shortcuts' });
      expect(note).toBeInTheDocument();
      expect(note.textContent).toContain('M to toggle read');
      expect(note.textContent).toContain('R to open reader panel');
      expect(note.textContent).not.toContain('Shift+D');
    });

    it('includes Shift+D shortcut hint for editors in reader mode', () => {
      render(
        <ReaderView
          data={createMockData({ canEdit: true })}
          relatedItems={[]}
        />,
      );
      const note = screen.getByRole('note', { name: 'Keyboard shortcuts' });
      expect(note.textContent).toContain('Shift+D to switch to editor mode');
    });

    it('renders article with aria-label', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByRole('article', { name: 'Test Item' }),
      ).toBeInTheDocument();
    });

    it('renders toolbar with aria-label for action bar', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByRole('toolbar', { name: 'Content actions' }),
      ).toBeInTheDocument();
    });

    it('renders content section with aria-label', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      const contentSection = screen.getByRole('region', { name: 'Content' });
      expect(contentSection).toBeInTheDocument();
    });
  });

  describe('mode toggle slot', () => {
    it('renders detailModeToggle when provided', () => {
      render(
        <ReaderView
          data={createMockData()}
          relatedItems={[]}
          detailModeToggle={<div data-testid="mode-toggle">Toggle</div>}
        />,
      );
      expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    });

    it('does not render mode toggle slot when not provided', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
    });
  });

  describe('Q&A pair handling', () => {
    it('renders QA answer display for Q&A pairs', () => {
      render(
        <ReaderView
          data={createMockData({
            isQAPair: true,
            item: createMockItem({ content_type: 'q_a_pair' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByTestId('qa-answer-display')).toBeInTheDocument();
    });

    it('renders copy answer dropdown for Q&A pairs', () => {
      render(
        <ReaderView
          data={createMockData({
            isQAPair: true,
            item: createMockItem({
              content_type: 'q_a_pair',
              answer_standard: 'Standard answer',
              answer_advanced: 'Advanced answer',
            }),
          })}
          relatedItems={[]}
        />,
      );
      // Q&A pairs show "Copy answer" dropdown instead of "Copy content"
      expect(screen.getByText('Copy answer')).toBeInTheDocument();
    });

    it('does not render thumbnail for Q&A pairs', () => {
      render(
        <ReaderView
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

  describe('thumbnail', () => {
    it('renders thumbnail when available and not Q&A pair', () => {
      render(
        <ReaderView
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
  });

  describe('P1-6 visual nesting — Classification Details admin-only guard', () => {
    it('does not expose classification reasoning to viewers', () => {
      render(
        <ReaderView
          data={createMockData({
            canEdit: false,
            canAdmin: false,
            item: createMockItem({
              classification_confidence: 0.95,
              classification_reasoning: 'Detailed AI classification reasoning',
            }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByText('Classification Details'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Detailed AI classification reasoning'),
      ).not.toBeInTheDocument();
    });

    it('does not expose classification reasoning to editors in reader mode', () => {
      render(
        <ReaderView
          data={createMockData({
            canEdit: true,
            canAdmin: false,
            item: createMockItem({
              classification_reasoning: 'AI reasoning text should be hidden',
            }),
          })}
          relatedItems={[]}
        />,
      );
      expect(
        screen.queryByText('AI reasoning text should be hidden'),
      ).not.toBeInTheDocument();
    });

    it('relationships section remains collapsible', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(
        screen.getByTestId('collapsible-relationships'),
      ).toBeInTheDocument();
    });

    it('metadata sidebar remains collapsible', () => {
      render(<ReaderView data={createMockData()} relatedItems={[]} />);
      expect(screen.getByTestId('collapsible-metadata')).toBeInTheDocument();
    });
  });

  describe('freshness and metadata display', () => {
    it('displays FreshnessBadge when freshness is present', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ freshness: 'fresh' }),
          })}
          relatedItems={[]}
        />,
      );
      const badge = screen.getByTestId('freshness-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('data-freshness', 'fresh');
    });

    it('renders VerificationBadge for verified items', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ verified_at: '2026-01-20T10:00:00Z' }),
          })}
          relatedItems={[]}
        />,
      );
      const badge = screen.getByTestId('verification-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('data-verified', 'true');
    });

    it('renders VerificationBadge as unverified when verified_at is null', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ verified_at: undefined }),
          })}
          relatedItems={[]}
        />,
      );
      const badge = screen.getByTestId('verification-badge');
      expect(badge).toBeInTheDocument();
      expect(badge).toHaveAttribute('data-verified', 'false');
    });

    it('displays updated date when present', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ updated_at: '2026-01-15T10:00:00Z' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByText(/Updated/)).toBeInTheDocument();
    });

    it('displays source document when present', () => {
      render(
        <ReaderView
          data={createMockData({
            item: createMockItem({ source_file: 'Company Policy v2.1' }),
          })}
          relatedItems={[]}
        />,
      );
      expect(screen.getByText('Company Policy v2.1')).toBeInTheDocument();
    });
  });
});
