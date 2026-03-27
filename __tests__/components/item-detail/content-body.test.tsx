/**
 * ContentBody Component Tests
 *
 * Tests the main content body within the item detail page — content type header,
 * AI processing indicators, Q&A display, content tabs, table of contents,
 * draft toggle, and vision analysis.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockIsFeatureEnabled, mockCreateClient } = vi.hoisted(() => ({
  mockIsFeatureEnabled: vi.fn((f: string) => f === 'draft_status'),
  mockCreateClient: vi.fn(() => ({
    from: () => ({ update: () => ({ eq: () => Promise.resolve({ error: null }) }) }),
  })),
}));

vi.mock('@/lib/client-config', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: mockCreateClient,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
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
    <div data-testid="content-type-header" data-content-type={props.contentType}>
      ContentTypeHeader
    </div>
  ),
}));

vi.mock('@/components/shared/ai-processing-indicators', () => ({
  AiProcessingIndicators: () => (
    <div data-testid="ai-processing-indicators">AiProcessingIndicators</div>
  ),
}));

vi.mock('@/components/qa/qa-answer-display', () => ({
  QAAnswerDisplay: () => (
    <div data-testid="qa-answer-display">QAAnswerDisplay</div>
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
    ai_summary: null,
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

function createDefaultProps(overrides: Partial<ContentBodyProps> = {}): ContentBodyProps {
  return {
    item: createMockItem(),
    setItem: vi.fn(),
    isQAPair: false,
    canEdit: false,
    contentTabsElement: <div data-testid="content-tabs">Content Tabs</div>,
    isEditing: false,
    editStandard: '',
    editAdvanced: '',
    setEditStandard: vi.fn(),
    setEditAdvanced: vi.fn(),
    setEditDirty: vi.fn(),
    handleCopyAnswer: vi.fn(),
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
    mockIsFeatureEnabled.mockImplementation((f: string) => f === 'draft_status');
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

  it('shows AiProcessingIndicators when canEdit is true, content exists, and not QA pair', () => {
    const props = createDefaultProps({
      canEdit: true,
      isQAPair: false,
      item: createMockItem({ content: 'Some content' }),
    });
    render(<ContentBody {...props} />);
    expect(screen.getByTestId('ai-processing-indicators')).toBeInTheDocument();
  });

  it('hides AiProcessingIndicators when isQAPair is true', () => {
    const props = createDefaultProps({
      canEdit: true,
      isQAPair: true,
      item: createMockItem({ content: 'Some content' }),
    });
    render(<ContentBody {...props} />);
    expect(screen.queryByTestId('ai-processing-indicators')).not.toBeInTheDocument();
  });

  it('renders QAAnswerDisplay when isQAPair is true', () => {
    const props = createDefaultProps({ isQAPair: true });
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
    expect(screen.getByRole('button', { name: /click to draft/i })).toBeInTheDocument();
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
    expect(screen.getByText('This document contains charts and tables.')).toBeInTheDocument();
  });
});
