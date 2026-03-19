/**
 * ReviewContent Component Tests
 *
 * Tests the ReviewContent component — loading, empty states, batch complete,
 * main review view, flag input, queue panel, keyboard help, accessibility.
 * Delegates all state to useReviewQueue() which is fully mocked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockUseReviewQueue, mockToast } = vi.hoisted(() => {
  const defaultProgress = {
    verified: 10,
    flagged: 2,
    skipped: 1,
    total: 50,
    sessionReviewed: 5,
  };

  const defaultFilters = { status: 'unverified' as const };

  const defaultStats = {
    total: 50,
    verified: 10,
    flagged: 2,
    unverified: 38,
    draft: 0,
    by_domain: {},
    by_content_type: {},
    by_source_file: {},
  };

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
  });

  return {
    mockUseReviewQueue: vi.fn(() => ({
      queue: [makeDefaultItem()],
      currentIndex: 0,
      isLoading: false,
      isActioning: false,
      hasMore: false,
      progress: { ...defaultProgress },
      filters: { ...defaultFilters },
      stats: { ...defaultStats },
      showFlagInput: false,
      flagDetails: '',
      showQueuePanel: false,
      queueSort: 'default' as const,
      announcement: '',
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
    mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
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

vi.mock('@/hooks/use-review-queue', () => ({
  useReviewQueue: () => mockUseReviewQueue(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Stub child components
vi.mock('@/components/review-card', () => ({
  ReviewCard: vi.fn().mockImplementation(
    ({ item, position, total }: { item: { title: string }; position: number; total: number }) => (
      <div data-testid="review-card">ReviewCard: {item.title} ({position}/{total})</div>
    ),
  ),
}));

vi.mock('@/components/review-action-bar', () => ({
  ReviewActionBar: ({ onVerify, onFlag, onSkip, onBack, onExit, onEdit, onPublish, onShowHelp, isDraft }: Record<string, unknown>) => (
    <div data-testid="review-action-bar">
      <button onClick={onVerify as () => void}>Verify</button>
      <button onClick={onFlag as () => void}>Flag</button>
      <button onClick={onSkip as () => void}>Skip</button>
      <button onClick={onBack as () => void}>Back</button>
      <button onClick={onExit as () => void}>Exit</button>
      <button onClick={onEdit as () => void}>Edit</button>
      <button onClick={onShowHelp as () => void}>Help</button>
      {isDraft && <button onClick={onPublish as () => void}>Publish</button>}
    </div>
  ),
}));

vi.mock('@/components/review-progress-bar', () => ({
  ReviewProgressBar: ({ progress }: { progress: { verified: number; total: number } }) => (
    <div data-testid="review-progress-bar">Progress: {progress.verified}/{progress.total}</div>
  ),
}));

vi.mock('@/components/review-filters', () => ({
  ReviewFilters: () => (
    <div data-testid="review-filters">Filters</div>
  ),
}));

vi.mock('@/components/review-queue-panel', () => ({
  ReviewQueuePanel: ({ items }: { items: unknown[] }) => (
    <div data-testid="review-queue-panel">Queue: {items.length} items</div>
  ),
}));

vi.mock('@/components/ui/sheet', () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    open ? <div data-testid="sheet">{children}</div> : null
  ),
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-content">{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetDescription: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) => (
    open ? <div data-testid="dialog" role="dialog">{children}</div> : null
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
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

describe('ReviewContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default return value
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

  // 1. Loading state
  it('shows loading skeleton with correct aria attributes', () => {
    setHookReturn({ isLoading: true });
    render(<ReviewContent />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Content review' })).toBeInTheDocument();
  });

  // 2. Empty queue — no filters (default "all caught up")
  it('shows "All caught up!" when queue is empty with no special filters', () => {
    setHookReturn({
      queue: [],
      currentItem: null,
      progress: { verified: 10, flagged: 2, skipped: 0, total: 50, sessionReviewed: 0 },
      filters: { status: 'unverified' },
    });
    render(<ReviewContent />);

    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    expect(screen.getByText(/No unverified items match/)).toBeInTheDocument();
  });

  // 3. Empty queue — all verified
  it('shows "All items have been verified" and Back to Browse link when all verified', () => {
    setHookReturn({
      queue: [],
      currentItem: null,
      progress: { verified: 50, flagged: 0, skipped: 0, total: 50, sessionReviewed: 0 },
      filters: { status: 'unverified' },
    });
    render(<ReviewContent />);

    expect(screen.getByText(/All 50 items have been verified/)).toBeInTheDocument();
    const browseLink = screen.getByRole('link', { name: 'Back to Browse' });
    expect(browseLink).toHaveAttribute('href', '/browse');
  });

  // 4. Empty queue — with filters shows "Clear filters" button
  it('shows "Clear filters" button when empty queue has active filters', () => {
    setHookReturn({
      queue: [],
      currentItem: null,
      progress: { verified: 10, flagged: 2, skipped: 0, total: 50, sessionReviewed: 0 },
      filters: { status: 'unverified', domain: ['Corporate'] },
    });
    render(<ReviewContent />);

    expect(screen.getByText('All caught up!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  // 5. Clear filters button calls setFilters
  it('clears filters when "Clear filters" button is clicked', async () => {
    const user = userEvent.setup();
    const mockSetFilters = vi.fn();
    setHookReturn({
      queue: [],
      currentItem: null,
      progress: { verified: 10, flagged: 2, skipped: 0, total: 50, sessionReviewed: 0 },
      filters: { status: 'unverified', domain: ['Corporate'] },
      setFilters: mockSetFilters,
    });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(mockSetFilters).toHaveBeenCalledWith({ status: 'unverified' });
  });

  // 6. Batch complete state
  it('shows "Batch complete" with "Load more" button when at end of queue', () => {
    const item = {
      id: 'item-1',
      title: 'Item',
      governance_review_status: null,
      content: 'body',
      source_url: null,
      verified_at: null,
      verified_by: null,
      secondary_domain: null,
      secondary_subtopic: null,
    };
    setHookReturn({
      queue: [item],
      currentIndex: 1, // past the end
      currentItem: item, // currentItem still set but index >= length
    });

    render(<ReviewContent />);

    expect(screen.getByText('Batch complete')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  // 7. Main review view renders child components
  it('renders ReviewCard, ActionBar, ProgressBar, and Filters in main view', () => {
    render(<ReviewContent />);

    expect(screen.getByTestId('review-card')).toBeInTheDocument();
    expect(screen.getByTestId('review-action-bar')).toBeInTheDocument();
    expect(screen.getByTestId('review-progress-bar')).toBeInTheDocument();
    expect(screen.getByTestId('review-filters')).toBeInTheDocument();
  });

  // 8. Flag input visibility
  it('shows flag input when showFlagInput is true', () => {
    setHookReturn({ showFlagInput: true, flagDetails: '' });
    render(<ReviewContent />);

    expect(screen.getByLabelText(/Reason/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Why does this need attention?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  // 9. Flag input submit on button click
  it('calls handleFlagSubmit when Submit button is clicked', async () => {
    const user = userEvent.setup();
    const mockFlagSubmit = vi.fn().mockResolvedValue(undefined);
    setHookReturn({
      showFlagInput: true,
      flagDetails: 'Needs review',
      handleFlagSubmit: mockFlagSubmit,
    });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    expect(mockFlagSubmit).toHaveBeenCalledWith('Needs review');
  });

  // 10. Flag input cancel
  it('calls setShowFlagInput(false) and clears details when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const mockSetShowFlagInput = vi.fn();
    const mockSetFlagDetails = vi.fn();
    setHookReturn({
      showFlagInput: true,
      flagDetails: 'Some reason',
      setShowFlagInput: mockSetShowFlagInput,
      setFlagDetails: mockSetFlagDetails,
    });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mockSetShowFlagInput).toHaveBeenCalledWith(false);
    expect(mockSetFlagDetails).toHaveBeenCalledWith('');
  });

  // 11. Queue panel toggle
  it('shows queue panel Sheet when showQueuePanel is true', () => {
    setHookReturn({ showQueuePanel: true });
    render(<ReviewContent />);

    expect(screen.getByTestId('sheet')).toBeInTheDocument();
    expect(screen.getByTestId('review-queue-panel')).toBeInTheDocument();
  });

  // 12. Queue panel hidden by default
  it('hides queue panel Sheet when showQueuePanel is false', () => {
    setHookReturn({ showQueuePanel: false });
    render(<ReviewContent />);

    expect(screen.queryByTestId('sheet')).not.toBeInTheDocument();
  });

  // 13. Toggle panel button
  it('renders panel toggle button with correct aria attributes', () => {
    render(<ReviewContent />);

    const toggleButton = screen.getByRole('button', { name: /review queue panel/i });
    expect(toggleButton).toBeInTheDocument();
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
  });

  // 14. Panel toggle calls handleTogglePanel
  it('calls handleTogglePanel when panel toggle button is clicked', async () => {
    const user = userEvent.setup();
    const mockToggle = vi.fn();
    setHookReturn({ handleTogglePanel: mockToggle });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: /review queue panel/i }));
    expect(mockToggle).toHaveBeenCalled();
  });

  // 15. Keyboard shortcuts dialog
  it('shows keyboard shortcuts dialog when showHelp is true', () => {
    setHookReturn({ showHelp: true });
    render(<ReviewContent />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('Keyboard shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Verify current item')).toBeInTheDocument();
  });

  // 16. Screen reader announcements
  it('renders aria-live region with announcement text', () => {
    setHookReturn({ announcement: 'Item 3 of 50: Test Item' });
    render(<ReviewContent />);

    // The sr-only announcement region
    const liveRegion = screen.getByText('Item 3 of 50: Test Item');
    expect(liveRegion).toBeInTheDocument();
    expect(liveRegion.closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
  });

  // 17. Exit with session summary toast
  it('shows session toast with count when exiting with reviewed items', async () => {
    const user = userEvent.setup();
    const mockHandleExit = vi.fn();
    setHookReturn({
      handleExit: mockHandleExit,
      progress: { verified: 10, flagged: 2, skipped: 1, total: 50, sessionReviewed: 7 },
    });
    render(<ReviewContent />);

    // Click Exit button (from our stubbed ReviewActionBar)
    await user.click(screen.getByRole('button', { name: 'Exit' }));

    expect(mockToast.info).toHaveBeenCalledWith('Session complete: 7 items reviewed');
    expect(mockHandleExit).toHaveBeenCalled();
  });

  // 18. Exit without toast when no items reviewed
  it('does not show toast when exiting with zero reviewed items', async () => {
    const user = userEvent.setup();
    const mockHandleExit = vi.fn();
    setHookReturn({
      handleExit: mockHandleExit,
      progress: { verified: 10, flagged: 2, skipped: 1, total: 50, sessionReviewed: 0 },
    });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: 'Exit' }));

    expect(mockToast.info).not.toHaveBeenCalled();
    expect(mockHandleExit).toHaveBeenCalled();
  });

  // 19. Publish button appears for draft items
  it('shows Publish button when current item is a draft', () => {
    const draftItem = {
      id: 'item-draft',
      title: 'Draft Item',
      governance_review_status: 'draft',
      suggested_title: null,
      ai_summary: null,
      primary_domain: 'Corporate',
      primary_subtopic: null,
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
      metadata: null,
      content: 'Draft content.',
      source_url: null,
      verified_at: null,
      verified_by: null,
      secondary_domain: null,
      secondary_subtopic: null,
    };
    setHookReturn({
      queue: [draftItem],
      currentItem: draftItem,
      sortedQueue: [draftItem],
    });
    render(<ReviewContent />);

    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument();
  });

  // 20. Review Queue heading visible in main view
  it('renders "Review Queue" heading in main review view', () => {
    render(<ReviewContent />);
    expect(screen.getByRole('heading', { name: 'Review Queue' })).toBeInTheDocument();
  });

  // 21. Action bar handlers are wired correctly
  it('calls handleVerify when Verify button is clicked', async () => {
    const user = userEvent.setup();
    const mockVerify = vi.fn().mockResolvedValue(undefined);
    setHookReturn({ handleVerify: mockVerify });
    render(<ReviewContent />);

    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(mockVerify).toHaveBeenCalled();
  });
});
