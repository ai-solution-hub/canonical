/**
 * ItemDetailClient Orchestrator Tests
 *
 * Tests that the rewritten orchestrator:
 * - Delegates data to useItemDetailData
 * - Delegates mode to useDetailMode
 * - Passes mode toggle to views
 * - Renders ReaderView in reader mode, EditorView in editor mode
 * - Guards mode switch with unsaved changes confirmation
 * - Passes Shift+D shortcut to useItemDetailShortcuts
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoisted mocks — used inside vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockUseItemDetailData,
  mockUseDetailMode,
  mockUseItemDetailShortcuts,
  mockConfirm,
} = vi.hoisted(() => ({
  mockUseItemDetailData: vi.fn(),
  mockUseDetailMode: vi.fn(),
  mockUseItemDetailShortcuts: vi.fn(),
  mockConfirm: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-item-detail-data', () => ({
  useItemDetailData: mockUseItemDetailData,
}));

vi.mock('@/hooks/use-detail-mode', () => ({
  useDetailMode: mockUseDetailMode,
}));

vi.mock('@/hooks/use-item-detail-shortcuts', () => ({
  useItemDetailShortcuts: mockUseItemDetailShortcuts,
}));

// Stub views
vi.mock('@/components/item-detail/reader-view', () => ({
  ReaderView: ({ detailModeToggle, onModeToggle }: { detailModeToggle?: React.ReactNode; onModeToggle?: () => void }) => (
    <div data-testid="reader-view">
      {detailModeToggle && <div data-testid="reader-mode-toggle">{detailModeToggle}</div>}
      {onModeToggle && <button data-testid="reader-toggle-btn" onClick={onModeToggle}>Toggle</button>}
    </div>
  ),
}));

vi.mock('@/components/item-detail/editor-view', () => ({
  EditorView: ({ detailModeToggle, onModeToggle }: { detailModeToggle?: React.ReactNode; onModeToggle?: () => void }) => (
    <div data-testid="editor-view">
      {detailModeToggle && <div data-testid="editor-mode-toggle">{detailModeToggle}</div>}
      {onModeToggle && <button data-testid="editor-toggle-btn" onClick={onModeToggle}>Toggle</button>}
    </div>
  ),
}));

vi.mock('@/components/item-detail/detail-mode-toggle', () => ({
  DetailModeToggle: ({ detailMode, onToggle }: { detailMode: string; onToggle: () => void }) => (
    <button data-testid="detail-mode-toggle" data-mode={detailMode} onClick={onToggle}>
      {detailMode}
    </button>
  ),
}));

// Stub layout components
vi.mock('react-resizable-panels', () => ({
  Panel: ({ children }: { children: React.ReactNode }) => <div data-testid="panel">{children}</div>,
  Group: ({ children }: { children: React.ReactNode }) => <div data-testid="panel-group">{children}</div>,
  Separator: () => <div data-testid="panel-separator" />,
}));

vi.mock('@/components/reader/floating-reader', () => ({
  FloatingReader: () => <div data-testid="floating-reader" />,
}));

vi.mock('@/components/reader/reader-panel', () => ({
  ReaderPanel: () => <div data-testid="reader-panel" />,
}));

vi.mock('@/components/shared/error-boundary', () => ({
  ErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { ItemDetailClient } from '@/app/item/[id]/item-detail-client';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: null,
    content: 'Some content',
    ai_summary: null,
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
    metadata: {},
    ...overrides,
  };
}

function createMockData(overrides: Record<string, unknown> = {}) {
  return {
    item: createMockItem(),
    setItem: vi.fn(),
    title: 'Test Item',
    isQAPair: false,
    hasReaderContent: false,
    transcriptChapters: undefined,
    visionAnalysis: undefined,
    isMobile: false,
    canEdit: true,
    canAdmin: false,
    router: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() },
    toggleRead: vi.fn(),
    segments: null,
    highlights: null,
    fontSize: 'medium',
    maxWidth: 'medium',
    panelLayout: {},
    readerOpen: false,
    isDetached: false,
    detachedPosition: null,
    detachedSize: null,
    setFontSize: vi.fn(),
    setMaxWidth: vi.fn(),
    setPanelLayout: vi.fn(),
    setReaderOpen: vi.fn(),
    toggleReader: vi.fn(),
    toggleDetached: vi.fn(),
    setDetachedPosition: vi.fn(),
    setDetachedSize: vi.fn(),
    showSplitReader: false,
    inlineEdit: { editingField: null, editValue: '', saveSuccess: null, saveAnnouncement: '', startEdit: vi.fn(), cancelEdit: vi.fn(), saveEdit: vi.fn(), setEditValue: vi.fn() },
    qaEditMode: {
      isEditing: false,
      setIsEditing: vi.fn(),
      editDirty: false,
      setEditDirty: vi.fn(),
      editTitle: '',
      setEditTitle: vi.fn(),
      editStandard: '',
      setEditStandard: vi.fn(),
      editAdvanced: '',
      setEditAdvanced: vi.fn(),
      isSavingTab: false,
      setIsSavingTab: vi.fn(),
      enterEditMode: vi.fn(),
      cancelEditMode: vi.fn(),
      handleSaveAll: vi.fn(),
    },
    isAnalysing: false,
    handleVisionAnalysis: vi.fn(),
    qaProvenance: { usedInWorkspaces: [], relatedQA: [], topicLayers: [], handleLayerChange: vi.fn() },
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
    relatedItems: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Default data mock
  mockUseItemDetailData.mockReturnValue(createMockData());

  // Default mode mock — editor mode
  mockUseDetailMode.mockReturnValue({
    detailMode: 'editor',
    setDetailMode: vi.fn(),
    toggleDetailMode: vi.fn(),
    isReaderMode: false,
    isEditorMode: true,
    canToggle: true,
  });

  // Shortcuts mock — no-op
  mockUseItemDetailShortcuts.mockReturnValue(undefined);

  // Stub window.confirm
  vi.stubGlobal('confirm', mockConfirm);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemDetailClient (orchestrator)', () => {
  describe('mode-based rendering', () => {
    it('renders EditorView when in editor mode', () => {
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('editor-view')).toBeInTheDocument();
      expect(screen.queryByTestId('reader-view')).not.toBeInTheDocument();
    });

    it('renders ReaderView when in reader mode', () => {
      mockUseDetailMode.mockReturnValue({
        detailMode: 'reader',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: true,
        isEditorMode: false,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('reader-view')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-view')).not.toBeInTheDocument();
    });

    it('renders ReaderView for viewer users (canEdit=false)', () => {
      mockUseItemDetailData.mockReturnValue(createMockData({ canEdit: false }));
      mockUseDetailMode.mockReturnValue({
        detailMode: 'reader',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: true,
        isEditorMode: false,
        canToggle: false,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('reader-view')).toBeInTheDocument();
      expect(screen.queryByTestId('editor-view')).not.toBeInTheDocument();
    });
  });

  describe('detail mode toggle slot', () => {
    it('passes DetailModeToggle to EditorView when canToggle is true', () => {
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('editor-mode-toggle')).toBeInTheDocument();
      expect(screen.getByTestId('detail-mode-toggle')).toBeInTheDocument();
    });

    it('passes DetailModeToggle to ReaderView when canToggle is true', () => {
      mockUseDetailMode.mockReturnValue({
        detailMode: 'reader',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: true,
        isEditorMode: false,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('reader-mode-toggle')).toBeInTheDocument();
    });

    it('does not render DetailModeToggle when canToggle is false (viewer)', () => {
      mockUseItemDetailData.mockReturnValue(createMockData({ canEdit: false }));
      mockUseDetailMode.mockReturnValue({
        detailMode: 'reader',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: true,
        isEditorMode: false,
        canToggle: false,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.queryByTestId('detail-mode-toggle')).not.toBeInTheDocument();
    });
  });

  describe('unsaved changes guard', () => {
    it('shows confirm dialog when switching from editor with dirty edits', () => {
      const mockToggle = vi.fn();
      const mockCancelEditMode = vi.fn();
      mockUseItemDetailData.mockReturnValue(
        createMockData({
          qaEditMode: {
            isEditing: true,
            setIsEditing: vi.fn(),
            editDirty: true,
            setEditDirty: vi.fn(),
            editTitle: 'Edited',
            setEditTitle: vi.fn(),
            editStandard: '',
            setEditStandard: vi.fn(),
            editAdvanced: '',
            setEditAdvanced: vi.fn(),
            isSavingTab: false,
            setIsSavingTab: vi.fn(),
            enterEditMode: vi.fn(),
            cancelEditMode: mockCancelEditMode,
            handleSaveAll: vi.fn(),
          },
        }),
      );
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: mockToggle,
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });
      mockConfirm.mockReturnValue(true);

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      // Click the toggle
      act(() => {
        screen.getByTestId('editor-toggle-btn').click();
      });

      expect(mockConfirm).toHaveBeenCalledWith(
        'You have unsaved changes. Discard and switch to reader mode?',
      );
      expect(mockCancelEditMode).toHaveBeenCalledOnce();
      expect(mockToggle).toHaveBeenCalledOnce();
    });

    it('cancels mode switch when user declines confirm', () => {
      const mockToggle = vi.fn();
      mockUseItemDetailData.mockReturnValue(
        createMockData({
          qaEditMode: {
            isEditing: true,
            setIsEditing: vi.fn(),
            editDirty: true,
            setEditDirty: vi.fn(),
            editTitle: 'Edited',
            setEditTitle: vi.fn(),
            editStandard: '',
            setEditStandard: vi.fn(),
            editAdvanced: '',
            setEditAdvanced: vi.fn(),
            isSavingTab: false,
            setIsSavingTab: vi.fn(),
            enterEditMode: vi.fn(),
            cancelEditMode: vi.fn(),
            handleSaveAll: vi.fn(),
          },
        }),
      );
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: mockToggle,
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });
      mockConfirm.mockReturnValue(false);

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      act(() => {
        screen.getByTestId('editor-toggle-btn').click();
      });

      expect(mockConfirm).toHaveBeenCalled();
      expect(mockToggle).not.toHaveBeenCalled();
    });

    it('does not show confirm when edits are not dirty', () => {
      const mockToggle = vi.fn();
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: mockToggle,
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      act(() => {
        screen.getByTestId('editor-toggle-btn').click();
      });

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockToggle).toHaveBeenCalledOnce();
    });
  });

  describe('keyboard shortcuts integration', () => {
    it('passes detailMode and toggleDetailMode to useItemDetailShortcuts', () => {
      mockUseDetailMode.mockReturnValue({
        detailMode: 'editor',
        setDetailMode: vi.fn(),
        toggleDetailMode: vi.fn(),
        isReaderMode: false,
        isEditorMode: true,
        canToggle: true,
      });

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(mockUseItemDetailShortcuts).toHaveBeenCalledWith(
        expect.objectContaining({
          detailMode: 'editor',
          toggleDetailMode: expect.any(Function),
        }),
      );
    });
  });

  describe('split reader panel', () => {
    it('renders split reader panel when showSplitReader is true', () => {
      mockUseItemDetailData.mockReturnValue(
        createMockData({
          showSplitReader: true,
          readerOpen: true,
          isDetached: false,
          panelLayout: { detail: 55, reader: 45 },
        }),
      );

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      // The panel group should contain the reader panel
      expect(screen.getByTestId('reader-panel')).toBeInTheDocument();
    });

    it('renders floating reader when readerOpen and isDetached', () => {
      mockUseItemDetailData.mockReturnValue(
        createMockData({
          readerOpen: true,
          isDetached: true,
          showSplitReader: false,
        }),
      );

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.getByTestId('floating-reader')).toBeInTheDocument();
    });

    it('does not render floating reader when not open', () => {
      mockUseItemDetailData.mockReturnValue(
        createMockData({
          readerOpen: false,
          isDetached: false,
          showSplitReader: false,
        }),
      );

      render(<ItemDetailClient item={createMockItem()} relatedItems={[]} />);

      expect(screen.queryByTestId('floating-reader')).not.toBeInTheDocument();
    });
  });

  describe('exports', () => {
    it('exports ItemData interface (used by many files)', async () => {
      const mod = await import('@/app/item/[id]/item-detail-client');
      // Type-level check — if this compiles, ItemData is exported
      const fn: typeof mod.ItemDetailClient = mod.ItemDetailClient;
      expect(fn).toBeDefined();
    });
  });
});
