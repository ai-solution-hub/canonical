/**
 * ContentBody Component Tests
 *
 * Tests the main content body within the item detail page — content type header,
 * AI processing indicators, Q&A display, content tabs, table of contents,
 * draft toggle, and vision analysis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockIsFeatureEnabled,
  mockCreateClient,
  mockCaptureClientException,
  mockToastError,
  mockToastSuccess,
  mockUpdateEq,
} = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn((f: string) => f === 'draft_status'),
  mockUpdateEq: vi.fn(() => Promise.resolve({ error: null })),
  mockCreateClient: vi.fn(),
  mockCaptureClientException: vi.fn(),
  mockToastError: vi.fn(),
  mockToastSuccess: vi.fn(),
}));

mockCreateClient.mockImplementation(() => ({
  from: () => ({
    update: () => ({ eq: mockUpdateEq }),
  }),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

vi.mock('@/lib/client-telemetry', () => ({
  captureClientException: mockCaptureClientException,
}));

vi.mock('sonner', () => ({
  toast: {
    success: mockToastSuccess,
    error: mockToastError,
    info: vi.fn(),
  },
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const MockComponent = () => <div data-testid="image-gallery" />;
    MockComponent.displayName = 'MockImageGallery';
    return MockComponent;
  },
}));

vi.mock('@/components/shared/content-type-header', () => ({
  ContentTypeHeader: (props: Record<string, unknown>) => (
    <div
      data-testid="content-type-header"
      data-content-type={props.contentType}
    >
      ContentTypeHeader
    </div>
  ),
}));

vi.mock('@/components/content/content-layer-selector', () => ({
  ContentLayerSelector: () => (
    <div data-testid="content-layer-selector">ContentLayerSelector</div>
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

import { ContentBody } from '@/components/item-detail/content-body';
import type { ContentBodyProps } from '@/components/item-detail/content-body';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: null,
    content: 'Some content body',
    summary: null,
    ai_keywords: null,
    primary_domain: 'Corporate',
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: 'web',
    author_name: 'Author',
    source_url: 'https://example.com',
    file_path: null,
    source_domain: 'example.com',
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

function createDefaultProps(
  overrides: Partial<ContentBodyProps> = {},
): ContentBodyProps {
  return {
    item: createMockItem(),
    setItem: vi.fn(),
    isQAPair: false,
    canEdit: false,
    contentTabsElement: <div data-testid="content-tabs">Content Tabs</div>,
    visionAnalysis: undefined,
    transcriptChapters: undefined,
    segments: null,
    highlights: null,
    handleLayerChange: vi.fn(),
    getActiveTabContent: () => '',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockImplementation(
      (f: string) => f === 'draft_status',
    );
    mockUpdateEq.mockImplementation(() => Promise.resolve({ error: null }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders ContentTypeHeader with item props', () => {
    const props = createDefaultProps();
    render(<ContentBody {...props} />);
    const header = screen.getByTestId('content-type-header');
    expect(header).toBeInTheDocument();
    expect(header).toHaveAttribute('data-content-type', 'article');
  });

  it('renders qaAnswerElement when isQAPair is true and qaAnswerElement provided', () => {
    const props = createDefaultProps({
      isQAPair: true,
      qaAnswerElement: (
        <div data-testid="qa-answer-display">QAAnswerDisplay</div>
      ),
    });
    render(<ContentBody {...props} />);
    expect(screen.getByTestId('qa-answer-display')).toBeInTheDocument();
    expect(screen.queryByTestId('content-tabs')).not.toBeInTheDocument();
  });

  it('renders contentTabsElement when not QA pair', () => {
    const props = createDefaultProps({ isQAPair: false });
    render(<ContentBody {...props} />);
    expect(screen.getByTestId('content-tabs')).toBeInTheDocument();
    expect(screen.queryByTestId('qa-answer-display')).not.toBeInTheDocument();
  });

  it('shows TableOfContents for non-QA items', () => {
    const props = createDefaultProps({ isQAPair: false });
    render(<ContentBody {...props} />);
    expect(screen.getByTestId('table-of-contents')).toBeInTheDocument();
  });

  it('renders draft toggle when draft_status feature enabled and canEdit is true', () => {
    const props = createDefaultProps({ canEdit: true });
    render(<ContentBody {...props} />);
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /click to draft/i }),
    ).toBeInTheDocument();
  });

  it('shows vision analysis section when visionAnalysis is provided', () => {
    const props = createDefaultProps({
      visionAnalysis: {
        analysis: 'This document contains charts and tables.',
        analysed_at: '2026-01-15T12:00:00Z',
        model: 'claude-3',
        tokens_used: 1500,
      },
    });
    render(<ContentBody {...props} />);
    expect(screen.getByText('Visual Analysis')).toBeInTheDocument();
    expect(
      screen.getByText('This document contains charts and tables.'),
    ).toBeInTheDocument();
  });

  describe('Draft toggle through PATCH', () => {
    it('calls saveEdit with governance_review_status when saveEdit is provided', async () => {
      const mockSaveEdit = vi.fn().mockResolvedValue(undefined);
      const props = createDefaultProps({
        canEdit: true,
        saveEdit: mockSaveEdit,
        item: createMockItem({ governance_review_status: null }),
      });
      render(<ContentBody {...props} />);

      const toggle = screen.getByRole('button', { name: /click to draft/i });
      await userEvent.click(toggle);

      await waitFor(() => {
        expect(mockSaveEdit).toHaveBeenCalledWith(
          'governance_review_status',
          'draft',
          'Marked as draft',
        );
      });
    });

    it('calls saveEdit to publish when item is draft', async () => {
      const mockSaveEdit = vi.fn().mockResolvedValue(undefined);
      const props = createDefaultProps({
        canEdit: true,
        saveEdit: mockSaveEdit,
        item: createMockItem({ governance_review_status: 'draft' }),
      });
      render(<ContentBody {...props} />);

      const toggle = screen.getByRole('button', { name: /click to publish/i });
      await userEvent.click(toggle);

      await waitFor(() => {
        expect(mockSaveEdit).toHaveBeenCalledWith(
          'governance_review_status',
          null,
          'Published from draft',
        );
      });
    });
  });
});
