/**
 * Review Assignment Banner Tests
 *
 * Tests the assignment banner in ReviewContent — visibility when an active
 * assignment exists, hidden when null, "Clear filters" button behaviour,
 * due date display, and notes rendering.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseReviewQueue } = vi.hoisted(() => {
  const makeDefaultItem = () => ({
    id: 'item-1',
    title: 'Test Review Item',
    suggested_title: null,
    ai_summary: null,
    primary_domain: 'Corporate',
    primary_subtopic: 'Company History',
    content_type: 'article',
    platform: 'web',
    author_name: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    ai_keywords: null,
    classification_confidence: 0.85,
    priority: null,
    freshness: 'fresh',
    user_tags: null,
    governance_review_status: null,
    metadata: null,
    content: 'Test content body.',
    source_url: null,
    verified_at: null,
    verified_by: null,
    secondary_domain: null,
    secondary_subtopic: null,
    quality_score: null,
  });

  return {
    mockUseReviewQueue: vi.fn(() => ({
      queue: [makeDefaultItem()],
      currentIndex: 0,
      isLoading: false,
      isActioning: false,
      hasMore: false,
      progress: { verified: 10, flagged: 2, skipped: 1, total: 50, sessionReviewed: 5 },
      filters: { status: 'unverified' as const },
      stats: { total: 50, verified: 10, flagged: 2, unverified: 38, draft: 0, by_domain: {}, by_content_type: {}, by_source_file: {} },
      showFlagInput: false,
      flagDetails: '',
      showQueuePanel: false,
      queueSort: 'default' as const,
      announcement: '',
      activeAssignment: null,
      cardRef: { current: null },
      flagInputRef: { current: null },
      currentItem: makeDefaultItem(),
      sortedQueue: [makeDefaultItem()],
      currentSortedIndex: 0,
      handleSelectItem: vi.fn(),
      handleVerify: vi.fn().mockResolvedValue(undefined),
      handlePublish: vi.fn().mockResolvedValue(undefined),
      handleFlagSubmit: vi.fn().mockResolvedValue(undefined),
      handleFlag: vi.fn(),
      handleSkip: vi.fn(),
      handleBack: vi.fn(),
      handleExit: vi.fn(),
      handleEdit: vi.fn(),
      handleFiltersChange: vi.fn(),
      handleTogglePanel: vi.fn(),
      setShowFlagInput: vi.fn(),
      setFlagDetails: vi.fn(),
      setFilters: vi.fn(),
      setQueueSort: vi.fn(),
      showHelp: false,
      setShowHelp: vi.fn(),
    })),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/review',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('@/hooks/review/use-review-queue', () => ({
  useReviewQueue: () => mockUseReviewQueue(),
}));

vi.mock('@/hooks/review/use-review-history', () => ({
  useReviewHistory: () => ({ history: [], isLoading: false }),
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}));

// Stub child components to isolate banner tests
vi.mock('@/components/review/review-card', () => ({
  ReviewCard: vi.fn().mockImplementation(
    ({ item, position, total }: { item: { title: string }; position: number; total: number }) => (
      <div data-testid="review-card">ReviewCard: {item.title} ({position}/{total})</div>
    ),
  ),
}));

vi.mock('@/components/review/review-action-bar', () => ({
  ReviewActionBar: () => <div data-testid="review-action-bar">ActionBar</div>,
}));

vi.mock('@/components/review/review-progress-bar', () => ({
  ReviewProgressBar: () => <div data-testid="review-progress-bar">ProgressBar</div>,
}));

vi.mock('@/components/review/review-filters', () => ({
  ReviewFilters: () => <div data-testid="review-filters">Filters</div>,
}));

vi.mock('@/components/review/review-queue-panel', () => ({
  ReviewQueuePanel: () => <div data-testid="review-queue-panel">QueuePanel</div>,
}));

vi.mock('@/components/review/review-cadence-card', () => ({
  ReviewCadenceCard: () => <div data-testid="review-cadence-card">CadenceCard</div>,
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    open ? <div data-testid="sheet">{children}</div> : null
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    open ? <div role="dialog">{children}</div> : null
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

vi.mock('@/components/review/review-session-summary', () => ({
  ReviewSessionSummary: () => null,
}));

// Import AFTER mocks
import { ReviewContent } from '@/app/review/review-content';

// ---------------------------------------------------------------------------
// Helper to override hook return values per test
// ---------------------------------------------------------------------------

function setHookReturn(overrides: Record<string, unknown>) {
  const base = mockUseReviewQueue();
  mockUseReviewQueue.mockReturnValue({ ...base, ...overrides });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewContent — assignment banner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default (no assignment)
    mockUseReviewQueue.mockImplementation(() => {
      const defaultItem = {
        id: 'item-1',
        title: 'Test Review Item',
        suggested_title: null,
        ai_summary: null,
        primary_domain: 'Corporate',
        primary_subtopic: 'Company History',
        content_type: 'article',
        platform: 'web',
        author_name: null,
        source_domain: null,
        thumbnail_url: null,
        captured_date: '2026-01-15T10:00:00Z',
        ai_keywords: null,
        classification_confidence: 0.85,
        priority: null,
        freshness: 'fresh',
        user_tags: null,
        governance_review_status: null,
        metadata: null,
        content: 'Test content body.',
        source_url: null,
        verified_at: null,
        verified_by: null,
        secondary_domain: null,
        secondary_subtopic: null,
        quality_score: null,
      };

      return {
        queue: [defaultItem],
        currentIndex: 0,
        isLoading: false,
        isActioning: false,
        hasMore: false,
        progress: { verified: 10, flagged: 2, skipped: 1, total: 50, sessionReviewed: 5 },
        filters: { status: 'unverified' as const },
        stats: { total: 50, verified: 10, flagged: 2, unverified: 38, draft: 0, by_domain: {}, by_content_type: {}, by_source_file: {} },
        showFlagInput: false,
        flagDetails: '',
        showQueuePanel: false,
        queueSort: 'default' as const,
        announcement: '',
        activeAssignment: null,
        cardRef: { current: null },
        flagInputRef: { current: null },
        currentItem: defaultItem,
        sortedQueue: [defaultItem],
        currentSortedIndex: 0,
        handleSelectItem: vi.fn(),
        handleVerify: vi.fn().mockResolvedValue(undefined),
        handlePublish: vi.fn().mockResolvedValue(undefined),
        handleFlagSubmit: vi.fn().mockResolvedValue(undefined),
        handleFlag: vi.fn(),
        handleSkip: vi.fn(),
        handleBack: vi.fn(),
        handleExit: vi.fn(),
        handleEdit: vi.fn(),
        handleFiltersChange: vi.fn(),
        handleTogglePanel: vi.fn(),
        setShowFlagInput: vi.fn(),
        setFlagDetails: vi.fn(),
        setFilters: vi.fn(),
        setQueueSort: vi.fn(),
        showHelp: false,
        setShowHelp: vi.fn(),
      };
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not render assignment banner when activeAssignment is null', () => {
    setHookReturn({ activeAssignment: null });
    render(<ReviewContent />);

    expect(screen.queryByText(/You have a review assignment/)).not.toBeInTheDocument();
  });

  it('renders assignment banner with notes when activeAssignment is present', () => {
    setHookReturn({
      activeAssignment: {
        id: 'assign-1',
        notes: 'Review H&S content before Friday',
        filter_domains: ['Health & Safety'],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 15,
        due_date: null,
      },
    });
    render(<ReviewContent />);

    expect(screen.getByText(/You have a review assignment: Review H&S content before Friday/)).toBeInTheDocument();
  });

  it('renders assignment banner without notes when notes are null', () => {
    setHookReturn({
      activeAssignment: {
        id: 'assign-2',
        notes: null,
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: null,
        due_date: null,
      },
    });
    render(<ReviewContent />);

    expect(screen.getByText('You have a review assignment')).toBeInTheDocument();
  });

  it('displays due date when present on the assignment', () => {
    setHookReturn({
      activeAssignment: {
        id: 'assign-3',
        notes: 'Urgent review',
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: null,
        due_date: '2026-04-01T00:00:00Z',
      },
    });
    render(<ReviewContent />);

    // en-GB date format: DD/MM/YYYY
    expect(screen.getByText(/due 01\/04\/2026/)).toBeInTheDocument();
  });

  it('calls setFilters with default values when "Clear filters" is clicked', async () => {
    const user = userEvent.setup();
    const mockSetFilters = vi.fn();

    setHookReturn({
      activeAssignment: {
        id: 'assign-4',
        notes: 'Check environmental items',
        filter_domains: ['Environmental'],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: 10,
        due_date: null,
      },
      setFilters: mockSetFilters,
    });
    render(<ReviewContent />);

    const clearButton = screen.getByRole('button', { name: /Clear filters/ });
    await user.click(clearButton);

    expect(mockSetFilters).toHaveBeenCalledWith({ status: 'unverified' });
  });

  it('has role="status" on the banner for screen reader accessibility', () => {
    setHookReturn({
      activeAssignment: {
        id: 'assign-5',
        notes: null,
        filter_domains: [],
        filter_content_types: [],
        filter_freshness: [],
        filter_date_from: null,
        filter_date_to: null,
        item_count: null,
        due_date: null,
      },
    });
    render(<ReviewContent />);

    // The banner should have role="status"
    const bannerElement = screen.getByText('You have a review assignment').closest('[role="status"]');
    expect(bannerElement).toBeInTheDocument();
  });
});
