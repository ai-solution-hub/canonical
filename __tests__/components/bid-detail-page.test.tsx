/**
 * BidDetailPage Component Tests
 *
 * Tests the bid detail page — loading/null states, header rendering,
 * deadline proximity, action buttons, tab navigation, overview/questions/
 * documents tab content, dialogs, and role-gated elements.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockRouter,
  mockUseUserRole,
  mockUseBidActions,
  mockFormatDateUK,
  mockGetDeadlineProximity,
  mockBidStateLabels,
} = vi.hoisted(() => ({
  mockRouter: { push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn().mockResolvedValue(undefined) },
  mockUseUserRole: { role: 'editor' as string | null, canEdit: true, canAdmin: false, loading: false },
  mockUseBidActions: vi.fn(),
  mockFormatDateUK: vi.fn((d: string) => d),
  mockGetDeadlineProximity: vi.fn(),
  mockBidStateLabels: {
    draft: 'Draft',
    questions_extracted: 'Questions Extracted',
    matching: 'Matching',
    drafting: 'Drafting',
    in_review: 'In Review',
    ready_for_export: 'Ready for Export',
    submitted: 'Submitted',
    won: 'Won',
    lost: 'Lost',
    withdrawn: 'Withdrawn',
  } as Record<string, string>,
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/bid/test-bid-1',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

vi.mock('@/hooks/use-bid-actions', () => ({
  useBidActions: (args: { id: string }) => mockUseBidActions(args),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => mockFormatDateUK(d),
}));

vi.mock('@/lib/bid-helpers', () => ({
  getDeadlineProximity: (d: string | null | undefined) => mockGetDeadlineProximity(d),
}));

vi.mock('@/lib/bid-state-machine', () => ({
  BID_STATE_LABELS: mockBidStateLabels,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock react's `use()` to unwrap params
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    use: (val: unknown) => {
      // If it's a promise-like with an already-resolved value, return it
      if (val && typeof val === 'object' && 'then' in val) {
        // For testing, we pass a plain object and return it
        return val;
      }
      return val;
    },
  };
});

// Stub child components
vi.mock('@/components/bid-state-indicator', () => ({
  BidStateBadge: ({ state }: { state: string }) => <span data-testid="bid-state-badge">{state}</span>,
  BidStateStepper: ({ state }: { state: string }) => <div data-testid="bid-state-stepper">{state}</div>,
}));

vi.mock('@/components/bid-export-menu', () => ({
  BidExportMenu: () => <div data-testid="bid-export-menu">Export</div>,
}));

vi.mock('@/components/cost-estimate-dialog', () => ({
  CostEstimateDialog: ({ open }: { open: boolean }) => open ? <div data-testid="cost-estimate-dialog">Cost Estimate</div> : null,
}));

vi.mock('@/components/bid-outcome', () => ({
  BidOutcomeDialog: ({ open }: { open: boolean }) => open ? <div data-testid="bid-outcome-dialog">Outcome</div> : null,
}));

vi.mock('@/components/kb-integration-review', () => ({
  KBIntegrationReview: ({ open }: { open: boolean }) => open ? <div data-testid="kb-integration-review">KB Review</div> : null,
}));

vi.mock('@/components/confidence-badge', () => ({
  ConfidenceDot: ({ posture, count }: { posture: string; count: number }) => (
    <span data-testid={`confidence-dot-${posture}`}>{count}</span>
  ),
}));

vi.mock('@/components/question-list', () => ({
  QuestionList: () => <div data-testid="question-list">QuestionList</div>,
}));

vi.mock('@/components/question-review', () => ({
  QuestionReview: () => <div data-testid="question-review">QuestionReview</div>,
}));

vi.mock('@/components/tender-upload', () => ({
  TenderUpload: () => <div data-testid="tender-upload">TenderUpload</div>,
}));

vi.mock('@/components/tender-metadata-prompt', () => ({
  TenderMetadataPrompt: () => <div data-testid="tender-metadata-prompt">MetadataPrompt</div>,
}));

// Import AFTER mocks
import BidDetailPage from '@/app/bid/[id]/page';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeBid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-bid-1',
    name: 'Test Bid Alpha',
    description: 'A test bid for council services',
    status: 'drafting' as const,
    domain_metadata: {
      buyer: 'Acme Council',
      status: 'drafting',
      deadline: '2026-04-15',
      reference_number: 'REF-001',
      estimated_value: '£50,000',
      tender_source: 'upload',
      tender_document_ids: ['doc-1'],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: 'Some notes',
    },
    tender_documents: [],
    question_stats: null,
    created_by: 'user-1',
    created_at: '2026-03-01T10:00:00Z',
    updated_at: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

function makeStats(overrides: Record<string, unknown> = {}) {
  return {
    total_questions: 10,
    strong_match_count: 4,
    partial_match_count: 3,
    needs_sme_count: 2,
    no_content_count: 1,
    unmatched_count: 0,
    drafted_count: 6,
    complete_count: 5,
    ...overrides,
  };
}

function makeDefaultHookReturn(overrides: Record<string, unknown> = {}) {
  const bid = (overrides.bid !== undefined ? overrides.bid : makeBid()) as ReturnType<typeof makeBid> | null;
  const stats = (overrides.stats !== undefined ? overrides.stats : null) as ReturnType<typeof makeStats> | null;
  const totalQuestions = (overrides.totalQuestions !== undefined ? overrides.totalQuestions : 10) as number;
  const completedCount = (overrides.completedCount !== undefined ? overrides.completedCount : 5) as number;
  const progressPercent = (overrides.progressPercent !== undefined ? overrides.progressPercent : 50) as number;
  const bidStatus = (overrides.bidStatus !== undefined ? overrides.bidStatus : 'drafting') as string | null;

  return {
    bid,
    questions: overrides.questions ?? [],
    stats,
    loading: overrides.loading ?? false,
    activeTab: overrides.activeTab ?? 'overview',
    setActiveTab: overrides.setActiveTab ?? vi.fn(),
    transitioning: overrides.transitioning ?? false,
    showQuestionReview: overrides.showQuestionReview ?? false,
    extractedQuestions: overrides.extractedQuestions ?? [],
    showCostEstimate: overrides.showCostEstimate ?? false,
    setShowCostEstimate: overrides.setShowCostEstimate ?? vi.fn(),
    draftingAll: overrides.draftingAll ?? false,
    showOutcomeDialog: overrides.showOutcomeDialog ?? false,
    setShowOutcomeDialog: overrides.setShowOutcomeDialog ?? vi.fn(),
    showKBReview: overrides.showKBReview ?? false,
    setShowKBReview: overrides.setShowKBReview ?? vi.fn(),
    kbCandidates: overrides.kbCandidates ?? [],
    extractedMetadata: overrides.extractedMetadata ?? null,
    handleStatusTransition: overrides.handleStatusTransition ?? vi.fn(),
    handleUploadComplete: overrides.handleUploadComplete ?? vi.fn(),
    handleQuestionReviewConfirmed: overrides.handleQuestionReviewConfirmed ?? vi.fn(),
    handleQuestionReviewCancelled: overrides.handleQuestionReviewCancelled ?? vi.fn(),
    handleDelete: overrides.handleDelete ?? vi.fn(),
    handleMatchQuestions: overrides.handleMatchQuestions ?? vi.fn(),
    handleDraftAll: overrides.handleDraftAll ?? vi.fn(),
    handleOutcomeRecorded: overrides.handleOutcomeRecorded ?? vi.fn(),
    clearExtractedMetadata: overrides.clearExtractedMetadata ?? vi.fn(),
    handleKBIntegrationComplete: overrides.handleKBIntegrationComplete ?? vi.fn(),
    deleteConfirmOpen: overrides.deleteConfirmOpen ?? false,
    setDeleteConfirmOpen: overrides.setDeleteConfirmOpen ?? vi.fn(),
    handleDeleteConfirmed: overrides.handleDeleteConfirmed ?? vi.fn(),
    fetchBid: overrides.fetchBid ?? vi.fn(),
    fetchQuestions: overrides.fetchQuestions ?? vi.fn(),
    metadata: overrides.metadata ?? bid?.domain_metadata ?? null,
    bidStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    isSubmitted: overrides.isSubmitted ?? false,
    regularTransitions: overrides.regularTransitions ?? ['in_review'],
    tabs: overrides.tabs ?? [
      { id: 'overview', label: 'Overview' },
      { id: 'questions', label: 'Questions', count: totalQuestions },
      { id: 'responses', label: 'Responses' },
      { id: 'documents', label: 'Documents', count: 1 },
    ],
  };
}

// Params passed to the page component — mocked `use()` returns this directly
const mockParams = { id: 'test-bid-1' } as unknown as Promise<{ id: string }>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BidDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRole.role = 'editor';
    mockUseUserRole.canEdit = true;
    mockUseUserRole.canAdmin = false;
    mockFormatDateUK.mockImplementation((d: string) => d);
    mockGetDeadlineProximity.mockReturnValue(null);
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Loading and null states ----

  it('renders skeleton when loading', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ loading: true }));
    const { container } = render(<BidDetailPage params={mockParams} />);
    expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
  });

  it('shows not-found state when bid is null', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ bid: null, bidStatus: 'drafting' }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('Bid not found')).toBeInTheDocument();
    expect(screen.getByText('Return to Bids')).toBeInTheDocument();
  });

  it('shows not-found state when bidStatus is null', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ bidStatus: null }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('Bid not found')).toBeInTheDocument();
  });

  // ---- Header rendering ----

  it('renders the bid name in the header', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Test Bid Alpha' })).toBeInTheDocument();
  });

  it('renders the bid state badge', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByTestId('bid-state-badge')).toHaveTextContent('drafting');
  });

  it('shows buyer name in the header', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('Acme Council')).toBeInTheDocument();
  });

  it('shows the deadline in the header', () => {
    mockFormatDateUK.mockReturnValue('15/04/2026');
    render(<BidDetailPage params={mockParams} />);
    // Deadline appears in both header and details section
    expect(screen.getAllByText('15/04/2026').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the reference number in the header', () => {
    render(<BidDetailPage params={mockParams} />);
    // Reference appears in both header and details section
    expect(screen.getAllByText('REF-001').length).toBeGreaterThanOrEqual(1);
  });

  it('renders back link to bids list', () => {
    render(<BidDetailPage params={mockParams} />);
    const backLink = screen.getByText('Back to Bids');
    expect(backLink.closest('a')).toHaveAttribute('href', '/bid');
  });

  // ---- Deadline proximity ----

  it('shows deadline proximity badge when deadline is near', () => {
    mockGetDeadlineProximity.mockReturnValue({ label: '3 days left', isOverdue: false, daysLeft: 3 });
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('3 days left')).toBeInTheDocument();
  });

  it('shows overdue proximity badge with overdue styling', () => {
    mockGetDeadlineProximity.mockReturnValue({ label: 'Overdue', isOverdue: true, daysLeft: -2 });
    render(<BidDetailPage params={mockParams} />);
    const badge = screen.getByText('Overdue');
    expect(badge).toBeInTheDocument();
  });

  it('does not show proximity badge when deadline is distant', () => {
    mockGetDeadlineProximity.mockReturnValue(null);
    render(<BidDetailPage params={mockParams} />);
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  // ---- Action buttons visibility ----

  it('shows transition buttons for editors', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      regularTransitions: ['in_review'],
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByRole('button', { name: 'In Review' })).toBeInTheDocument();
  });

  it('hides action buttons for viewers', () => {
    mockUseUserRole.canEdit = false;
    mockUseUserRole.role = 'viewer';
    render(<BidDetailPage params={mockParams} />);
    expect(screen.queryByRole('button', { name: 'In Review' })).not.toBeInTheDocument();
  });

  it('filters out withdrawn from transition buttons', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      regularTransitions: ['in_review', 'withdrawn'],
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByRole('button', { name: 'In Review' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdrawn' })).not.toBeInTheDocument();
  });

  // ---- Admin-only delete ----

  it('shows delete menu for admin role', async () => {
    const user = userEvent.setup();
    mockUseUserRole.role = 'admin';
    mockUseUserRole.canEdit = true;
    render(<BidDetailPage params={mockParams} />);
    const moreButton = screen.getByRole('button', { name: 'More actions' });
    await user.click(moreButton);
    expect(screen.getByText('Delete bid')).toBeInTheDocument();
  });

  it('does not show delete menu for editor role', () => {
    mockUseUserRole.role = 'editor';
    mockUseUserRole.canEdit = true;
    render(<BidDetailPage params={mockParams} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).not.toBeInTheDocument();
  });

  // ---- Tab navigation ----

  it('renders all four tabs', () => {
    render(<BidDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Bid sections' });
    expect(within(nav).getByText('Overview')).toBeInTheDocument();
    expect(within(nav).getByText(/Questions/)).toBeInTheDocument();
    expect(within(nav).getByText('Responses')).toBeInTheDocument();
    expect(within(nav).getByText(/Documents/)).toBeInTheDocument();
  });

  it('shows question count on the Questions tab', () => {
    render(<BidDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Bid sections' });
    expect(within(nav).getByText('10')).toBeInTheDocument();
  });

  it('calls setActiveTab when clicking a tab', async () => {
    const mockSetActiveTab = vi.fn();
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ setActiveTab: mockSetActiveTab }));
    const user = userEvent.setup();
    render(<BidDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Bid sections' });
    await user.click(within(nav).getByText(/Questions/));
    expect(mockSetActiveTab).toHaveBeenCalledWith('questions');
  });

  // ---- Overview tab content ----

  it('shows progress heading in overview tab', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('shows progress bar with completion text', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('5 of 10 questions drafted (50%)')).toBeInTheDocument();
  });

  it('shows upload prompt when zero questions', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ totalQuestions: 0 }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText(/No questions extracted yet/)).toBeInTheDocument();
  });

  it('shows bid details section', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('Details')).toBeInTheDocument();
    expect(screen.getByText('£50,000')).toBeInTheDocument();
  });

  // ---- Questions tab ----

  it('shows bulk actions in questions tab for editors with questions', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      activeTab: 'questions',
      totalQuestions: 10,
      stats: makeStats({ unmatched_count: 3 }),
      bidStatus: 'drafting',
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText(/Match 3 Unmatched/)).toBeInTheDocument();
  });

  it('shows Draft All button when bidStatus is drafting', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      activeTab: 'questions',
      totalQuestions: 10,
      bidStatus: 'drafting',
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByRole('button', { name: /Draft All/ })).toBeInTheDocument();
  });

  // ---- Documents tab ----

  it('shows upload prompt when no documents', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      activeTab: 'documents',
      bid: makeBid({ tender_documents: [] }),
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('No tender documents uploaded yet.')).toBeInTheDocument();
  });

  it('lists uploaded documents', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      activeTab: 'documents',
      bid: makeBid({
        tender_documents: [
          { path: 'docs/tender.pdf', filename: 'tender.pdf', size: 51200, mime_type: 'application/pdf', uploaded_at: '2026-03-01' },
        ],
      }),
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText('tender.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploaded Documents (1)')).toBeInTheDocument();
  });

  // ---- Delete confirmation dialog ----

  it('renders delete confirmation dialog when open', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({ deleteConfirmOpen: true }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByText(/Are you sure you want to delete/)).toBeInTheDocument();
  });

  it('calls handleDeleteConfirmed when delete is confirmed', async () => {
    const mockHandleDeleteConfirmed = vi.fn();
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      deleteConfirmOpen: true,
      handleDeleteConfirmed: mockHandleDeleteConfirmed,
    }));
    const user = userEvent.setup();
    render(<BidDetailPage params={mockParams} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockHandleDeleteConfirmed).toHaveBeenCalled();
  });

  // ---- Outcome dialog ----

  it('shows Record Outcome button for submitted bids', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      isSubmitted: true,
      bidStatus: 'submitted',
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByRole('button', { name: 'Record Outcome' })).toBeInTheDocument();
  });

  // ---- Extracted metadata prompt ----

  it('renders TenderMetadataPrompt when extractedMetadata is present', () => {
    mockUseBidActions.mockReturnValue(makeDefaultHookReturn({
      extractedMetadata: { buyer_name: 'Test Buyer', deadline: null, reference_number: null },
    }));
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByTestId('tender-metadata-prompt')).toBeInTheDocument();
  });

  // ---- State stepper ----

  it('renders the BidStateStepper', () => {
    render(<BidDetailPage params={mockParams} />);
    expect(screen.getByTestId('bid-state-stepper')).toBeInTheDocument();
  });

  // ---- Open Session link ----

  it('shows Open Session button linking to session page', () => {
    render(<BidDetailPage params={mockParams} />);
    const sessionLink = screen.getByText('Open Session').closest('a');
    expect(sessionLink).toHaveAttribute('href', '/bid/test-bid-1/session');
  });
});
