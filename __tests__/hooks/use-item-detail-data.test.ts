/**
 * useItemDetailData Hook Tests
 *
 * Tests the shared data hook that extracts all state/data/mutations
 * from item-detail-client.tsx. Verifies:
 * - All expected fields are returned
 * - Loading/error states propagate correctly
 * - Item state management (star toggle, priority cycle, copy handlers)
 * - Sub-hook composition (inline edit, Q&A edit, vision analysis, provenance)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockToast,
  mockRouter,
  mockToggleRead,
  mockLoadReadMarks,
  mockCheckReadStatus,
} = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    refresh: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  },
  mockToggleRead: vi.fn(),
  mockLoadReadMarks: vi.fn(),
  mockCheckReadStatus: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
}));

vi.mock('@/contexts/read-marks-context', () => ({
  useReadMarks: () => ({
    toggleRead: mockToggleRead,
    loadReadMarks: mockLoadReadMarks,
    checkReadStatus: mockCheckReadStatus,
  }),
}));

vi.mock('@/hooks/use-transcript', () => ({
  useTranscript: () => ({
    segments: null,
    highlights: null,
    isExtractingHighlights: false,
    extractHighlights: vi.fn(),
    handleHighlightStarToggle: vi.fn(),
    setSegments: vi.fn(),
  }),
}));

vi.mock('@/hooks/ui/use-reader-preferences', () => ({
  useReaderPreferences: () => ({
    fontSize: 'medium',
    maxWidth: 'medium',
    panelLayout: {},
    readerOpen: false,
    setFontSize: vi.fn(),
    setMaxWidth: vi.fn(),
    setPanelLayout: vi.fn(),
    setReaderOpen: vi.fn(),
    toggleReader: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: 'admin',
    loading: false,
    canEdit: true,
    canAdmin: true,
  }),
}));

vi.mock('@/hooks/use-inline-field-edit', () => ({
  useInlineFieldEdit: () => ({
    editingField: null,
    editValue: '',
    saveSuccess: null,
    saveAnnouncement: '',
    isSaving: false,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn(),
    setEditValue: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-vision-analysis', () => ({
  useVisionAnalysis: () => ({
    isAnalysing: false,
    handleVisionAnalysis: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-qa-provenance', () => ({
  useQAProvenance: () => ({
    usedInWorkspaces: [],
    relatedQA: [],
    topicLayers: [],
    handleLayerChange: vi.fn(),
  }),
}));

vi.mock('@/hooks/use-topic-layer-content', () => ({
  useTopicLayerContent: () => ({
    layerContent: {},
    isLoading: false,
  }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
  }),
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

let mockFetch: ReturnType<typeof vi.fn>;
let localStorageStore: Record<string, string>;

import { useItemDetailData } from '@/hooks/use-item-detail-data';
import type { UseItemDetailDataOptions } from '@/hooks/use-item-detail-data';
import type { ItemData } from '@/app/item/[id]/item-detail-client';
import { createMockItem as createMockItemFactory } from '@/__tests__/helpers/factories/components/item';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderItemDetailHook(
  opts: UseItemDetailDataOptions = defaultOptions(),
) {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => useItemDetailData(opts), { wrapper: Wrapper });
}

/**
 * Wrapper around the canonical factory applying this suite's defaults: a
 * fully-classified article with AI summary/keywords and timestamps, so the
 * hook's derived values (title, isQAPair, getActiveTabContent) have realistic
 * inputs.
 */
function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return createMockItemFactory({
    suggested_title: 'Suggested Title',
    content: 'Test content',
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
    user_tags: [],
    freshness: 'fresh',
    classified_at: '2026-01-15T10:00:00Z',
    metadata: {},
    created_at: '2026-01-15T10:00:00Z',
    updated_at: '2026-01-15T10:00:00Z',
    ...overrides,
  });
}

function defaultOptions(
  overrides: Partial<UseItemDetailDataOptions> = {},
): UseItemDetailDataOptions {
  return {
    initialItem: createMockItem(),
    relatedItems: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  localStorageStore = {};

  mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({}),
  });
  vi.stubGlobal('fetch', mockFetch);

  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      localStorageStore[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete localStorageStore[key];
    }),
    clear: vi.fn(),
    length: 0,
    key: vi.fn(),
  });

  // Mock window.matchMedia
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );

  // Mock clipboard
  vi.stubGlobal('navigator', {
    clipboard: {
      writeText: vi.fn().mockResolvedValue(undefined),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useItemDetailData', () => {
  describe('return type completeness', () => {
    it('returns all expected fields', () => {
      const { result } = renderItemDetailHook(defaultOptions());

      // Core item state
      expect(result.current.item).toBeDefined();
      expect(result.current.setItem).toBeInstanceOf(Function);
      expect(result.current.relatedItems).toBeDefined();

      // Derived values
      expect(result.current.title).toBe('Suggested Title');
      expect(result.current.isQAPair).toBe(false);
      expect(result.current.hasReaderContent).toBe(false);
      expect(result.current.transcriptChapters).toBeUndefined();
      expect(result.current.visionAnalysis).toBeUndefined();
      expect(typeof result.current.isMobile).toBe('boolean');

      // Roles
      expect(result.current.canEdit).toBe(true);
      expect(result.current.canAdmin).toBe(true);

      // Router
      expect(result.current.router).toBeDefined();

      // Read marks
      expect(result.current.toggleRead).toBeInstanceOf(Function);

      // Transcript
      expect(result.current.segments).toBeNull();
      expect(result.current.highlights).toBeNull();

      // Reader preferences
      expect(result.current.fontSize).toBe('medium');
      expect(result.current.maxWidth).toBe('medium');
      expect(result.current.panelLayout).toBeDefined();
      expect(typeof result.current.readerOpen).toBe('boolean');
      expect(typeof result.current.showSplitReader).toBe('boolean');

      // Inline edit
      expect(result.current.inlineEdit).toBeDefined();
      expect(result.current.inlineEdit.editingField).toBeNull();

      // Inline edit (isSaving exposed)
      expect(result.current.inlineEdit.isSaving).toBe(false);

      // Vision analysis
      expect(typeof result.current.isAnalysing).toBe('boolean');
      expect(result.current.handleVisionAnalysis).toBeInstanceOf(Function);

      // Q&A provenance
      expect(result.current.qaProvenance).toBeDefined();
      expect(result.current.qaProvenance.usedInWorkspaces).toEqual([]);

      // Topic layer content
      expect(result.current.layerContent).toBeDefined();
      expect(typeof result.current.isLayerContentLoading).toBe('boolean');

      // Copy handlers
      expect(typeof result.current.copied).toBe('boolean');
      expect(result.current.handleCopyLink).toBeInstanceOf(Function);
      expect(result.current.handleCopyAnswer).toBeInstanceOf(Function);

      // Star / priority
      expect(result.current.handleStarToggle).toBeInstanceOf(Function);
      expect(result.current.handlePriorityCycle).toBeInstanceOf(Function);

      // Active tab content
      expect(result.current.getActiveTabContent).toBeInstanceOf(Function);

      // Tab edit config
      expect(result.current.tabEditConfig).toBeDefined();

      // Inline edit helpers
      expect(result.current.startEdit).toBeInstanceOf(Function);
      expect(result.current.cancelEdit).toBeInstanceOf(Function);
      expect(result.current.saveEdit).toBeInstanceOf(Function);
    });
  });

  describe('derived values', () => {
    it('computes title from suggested_title', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            suggested_title: 'My Title',
            title: null,
          }),
        }),
      );

      expect(result.current.title).toBe('My Title');
    });

    it('computes isQAPair correctly for q_a_pair content type', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({ content_type: 'q_a_pair' }),
        }),
      );

      expect(result.current.isQAPair).toBe(true);
    });

    it('computes isQAPair as false for non-Q&A content types', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({ content_type: 'article' }),
        }),
      );

      expect(result.current.isQAPair).toBe(false);
    });

    it('computes hasReaderContent when reader_html exists and not Q&A', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            content_type: 'article',
            metadata: { reader_html: '<p>Content</p>' },
          }),
        }),
      );

      expect(result.current.hasReaderContent).toBe(true);
    });

    it('hasReaderContent is false for Q&A even with reader_html', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            content_type: 'q_a_pair',
            metadata: { reader_html: '<p>Content</p>' },
          }),
        }),
      );

      expect(result.current.hasReaderContent).toBe(false);
    });

    it('extracts transcriptChapters from metadata', () => {
      const chapters = [
        { title: 'Ch 1', word_count: 100, start_seconds: 0, end_seconds: 60 },
      ];
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            metadata: { chapters },
          }),
        }),
      );

      expect(result.current.transcriptChapters).toEqual(chapters);
    });

    it('transcriptChapters is undefined when no chapters in metadata', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({ metadata: {} }),
        }),
      );

      expect(result.current.transcriptChapters).toBeUndefined();
    });
  });

  describe('getActiveTabContent', () => {
    it('returns brief when available', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({ brief: 'Brief content' }),
        }),
      );

      expect(result.current.getActiveTabContent()).toBe('Brief content');
    });

    it('returns executive summary when no brief', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            brief: undefined,
            summary_data: {
              executive: 'Executive summary',
              detailed: '',
              takeaways: [],
              generated_at: '',
              model: '',
            },
          }),
        }),
      );

      expect(result.current.getActiveTabContent()).toBe('Executive summary');
    });

    it('returns summary when no brief or executive', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            brief: undefined,
            summary_data: null,
            summary: 'AI summary',
          }),
        }),
      );

      expect(result.current.getActiveTabContent()).toBe('AI summary');
    });

    it('returns content as last resort', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            brief: undefined,
            summary_data: null,
            summary: null,
            content: 'Raw content',
          }),
        }),
      );

      expect(result.current.getActiveTabContent()).toBe('Raw content');
    });

    it('returns empty string when nothing available', () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            brief: undefined,
            summary_data: null,
            summary: null,
            content: null,
          }),
        }),
      );

      expect(result.current.getActiveTabContent()).toBe('');
    });
  });

  describe('handleCopyLink', () => {
    it('copies current URL to clipboard', async () => {
      vi.stubGlobal('location', { href: 'https://example.com/item/1' });

      const { result } = renderItemDetailHook(defaultOptions());

      await act(async () => {
        await result.current.handleCopyLink();
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'https://example.com/item/1',
      );
    });
  });

  describe('handleCopyAnswer', () => {
    it('copies standard answer', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            answer_standard: 'Standard text',
            answer_advanced: 'Advanced text',
            content: 'Fallback',
          }),
        }),
      );

      await act(async () => {
        await result.current.handleCopyAnswer('standard');
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Standard text',
      );
    });

    it('copies advanced answer', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            answer_standard: 'Standard text',
            answer_advanced: 'Advanced text',
            content: 'Fallback',
          }),
        }),
      );

      await act(async () => {
        await result.current.handleCopyAnswer('advanced');
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Advanced text',
      );
    });

    it('shows success toast for verified items', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            content: 'Some content',
            verified_at: '2026-01-20T10:00:00Z',
          }),
        }),
      );

      await act(async () => {
        await result.current.handleCopyAnswer();
      });

      expect(mockToast.success).toHaveBeenCalledWith('Answer copied');
    });

    it('shows warning toast for unverified items', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            content: 'Some content',
            verified_at: null,
          }),
        }),
      );

      await act(async () => {
        await result.current.handleCopyAnswer();
      });

      expect(mockToast).toHaveBeenCalledWith('Answer copied', {
        description: 'Unverified \u2014 consider reviewing before submitting',
        duration: 4000,
      });
      // success should NOT have been called for unverified
      expect(mockToast.success).not.toHaveBeenCalled();
    });

    it('falls back to content when no variant specified', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({
            content: 'Fallback content',
          }),
        }),
      );

      await act(async () => {
        await result.current.handleCopyAnswer();
      });

      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        'Fallback content',
      );
    });
  });

  describe('handlePriorityCycle', () => {
    it('cycles from null to high', async () => {
      const { result } = renderItemDetailHook(
        defaultOptions({
          initialItem: createMockItem({ priority: null }),
        }),
      );

      await act(async () => {
        await result.current.handlePriorityCycle();
      });

      expect(result.current.item.priority).toBe('high');
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/items/item-1/priority',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ priority: 'high' }),
        }),
      );
    });
  });

  describe('read marks integration', () => {
    it('triggers loadReadMarks on mount', () => {
      renderItemDetailHook(defaultOptions());

      expect(mockLoadReadMarks).toHaveBeenCalled();
    });

    it('triggers checkReadStatus for the item on mount', async () => {
      renderItemDetailHook(defaultOptions());

      await waitFor(() => {
        expect(mockCheckReadStatus).toHaveBeenCalledWith(['item-1']);
      });
    });
  });

  describe('showSplitReader', () => {
    it('is false when reader is closed', () => {
      const { result } = renderItemDetailHook(defaultOptions());

      expect(result.current.showSplitReader).toBe(false);
    });
  });

  describe('tabEditConfig', () => {
    it('is defined when canEdit is true', () => {
      const { result } = renderItemDetailHook(defaultOptions());

      expect(result.current.tabEditConfig).toBeDefined();
      expect(result.current.tabEditConfig?.editingField).toBeNull();
      expect(result.current.tabEditConfig?.isSaving).toBe(false);
    });
  });
});
