/**
 * ProcurementDetailPage Component Tests
 *
 * Tests the bid detail page — loading/null states, header rendering,
 * deadline proximity, action buttons, tab navigation, overview/questions/
 * documents tab content, dialogs, and role-gated elements.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { createTestQueryClient } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockRouter,
  mockUseUserRole,
  mockUseFormActions,
  mockFormatDateUK,
  mockGetDeadlineProximity,
  mockBidStateLabels,
  mockBidStateShortLabels,
  mockNotFound,
} = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockNotFound: vi.fn(),
  mockUseUserRole: {
    role: 'editor' as string | null,
    canEdit: true,
    canAdmin: false,
    loading: false,
  },
  mockUseFormActions: vi.fn(),
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
  mockBidStateShortLabels: {
    draft: 'Draft',
    questions_extracted: 'Extract',
    matching: 'Match',
    drafting: 'Draft',
    in_review: 'Review',
    ready_for_export: 'Export',
    submitted: 'Submit',
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
  usePathname: () => '/procurement/test-bid-1',
  useSearchParams: () => new URLSearchParams(),
  notFound: () => mockNotFound(),
}));

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

vi.mock('@/hooks/procurement/use-procurement-actions', () => ({
  useFormActions: (args: { id: string }) => mockUseFormActions(args),
}));

vi.mock('@/hooks/procurement/use-procurement-readiness', () => ({
  useProcurementReadiness: () => ({
    procurementStatus: null,
    readinessPercentage: 0,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => mockFormatDateUK(d),
}));

vi.mock('@/lib/domains/procurement/procurement-helpers', () => ({
  getDeadlineProximity: (d: string | null | undefined) =>
    mockGetDeadlineProximity(d),
}));

// ID-145 {145.43}: partial mock only — `ItemWorkflowPanel` now wires in the
// real `WorkflowStepper` (147-L), which needs the real `canTransition` /
// `getAvailableTransitions` / `isTerminal` / `PROCUREMENT_WORKFLOW_STATES`
// exports from this SAME module (the single source of truth {145.43}'s host
// deliberately does not re-derive). Only the two label maps are overridden
// (with fixtures identical to the real ones) to keep this file's existing
// label-fixture-driven assertions decoupled from the lib module.
vi.mock(
  '@/lib/domains/procurement/procurement-workflow',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/lib/domains/procurement/procurement-workflow')
      >();
    return {
      ...actual,
      PROCUREMENT_WORKFLOW_LABELS: mockBidStateLabels,
      PROCUREMENT_WORKFLOW_SHORT_LABELS: mockBidStateShortLabels,
    };
  },
);

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
vi.mock('@/components/procurement/procurement-workflow-indicator', () => ({
  ProcurementWorkflowBadge: ({ state }: { state: string }) => (
    <span data-testid="bid-state-badge">{state}</span>
  ),
}));

vi.mock('@/components/procurement/procurement-export-menu', () => ({
  ProcurementExportMenu: () => <div data-testid="bid-export-menu">Export</div>,
}));

vi.mock('@/components/coverage/cost-estimate-dialog', () => ({
  CostEstimateDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="cost-estimate-dialog">Cost Estimate</div> : null,
}));

vi.mock('@/components/procurement/procurement-outcome', () => ({
  ProcurementOutcomeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bid-outcome-dialog">Outcome</div> : null,
}));

vi.mock('@/components/procurement/kb-integration-review', () => ({
  KBIntegrationReview: ({ open }: { open: boolean }) =>
    open ? <div data-testid="kb-integration-review">KB Review</div> : null,
}));

vi.mock('@/components/procurement/question-review', () => ({
  QuestionReview: () => <div data-testid="question-review">QuestionReview</div>,
}));

vi.mock('@/components/procurement/readiness-checklist', () => ({
  ReadinessChecklist: () => (
    <div data-testid="readiness-checklist">Submission Readiness</div>
  ),
  ReadinessBadge: () => null,
}));

vi.mock('@/components/procurement/tender-upload', () => ({
  TenderUpload: () => <div data-testid="tender-upload">TenderUpload</div>,
}));

vi.mock('@/components/procurement/tender-metadata-prompt', () => ({
  TenderMetadataPrompt: () => (
    <div data-testid="tender-metadata-prompt">MetadataPrompt</div>
  ),
}));

// {145.47} filled these two stubs with real implementations that render a
// PDF (react-pdf/pdfjs-dist, browser-only — `DOMMatrix` etc. are absent in
// this jsdom test run). Their own behaviour is covered by
// item-fill-slot-review.test.tsx / item-citation-overlay.test.tsx; this
// page composition test only needs their stable mount points.
vi.mock('@/components/procurement/item-fill-slot-review', () => ({
  ItemFillSlotReview: ({ formId }: { formId: string }) => (
    <div data-testid="item-fill-slot-review">{formId}</div>
  ),
}));
vi.mock('@/components/procurement/item-citation-overlay', () => ({
  ItemCitationOverlay: ({ formId }: { formId: string }) => (
    <div data-testid="item-citation-overlay">{formId}</div>
  ),
}));

// Import AFTER mocks
import ProcurementDetailPage from '@/app/procurement/[id]/page';

// ---------------------------------------------------------------------------
// QueryClient wrapper for tests
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = createTestQueryClient();
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ID-145 {145.43}: the header action toolbar's per-transition buttons and the
// now-real `WorkflowStepper`'s own per-state step buttons can share the same
// accessible name (e.g. both render an "In Review" button) — the stepper
// wraps its steps in `role="list"` (`aria-label="Workflow state progress"`),
// the toolbar does not, so this disambiguates "the toolbar's copy" from
// "the stepper's copy" without depending on DOM order.
function findToolbarButton(name: string) {
  return screen
    .queryAllByRole('button', { name })
    .find((button) => !button.closest('[role="list"]'));
}

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeBid(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-bid-1',
    name: 'Test Procurement Alpha',
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
  const bid = (
    overrides.bid !== undefined ? overrides.bid : makeBid()
  ) as ReturnType<typeof makeBid> | null;
  const stats = (
    overrides.stats !== undefined ? overrides.stats : null
  ) as ReturnType<typeof makeStats> | null;
  const totalQuestions = (
    overrides.totalQuestions !== undefined ? overrides.totalQuestions : 10
  ) as number;
  const completedCount = (
    overrides.completedCount !== undefined ? overrides.completedCount : 5
  ) as number;
  const progressPercent = (
    overrides.progressPercent !== undefined ? overrides.progressPercent : 50
  ) as number;
  const procurementStatus = (
    overrides.procurementStatus !== undefined
      ? overrides.procurementStatus
      : 'drafting'
  ) as string | null;

  return {
    bid,
    questions: overrides.questions ?? [],
    stats,
    loading: overrides.loading ?? false,
    notFoundConfirmed: overrides.notFoundConfirmed ?? false,
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
    handleQuestionReviewConfirmed:
      overrides.handleQuestionReviewConfirmed ?? vi.fn(),
    handleQuestionReviewCancelled:
      overrides.handleQuestionReviewCancelled ?? vi.fn(),
    handleDelete: overrides.handleDelete ?? vi.fn(),
    handleMatchQuestions: overrides.handleMatchQuestions ?? vi.fn(),
    handleDraftAll: overrides.handleDraftAll ?? vi.fn(),
    handleOutcomeRecorded: overrides.handleOutcomeRecorded ?? vi.fn(),
    clearExtractedMetadata: overrides.clearExtractedMetadata ?? vi.fn(),
    handleKBIntegrationComplete:
      overrides.handleKBIntegrationComplete ?? vi.fn(),
    deleteConfirmOpen: overrides.deleteConfirmOpen ?? false,
    setDeleteConfirmOpen: overrides.setDeleteConfirmOpen ?? vi.fn(),
    handleDeleteConfirmed: overrides.handleDeleteConfirmed ?? vi.fn(),
    fetchProcurement: overrides.fetchProcurement ?? vi.fn(),
    fetchQuestions: overrides.fetchQuestions ?? vi.fn(),
    metadata: overrides.metadata ?? bid?.domain_metadata ?? null,
    procurementStatus,
    totalQuestions,
    completedCount,
    progressPercent,
    isSubmitted: overrides.isSubmitted ?? false,
    regularTransitions: overrides.regularTransitions ?? ['in_review'],
    tabs: overrides.tabs ?? [
      { id: 'overview', label: 'Overview' },
      { id: 'questions', label: 'Questions', count: totalQuestions },
      { id: 'documents', label: 'Documents', count: 1 },
    ],
  };
}

// Params passed to the page component — mocked `use()` returns this directly
const mockParams = { id: 'test-bid-1' } as unknown as Promise<{ id: string }>;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProcurementDetailPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRole.role = 'editor';
    mockUseUserRole.canEdit = true;
    mockUseUserRole.canAdmin = false;
    mockFormatDateUK.mockImplementation((d: string) => d);
    mockGetDeadlineProximity.mockReturnValue(null);
    mockUseFormActions.mockReturnValue(makeDefaultHookReturn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ---- Loading and null states ----

  it('renders a loading state (ItemInlineStates, {145.42}) while loading', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ loading: true }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows not-found state when bid is null', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ bid: null, procurementStatus: 'drafting' }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('Procurement not found')).toBeInTheDocument();
    expect(screen.getByText('Return to Procurement')).toBeInTheDocument();
  });

  it('shows not-found state when procurementStatus is null', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ procurementStatus: null }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('Procurement not found')).toBeInTheDocument();
  });

  // ID-145 {145.18} BI-2/BI-3 — a confirmed 404 calls Next's notFound()
  // (renders app/procurement/[id]/not-found.tsx), never a redirect.
  it('calls notFound() when notFoundConfirmed is true', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ notFoundConfirmed: true, bid: null }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(mockNotFound).toHaveBeenCalled();
  });

  it('does not call notFound() for a healthy load', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(mockNotFound).not.toHaveBeenCalled();
  });

  // ---- Header rendering ----

  it('renders the bid name in the header', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Test Procurement Alpha' }),
    ).toBeInTheDocument();
  });

  it('renders the bid state badge', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('bid-state-badge')).toHaveTextContent('drafting');
  });

  it('shows buyer name in the header', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('Acme Council')).toBeInTheDocument();
  });

  it('shows the deadline in the header', () => {
    mockFormatDateUK.mockReturnValue('15/04/2026');
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    // Deadline appears in both header and details section
    expect(screen.getAllByText('15/04/2026').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the reference number in the header', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    // Reference appears in both header and details section
    expect(screen.getAllByText('REF-001').length).toBeGreaterThanOrEqual(1);
  });

  it('renders back link to the procurement list (B-17, "Back to Procurement")', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const backLink = screen.getByText('Back to Procurement');
    expect(backLink.closest('a')).toHaveAttribute('href', '/procurement');
  });

  // ---- Deadline proximity ----

  it('shows deadline proximity badge when deadline is near', () => {
    mockGetDeadlineProximity.mockReturnValue({
      label: '3 days left',
      isOverdue: false,
      daysLeft: 3,
    });
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('3 days left')).toBeInTheDocument();
  });

  it('shows overdue proximity badge with overdue styling', () => {
    mockGetDeadlineProximity.mockReturnValue({
      label: 'Overdue',
      isOverdue: true,
      daysLeft: -2,
    });
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const badge = screen.getByText('Overdue');
    expect(badge).toBeInTheDocument();
  });

  it('does not show proximity badge when deadline is distant', () => {
    mockGetDeadlineProximity.mockReturnValue(null);
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.queryByText(/days left/)).not.toBeInTheDocument();
    expect(screen.queryByText('Overdue')).not.toBeInTheDocument();
  });

  // ---- Action buttons visibility ----

  it('shows transition buttons for editors', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        regularTransitions: ['in_review'],
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(findToolbarButton('In Review')).toBeInTheDocument();
  });

  it('hides action buttons for viewers', () => {
    mockUseUserRole.canEdit = false;
    mockUseUserRole.role = 'viewer';
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(findToolbarButton('In Review')).toBeUndefined();
  });

  it('filters out withdrawn from transition buttons', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        regularTransitions: ['in_review', 'withdrawn'],
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(findToolbarButton('In Review')).toBeInTheDocument();
    expect(findToolbarButton('Withdrawn')).toBeUndefined();
  });

  // ---- Admin-only delete ----

  it('shows delete menu for admin role', async () => {
    const user = userEvent.setup();
    mockUseUserRole.role = 'admin';
    mockUseUserRole.canEdit = true;
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const moreButton = screen.getByRole('button', { name: 'More actions' });
    await user.click(moreButton);
    expect(screen.getByText('Delete bid')).toBeInTheDocument();
  });

  it('does not show delete menu for editor role', () => {
    mockUseUserRole.role = 'editor';
    mockUseUserRole.canEdit = true;
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(
      screen.queryByRole('button', { name: 'More actions' }),
    ).not.toBeInTheDocument();
  });

  // ---- Tab navigation ----

  it('renders all three tabs', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Procurement sections' });
    expect(within(nav).getByText('Overview')).toBeInTheDocument();
    expect(within(nav).getByText(/Questions/)).toBeInTheDocument();
    expect(within(nav).getByText(/Documents/)).toBeInTheDocument();
    expect(within(nav).queryByText('Responses')).not.toBeInTheDocument();
  });

  it('shows question count on the Questions tab', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Procurement sections' });
    expect(within(nav).getByText('10')).toBeInTheDocument();
  });

  it('switches to the Questions section when its tab is clicked', async () => {
    const mockSetActiveTab = vi.fn();
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ setActiveTab: mockSetActiveTab }),
    );
    const user = userEvent.setup();
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const nav = screen.getByRole('tablist', { name: 'Procurement sections' });
    await user.click(within(nav).getByText(/Questions/));
    expect(mockSetActiveTab).toHaveBeenCalledWith('questions');
  });

  // ---- Overview tab content ----

  // ID-145 {145.42}: the Progress / Confidence Breakdown / Submission
  // Readiness cards moved into `ItemCoveragePanel` (a minimal placeholder
  // scaffolded here — {145.44} fills it with the real progress bar +
  // confidence breakdown + readiness checklist). page.tsx's own
  // responsibility is just mounting it correctly on the Overview tab.
  it('mounts ItemCoveragePanel on the overview tab with the completion counts ({145.44} fills the real progress/confidence UI)', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('item-coverage-panel')).toHaveTextContent(
      '5 of 10',
    );
  });

  it('mounts ItemCoveragePanel even at zero questions without crashing', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ totalQuestions: 0, completedCount: 0 }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('item-coverage-panel')).toBeInTheDocument();
  });

  it('shows bid details section', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('Details')).toBeInTheDocument();
    // §A1: estimated_value now ALSO appears in the item-page-frame header —
    // both occurrences are expected (header + Overview Details card).
    expect(screen.getAllByText('£50,000').length).toBeGreaterThanOrEqual(1);
  });

  // ---- Questions tab ----

  // ID-145 {145.42}: the bulk-action buttons (Find answers / Draft All) and
  // QuestionList moved into `ItemQuestionsPanel` (a minimal placeholder
  // scaffolded here — {145.44} fills the real honest per-question states +
  // bulk actions). page.tsx's own responsibility is mounting it correctly.
  it('mounts ItemQuestionsPanel on the questions tab with the question count ({145.44} fills the real bulk actions)', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        activeTab: 'questions',
        totalQuestions: 10,
        stats: makeStats({ unmatched_count: 3 }),
        procurementStatus: 'drafting',
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('item-questions-panel')).toHaveTextContent('10');
  });

  // ---- Documents tab ----

  it('shows upload prompt when no documents', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        activeTab: 'documents',
        bid: makeBid({ tender_documents: [] }),
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(
      screen.getByText('No tender documents uploaded yet.'),
    ).toBeInTheDocument();
  });

  it('lists uploaded documents', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        activeTab: 'documents',
        bid: makeBid({
          tender_documents: [
            {
              path: 'docs/tender.pdf',
              filename: 'tender.pdf',
              size: 51200,
              mime_type: 'application/pdf',
              uploaded_at: '2026-03-01',
            },
          ],
        }),
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByText('tender.pdf')).toBeInTheDocument();
    expect(screen.getByText('Uploaded Documents (1)')).toBeInTheDocument();
  });

  // ---- Delete confirmation dialog ----

  it('renders delete confirmation dialog when open', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({ deleteConfirmOpen: true }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(
      screen.getByText(/Are you sure you want to delete/),
    ).toBeInTheDocument();
  });

  it('triggers deletion when the Delete button in the confirm dialog is clicked', async () => {
    const mockHandleDeleteConfirmed = vi.fn();
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        deleteConfirmOpen: true,
        handleDeleteConfirmed: mockHandleDeleteConfirmed,
      }),
    );
    const user = userEvent.setup();
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(mockHandleDeleteConfirmed).toHaveBeenCalled();
  });

  // ---- Outcome dialog ----

  it('shows Record Outcome button for submitted bids', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        isSubmitted: true,
        procurementStatus: 'submitted',
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    // Header actions + NextActionCard both show Record Outcome
    const outcomeButtons = screen.getAllByRole('button', {
      name: /Record Outcome/,
    });
    expect(outcomeButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Extracted metadata prompt ----

  it('renders TenderMetadataPrompt when extractedMetadata is present', () => {
    mockUseFormActions.mockReturnValue(
      makeDefaultHookReturn({
        extractedMetadata: {
          buyer_name: 'Test Buyer',
          deadline: null,
          reference_number: null,
        },
      }),
    );
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('tender-metadata-prompt')).toBeInTheDocument();
  });

  // ---- State stepper ----

  // ID-145 {145.42}: the standalone `ProcurementWorkflowStepper` block moved
  // into `ItemWorkflowPanel`. {145.43} wires the real Warm Meridian stepper
  // (147-L) — page.tsx's own responsibility is mounting it with the current
  // workflow state; the stepper's own behaviour (labels, transitions,
  // refusal reasons) is covered by `workflow-stepper.test.tsx` and
  // `item-workflow-panel.test.tsx`.
  it('mounts ItemWorkflowPanel with the current workflow state', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    expect(screen.getByTestId('item-workflow-panel')).toHaveTextContent(
      'Drafting',
    );
  });

  // ---- Open Session link ----

  it('shows Open Session button linking to session page', () => {
    renderWithQuery(<ProcurementDetailPage params={mockParams} />);
    const sessionLinks = screen.getAllByText('Open Session');
    const sessionLink = sessionLinks[0].closest('a');
    expect(sessionLink).toHaveAttribute(
      'href',
      '/procurement/test-bid-1/session',
    );
  });

  // ---- Next action prompt ----

  describe('NextActionCard on Overview tab', () => {
    it('shows "Start answering questions" for draft bids', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'draft',
          activeTab: 'overview',
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(screen.getByText('Start answering questions')).toBeInTheDocument();
      // Action link should point to session page (multiple Open Session links exist — header + card)
      const actionLinks = screen.getAllByRole('link', { name: /Open Session/ });
      expect(
        actionLinks.some(
          (link) =>
            link.getAttribute('href') === '/procurement/test-bid-1/session',
        ),
      ).toBe(true);
    });

    it('shows "Start answering questions" for drafting bids', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'drafting',
          activeTab: 'overview',
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(screen.getByText('Start answering questions')).toBeInTheDocument();
    });

    it('shows "Review responses before submission" for in_review bids', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'in_review',
          activeTab: 'overview',
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.getByText('Review responses before submission'),
      ).toBeInTheDocument();
      const actionLink = screen.getByRole('link', { name: /Review Responses/ });
      expect(actionLink).toHaveAttribute(
        'href',
        '/procurement/test-bid-1/session',
      );
    });

    it('shows "Record the outcome" for submitted bids', () => {
      const mockSetShowOutcome = vi.fn();
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'submitted',
          activeTab: 'overview',
          isSubmitted: true,
          setShowOutcomeDialog: mockSetShowOutcome,
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.getByText('Record the outcome when you hear back'),
      ).toBeInTheDocument();
      // Multiple Record Outcome buttons exist (header + card)
      const outcomeButtons = screen.getAllByRole('button', {
        name: /Record Outcome/,
      });
      expect(outcomeButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('shows "Review responses for your knowledge base" for won bids', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'won',
          activeTab: 'overview',
          regularTransitions: [],
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.getByText('Review responses for your knowledge base'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /Review for KB/ }),
      ).toBeInTheDocument();
    });

    it('does not show next action card for viewers', () => {
      mockUseUserRole.canEdit = false;
      mockUseUserRole.role = 'viewer';
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'drafting',
          activeTab: 'overview',
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.queryByText('Start answering questions'),
      ).not.toBeInTheDocument();
    });

    it('does not show next action card for withdrawn bids', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          procurementStatus: 'withdrawn',
          activeTab: 'overview',
          regularTransitions: [],
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.queryByText('Start answering questions'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('Review responses')).not.toBeInTheDocument();
    });
  });

  // ---- P1-3 Overview tab thin-out ----

  describe('Overview tab thin-out (P1-3)', () => {
    it('does not render Knowledge-based Drafting card on Overview', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          activeTab: 'overview',
          procurementStatus: 'drafting',
          totalQuestions: 10,
          stats: makeStats(),
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(
        screen.queryByText('Knowledge-based Drafting'),
      ).not.toBeInTheDocument();
    });

    it('still renders NextActionCard on Overview', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          activeTab: 'overview',
          procurementStatus: 'drafting',
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(screen.getByText('Start answering questions')).toBeInTheDocument();
    });

    // ID-145 {145.42}: Submission Readiness moved into `ItemCoveragePanel`
    // (a minimal placeholder scaffolded here — {145.44} restores the real
    // `ReadinessChecklist` render). Confirms page.tsx still mounts the
    // coverage panel on Overview, not that the checklist itself renders yet.
    it('still mounts the coverage surface on Overview ({145.44} restores the real Submission Readiness UI)', () => {
      mockUseFormActions.mockReturnValue(
        makeDefaultHookReturn({
          activeTab: 'overview',
          procurementStatus: 'drafting',
          totalQuestions: 10,
        }),
      );
      renderWithQuery(<ProcurementDetailPage params={mockParams} />);
      expect(screen.getByTestId('item-coverage-panel')).toBeInTheDocument();
    });
  });
});
