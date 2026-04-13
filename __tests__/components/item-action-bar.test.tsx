/**
 * ItemActionBar Component Tests
 *
 * Tests role-based rendering — viewers see a read-focused action bar
 * (ReadToggle + Copy + overflow menu) while editors see the full set
 * of controls (Star, Priority, Edit, Visual Analysis, Delete).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

// Stub heavy child components
vi.mock('@/components/shared/read-toggle-button', () => ({
  ReadToggleButton: ({ itemId }: { itemId: string }) => (
    <button data-testid="read-toggle" data-item-id={itemId}>
      Read
    </button>
  ),
}));

vi.mock('@/components/shared/star-button', () => ({
  StarButton: ({ itemId }: { itemId: string }) => (
    <button data-testid="star-button" data-item-id={itemId}>
      Star
    </button>
  ),
}));

vi.mock('@/components/shared/priority-selector', () => ({
  PrioritySelector: ({ itemId }: { itemId: string }) => (
    <button data-testid="priority-selector" data-item-id={itemId}>
      Priority
    </button>
  ),
}));

vi.mock('@/components/content/delete-content-dialog', () => ({
  DeleteContentDialog: ({ itemId }: { itemId: string }) => (
    <div data-testid="delete-dialog" data-item-id={itemId} />
  ),
}));

vi.mock('next/dynamic', () => ({
  default: () => {
    const Stub = () => <div data-testid="pdf-viewer" />;
    Stub.displayName = 'DynamicPdfViewer';
    return Stub;
  },
}));

import {
  ItemActionBar,
  type ItemActionBarProps,
} from '@/components/item-detail/item-action-bar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultItem(): ItemActionBarProps['item'] {
  return {
    id: 'item-1',
    title: 'Test Item',
    suggested_title: null,
    content: 'Some content here',
    summary: null,
    ai_keywords: null,
    primary_domain: 'policy',
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: null,
    author_name: null,
    source_url: 'https://example.com/article',
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
    metadata: { reader_html: '<p>Reader content</p>' },
  };
}

function createProps(
  overrides: Partial<ItemActionBarProps> = {},
): ItemActionBarProps {
  return {
    item: createDefaultItem(),
    canEdit: true,
    canAdmin: false,
    isEditing: false,
    isQAPair: false,
    isAnalysing: false,
    copied: false,
    hasReaderContent: true,
    title: 'Test Item',
    readerOpen: false,
    enterEditMode: vi.fn(),
    cancelEditMode: vi.fn(),
    handleCopyLink: vi.fn(),
    handleCopyAnswer: vi.fn(),
    handleVisionAnalysis: vi.fn(),
    toggleReader: vi.fn(),
    setItem: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemActionBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Editor role — full controls
  // -------------------------------------------------------------------------

  describe('editor role (canEdit=true)', () => {
    it('renders ReadToggle', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(screen.getByTestId('read-toggle')).toBeInTheDocument();
    });

    it('renders Edit button', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
    });

    it('renders Star button', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(screen.getByTestId('star-button')).toBeInTheDocument();
    });

    it('renders Priority selector', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(screen.getByTestId('priority-selector')).toBeInTheDocument();
    });

    it('renders Copy content button', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(
        screen.getByRole('button', { name: /copy content/i }),
      ).toBeInTheDocument();
    });

    it('renders overflow menu', () => {
      render(<ItemActionBar {...createProps({ canEdit: true })} />);
      expect(
        screen.getByRole('button', { name: /more actions/i }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Viewer role — read-focused controls only
  // -------------------------------------------------------------------------

  describe('viewer role (canEdit=false)', () => {
    it('renders ReadToggle for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(screen.getByTestId('read-toggle')).toBeInTheDocument();
    });

    it('does not render Edit button for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(
        screen.queryByRole('button', { name: /^edit$/i }),
      ).not.toBeInTheDocument();
    });

    it('does not render Star button for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(screen.queryByTestId('star-button')).not.toBeInTheDocument();
    });

    it('does not render Priority selector for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(screen.queryByTestId('priority-selector')).not.toBeInTheDocument();
    });

    it('renders Copy content button for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(
        screen.getByRole('button', { name: /copy content/i }),
      ).toBeInTheDocument();
    });

    it('renders overflow menu for viewers', () => {
      render(<ItemActionBar {...createProps({ canEdit: false })} />);
      expect(
        screen.getByRole('button', { name: /more actions/i }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Admin role — delete control
  // -------------------------------------------------------------------------

  describe('admin role (canAdmin=true)', () => {
    it('renders hidden delete dialog for admins', () => {
      render(
        <ItemActionBar {...createProps({ canEdit: true, canAdmin: true })} />,
      );
      expect(screen.getByTestId('delete-dialog')).toBeInTheDocument();
    });

    it('does not render delete dialog for non-admins', () => {
      render(
        <ItemActionBar {...createProps({ canEdit: true, canAdmin: false })} />,
      );
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Q&A pair variant
  // -------------------------------------------------------------------------

  describe('Q&A pair variant', () => {
    it('renders copy answer dropdown for Q&A pairs', () => {
      render(<ItemActionBar {...createProps({ isQAPair: true })} />);
      expect(
        screen.getByRole('button', { name: /copy answer/i }),
      ).toBeInTheDocument();
    });

    it('renders copy content button for non-Q&A items', () => {
      render(<ItemActionBar {...createProps({ isQAPair: false })} />);
      expect(
        screen.getByRole('button', { name: /copy content/i }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Visual Analysis gating
  // -------------------------------------------------------------------------

  describe('Visual Analysis gating', () => {
    it('does not show Visual Analysis in overflow for viewers on PDFs', async () => {
      const user = userEvent.setup();
      const item = createDefaultItem();
      item.content_type = 'pdf';
      item.source_url = 'https://example.com/test.pdf';

      render(<ItemActionBar {...createProps({ canEdit: false, item })} />);

      // Open overflow menu
      await user.click(screen.getByRole('button', { name: /more actions/i }));

      // Visual Analysis should not appear for viewers
      expect(screen.queryByText(/visual analysis/i)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // isReaderMode prop — hides editing actions
  // -------------------------------------------------------------------------

  describe('isReaderMode prop', () => {
    it('hides Edit button when isReaderMode=true even for editors', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(
        screen.queryByRole('button', { name: /^edit$/i }),
      ).not.toBeInTheDocument();
    });

    it('hides Star button when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(screen.queryByTestId('star-button')).not.toBeInTheDocument();
    });

    it('hides Priority selector when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(screen.queryByTestId('priority-selector')).not.toBeInTheDocument();
    });

    it('still shows ReadToggle when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(screen.getByTestId('read-toggle')).toBeInTheDocument();
    });

    it('still shows Copy content button when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(
        screen.getByRole('button', { name: /copy content/i }),
      ).toBeInTheDocument();
    });

    it('still shows overflow menu when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true })}
        />,
      );
      expect(
        screen.getByRole('button', { name: /more actions/i }),
      ).toBeInTheDocument();
    });

    it('hides Visual Analysis in overflow when isReaderMode=true', async () => {
      const user = userEvent.setup();
      const item = createDefaultItem();
      item.content_type = 'pdf';
      item.source_url = 'https://example.com/test.pdf';

      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: true, item })}
        />,
      );

      await user.click(screen.getByRole('button', { name: /more actions/i }));

      expect(screen.queryByText(/visual analysis/i)).not.toBeInTheDocument();
    });

    it('hides Delete in overflow for admin when isReaderMode=true', () => {
      render(
        <ItemActionBar
          {...createProps({
            canEdit: true,
            canAdmin: true,
            isReaderMode: true,
          })}
        />,
      );
      expect(screen.queryByTestId('delete-dialog')).not.toBeInTheDocument();
    });

    it('shows all editing actions when isReaderMode=false (default)', () => {
      render(
        <ItemActionBar
          {...createProps({ canEdit: true, isReaderMode: false })}
        />,
      );
      expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument();
      expect(screen.getByTestId('star-button')).toBeInTheDocument();
      expect(screen.getByTestId('priority-selector')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // detailModeToggle slot
  // -------------------------------------------------------------------------

  describe('detailModeToggle slot', () => {
    it('renders detailModeToggle at the start of the action bar when provided', () => {
      const toggle = <button data-testid="mode-toggle">Toggle</button>;
      render(<ItemActionBar {...createProps({ detailModeToggle: toggle })} />);
      expect(screen.getByTestId('mode-toggle')).toBeInTheDocument();
    });

    it('does not render detailModeToggle when not provided', () => {
      render(
        <ItemActionBar {...createProps({ detailModeToggle: undefined })} />,
      );
      expect(screen.queryByTestId('mode-toggle')).not.toBeInTheDocument();
    });
  });
});
