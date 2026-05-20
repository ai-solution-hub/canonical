/**
 * BidDetailPage Mobile Actions Tests
 *
 * Tests mobile-specific behaviour: responsive class visibility, MobileActionMenu
 * rendering for various bid states, role gating, destructive styling, and
 * disabled state during transitions.
 *
 * The existing bid-detail-page.test.tsx covers desktop behaviour. This file
 * focuses exclusively on the mobile actions (sm:hidden div) and the
 * MobileActionMenu component rendered within the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

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
  mockBidStateShortLabels,
  mockToast,
} = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockUseUserRole: {
    role: 'editor' as string | null,
    canEdit: true,
    canAdmin: false,
    loading: false,
  },
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
  mockToast: { success: vi.fn(), error: vi.fn() },
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
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

vi.mock('@/hooks/bid/use-bid-actions', () => ({
  useBidActions: (args: { id: string }) => mockUseBidActions(args),
}));

vi.mock('@/hooks/bid/use-bid-readiness', () => ({
  useBidReadiness: () => ({
    bidStatus: null,
    readinessPercentage: 0,
    isLoading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/format', () => ({
  formatDateUK: (d: string) => mockFormatDateUK(d),
}));

vi.mock('@/lib/procurement/procurement-helpers', () => ({
  getDeadlineProximity: (d: string | null | undefined) =>
    mockGetDeadlineProximity(d),
}));

vi.mock('@/lib/procurement/procurement-workflow', () => ({
  BID_STATE_LABELS: mockBidStateLabels,
  BID_STATE_SHORT_LABELS: mockBidStateShortLabels,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Mock react's `use()` to unwrap params
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    use: (val: unknown) => {
      if (val && typeof val === 'object' && 'then' in val) {
        return val;
      }
      return val;
    },
  };
});

// Stub child components
vi.mock('@/components/procurement/procurement-workflow-indicator', () => ({
  BidStateBadge: ({ state }: { state: string }) => (
    <span data-testid="bid-state-badge">{state}</span>
  ),
  BidStateStepper: ({ state }: { state: string }) => (
    <div data-testid="bid-state-stepper">{state}</div>
  ),
}));

vi.mock('@/components/procurement/procurement-export-menu', () => ({
  BidExportMenu: () => <div data-testid="bid-export-menu">Export</div>,
}));

vi.mock('@/components/coverage/cost-estimate-dialog', () => ({
  CostEstimateDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="cost-estimate-dialog">Cost Estimate</div> : null,
}));

vi.mock('@/components/procurement/procurement-outcome', () => ({
  BidOutcomeDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="bid-outcome-dialog">Outcome</div> : null,
}));

vi.mock('@/components/procurement/kb-integration-review', () => ({
  KBIntegrationReview: ({ open }: { open: boolean }) =>
    open ? <div data-testid="kb-integration-review">KB Review</div> : null,
}));

vi.mock('@/components/shared/confidence-badge', () => ({
  ConfidenceDot: ({ posture, count }: { posture: string; count: number }) => (
    <span data-testid={`confidence-dot-${posture}`}>{count}</span>
  ),
}));

vi.mock('@/components/procurement/question-list', () => ({
  QuestionList: () => <div data-testid="question-list">QuestionList</div>,
}));

vi.mock('@/components/procurement/question-review', () => ({
  QuestionReview: () => <div data-testid="question-review">QuestionReview</div>,
}));

vi.mock('@/components/procurement/tender-upload', () => ({
  TenderUpload: () => <div data-testid="tender-upload">TenderUpload</div>,
}));

vi.mock('@/components/procurement/tender-metadata-prompt', () => ({
  TenderMetadataPrompt: () => (
    <div data-testid="tender-metadata-prompt">MetadataPrompt</div>
  ),
}));

// Import AFTER mocks
import BidDetailPage from '@/app/procurement/[id]/page';

// ---------------------------------------------------------------------------
// QueryClient wrapper for tests
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

// ---------------------------------------------------------------------------
// Data factories (matching the desktop test file)
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
      estimated_value: '\u00a350,000',
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

function makeDefaultHookReturn(overrides: Record<string, unknown> = {}) {
  const bid =
    overrides.bid !== undefined
      ? overrides.bid
      : (makeBid() as ReturnType<typeof makeBid> | null);
  const totalQuestions =
    overrides.totalQuestions !== undefined
      ? (overrides.totalQuestions as number)
      : 10;
  const completedCount =
    overrides.completedCount !== undefined
      ? (overrides.completedCount as number)
      : 5;
  const progressPercent =
    overrides.progressPercent !== undefined
      ? (overrides.progressPercent as number)
      : 50;
  const bidStatus =
    overrides.bidStatus !== undefined
      ? (overrides.bidStatus as string | null)
      : 'drafting';

  return {
    bid,
    questions: overrides.questions ?? [],
    stats: overrides.stats ?? null,
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
    fetchBid: overrides.fetchBid ?? vi.fn(),
    fetchQuestions: overrides.fetchQuestions ?? vi.fn(),
    metadata:
      overrides.metadata ??
      (bid as ReturnType<typeof makeBid>)?.domain_metadata ??
      null,
    bidStatus,
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

const mockParams = { id: 'test-bid-1' } as unknown as Promise<{
  id: string;
}>;

// ---------------------------------------------------------------------------
// Helper: find mobile/desktop action divs by className
// ---------------------------------------------------------------------------

/**
 * Finds the desktop and mobile actions divs within a rendered container.
 * Desktop: has `sm:flex` class (hidden on mobile).
 * Mobile: has `sm:hidden` class (visible on mobile only).
 */
function findActionDivs(container: HTMLElement) {
  // Both divs are inside the header area. They have distinctive class combos.
  const allDivs = container.querySelectorAll('div');
  let desktopDiv: HTMLElement | null = null;
  let mobileDiv: HTMLElement | null = null;

  for (const div of Array.from(allDivs)) {
    const cls = div.className;
    if (
      cls.includes('sm:flex') &&
      cls.includes('hidden') &&
      cls.includes('gap-2')
    ) {
      desktopDiv = div;
    }
    if (
      cls.includes('sm:hidden') &&
      cls.includes('flex') &&
      cls.includes('gap-2') &&
      !cls.includes('sm:flex')
    ) {
      mobileDiv = div;
    }
  }

  return { desktopDiv, mobileDiv };
}

// ---------------------------------------------------------------------------
// Helper: get the Radix dropdown content portal after clicking Actions
// ---------------------------------------------------------------------------

/**
 * After clicking the mobile Actions button, Radix renders a portal with
 * `[data-slot="dropdown-menu-content"]`. Because jsdom does not apply CSS
 * (so `hidden` and `sm:hidden` are meaningless), both desktop and mobile
 * elements exist in the DOM. We scope dropdown-related assertions to the
 * Radix portal content to avoid ambiguity with desktop action buttons.
 */
function getDropdownContent(): HTMLElement {
  const el = document.querySelector('[data-slot="dropdown-menu-content"]');
  if (!el)
    throw new Error(
      'Dropdown content not found — was the Actions button clicked?',
    );
  return el as HTMLElement;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BidDetailPage — Mobile Actions', () => {
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

  // ---- Responsive class visibility ----

  describe('responsive class visibility', () => {
    it('desktop actions div has hidden + sm:flex classes', () => {
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { desktopDiv } = findActionDivs(container);
      expect(desktopDiv).not.toBeNull();
      expect(desktopDiv!.className).toContain('hidden');
      expect(desktopDiv!.className).toContain('sm:flex');
    });

    it('mobile actions div has flex + sm:hidden classes', () => {
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      expect(mobileDiv!.className).toContain('flex');
      expect(mobileDiv!.className).toContain('sm:hidden');
    });
  });

  // ---- Mobile "Open Session" button ----

  describe('mobile Open Session button', () => {
    it('is always present in the mobile div when canEdit is true', () => {
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      const sessionLink = within(mobileDiv!).getByText('Open Session');
      expect(sessionLink.closest('a')).toHaveAttribute(
        'href',
        '/bid/test-bid-1/session',
      );
    });

    it('is not rendered when canEdit is false (no mobile actions div)', () => {
      mockUseUserRole.canEdit = false;
      mockUseUserRole.role = 'viewer';
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      // When canEdit is false, neither desktop nor mobile action divs render
      expect(mobileDiv).toBeNull();
    });
  });

  // ---- MobileActionMenu renders null when no actions ----

  describe('MobileActionMenu renders null for terminal states', () => {
    it('does not show Actions button for won bids (terminal, no transitions)', () => {
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'won',
          regularTransitions: [],
          isSubmitted: false,
          totalQuestions: 0,
        }),
      );
      mockUseUserRole.role = 'editor';
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      // No Actions button — MobileActionMenu returns null
      expect(
        within(mobileDiv!).queryByRole('button', { name: 'Actions' }),
      ).not.toBeInTheDocument();
    });

    it('does not show Actions button for lost bids (terminal, no transitions)', () => {
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'lost',
          regularTransitions: [],
          isSubmitted: false,
          totalQuestions: 0,
        }),
      );
      mockUseUserRole.role = 'editor';
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      expect(
        within(mobileDiv!).queryByRole('button', { name: 'Actions' }),
      ).not.toBeInTheDocument();
    });

    it('does not show Actions button for withdrawn bids (terminal)', () => {
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'withdrawn',
          regularTransitions: ['withdrawn'],
          isSubmitted: false,
          totalQuestions: 0,
        }),
      );
      mockUseUserRole.role = 'editor';
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      // 'withdrawn' is filtered out, leaving 0 transitions, 0 questions, not admin
      expect(
        within(mobileDiv!).queryByRole('button', { name: 'Actions' }),
      ).not.toBeInTheDocument();
    });
  });

  // ---- MobileActionMenu shows status transitions for active states ----

  describe('MobileActionMenu shows status transitions', () => {
    it('shows transition labels for drafting state', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(within(dropdown).getByText('In Review')).toBeInTheDocument();
    });

    it('shows multiple transitions for in_review state', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'in_review',
          regularTransitions: ['ready_for_export', 'drafting'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(
        within(dropdown).getByText('Ready for Export'),
      ).toBeInTheDocument();
      expect(within(dropdown).getByText('Drafting')).toBeInTheDocument();
    });

    it('calls onStatusTransition when a transition item is clicked', async () => {
      const user = userEvent.setup();
      const mockHandleStatusTransition = vi.fn();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          regularTransitions: ['in_review'],
          handleStatusTransition: mockHandleStatusTransition,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      await user.click(within(dropdown).getByText('In Review'));
      expect(mockHandleStatusTransition).toHaveBeenCalledWith('in_review');
    });

    it('filters out withdrawn from mobile transitions', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'in_review',
          regularTransitions: ['ready_for_export', 'withdrawn'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(
        within(dropdown).getByText('Ready for Export'),
      ).toBeInTheDocument();
      expect(within(dropdown).queryByText('Withdrawn')).not.toBeInTheDocument();
    });
  });

  // ---- Record Outcome for submitted bids ----

  describe('MobileActionMenu Record Outcome', () => {
    it('shows Record Outcome for submitted bids', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'submitted',
          isSubmitted: true,
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(within(dropdown).getByText('Record Outcome')).toBeInTheDocument();
    });

    it('calls setShowOutcomeDialog when Record Outcome is clicked', async () => {
      const user = userEvent.setup();
      const mockSetShowOutcome = vi.fn();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'submitted',
          isSubmitted: true,
          regularTransitions: ['in_review'],
          setShowOutcomeDialog: mockSetShowOutcome,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      await user.click(within(dropdown).getByText('Record Outcome'));
      expect(mockSetShowOutcome).toHaveBeenCalledWith(true);
    });

    it('does not show Record Outcome for non-submitted bids', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          isSubmitted: false,
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(
        within(dropdown).queryByText('Record Outcome'),
      ).not.toBeInTheDocument();
    });
  });

  // ---- Admin-only Delete bid ----

  describe('MobileActionMenu Delete bid (admin only)', () => {
    it('shows Delete bid for admin users', async () => {
      const user = userEvent.setup();
      mockUseUserRole.role = 'admin';
      mockUseUserRole.canEdit = true;
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(within(dropdown).getByText('Delete bid')).toBeInTheDocument();
    });

    it('does not show Delete bid for editor users', async () => {
      const user = userEvent.setup();
      mockUseUserRole.role = 'editor';
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(
        within(dropdown).queryByText('Delete bid'),
      ).not.toBeInTheDocument();
    });

    it('Delete bid has destructive styling', async () => {
      const user = userEvent.setup();
      mockUseUserRole.role = 'admin';
      mockUseUserRole.canEdit = true;
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          regularTransitions: ['in_review'],
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      const deleteItem =
        within(dropdown)
          .getByText('Delete bid')
          .closest('[data-slot="dropdown-menu-item"]') ??
        within(dropdown).getByText('Delete bid').closest('[role="menuitem"]');
      expect(deleteItem).not.toBeNull();
      expect(deleteItem!.className).toContain('text-destructive');
    });

    it('calls handleDelete when Delete bid is clicked', async () => {
      const user = userEvent.setup();
      const mockHandleDelete = vi.fn();
      mockUseUserRole.role = 'admin';
      mockUseUserRole.canEdit = true;
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          regularTransitions: ['in_review'],
          handleDelete: mockHandleDelete,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      await user.click(within(dropdown).getByText('Delete bid'));
      expect(mockHandleDelete).toHaveBeenCalled();
    });

    it('shows Actions button for admin even with no transitions (delete is available)', () => {
      mockUseUserRole.role = 'admin';
      mockUseUserRole.canEdit = true;
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'won',
          regularTransitions: [],
          isSubmitted: false,
          totalQuestions: 0,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      expect(mobileDiv).not.toBeNull();
      // Admin always has "Delete bid" so MobileActionMenu renders
      expect(
        within(mobileDiv!).getByRole('button', { name: /Actions/ }),
      ).toBeInTheDocument();
    });
  });

  // ---- Transition items disabled when transitioning ----

  describe('transition items disabled when transitioning', () => {
    it('disables transition menu items when transitioning is true', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'in_review',
          regularTransitions: ['ready_for_export', 'drafting'],
          transitioning: true,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();

      // Radix DropdownMenuItem with disabled prop gets data-disabled attribute
      const readyItem =
        within(dropdown)
          .getByText('Ready for Export')
          .closest('[data-slot="dropdown-menu-item"]') ??
        within(dropdown)
          .getByText('Ready for Export')
          .closest('[role="menuitem"]');
      expect(readyItem).not.toBeNull();
      expect(readyItem).toHaveAttribute('data-disabled');

      const draftingItem =
        within(dropdown)
          .getByText('Drafting')
          .closest('[data-slot="dropdown-menu-item"]') ??
        within(dropdown).getByText('Drafting').closest('[role="menuitem"]');
      expect(draftingItem).not.toBeNull();
      expect(draftingItem).toHaveAttribute('data-disabled');
    });

    it('does not disable transition items when transitioning is false', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          regularTransitions: ['in_review'],
          transitioning: false,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();

      const reviewItem =
        within(dropdown)
          .getByText('In Review')
          .closest('[data-slot="dropdown-menu-item"]') ??
        within(dropdown).getByText('In Review').closest('[role="menuitem"]');
      expect(reviewItem).not.toBeNull();
      expect(reviewItem).not.toHaveAttribute('data-disabled');
    });
  });

  // ---- Export visibility in mobile menu ----

  describe('MobileActionMenu export items', () => {
    it('shows export sub-menu when totalQuestions > 0', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          regularTransitions: ['in_review'],
          totalQuestions: 10,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(within(dropdown).getByText('Export')).toBeInTheDocument();
    });

    it('does not show export when totalQuestions is 0', async () => {
      const user = userEvent.setup();
      mockUseBidActions.mockReturnValue(
        makeDefaultHookReturn({
          bidStatus: 'drafting',
          regularTransitions: ['in_review'],
          totalQuestions: 0,
        }),
      );
      const { container } = renderWithQuery(
        <BidDetailPage params={mockParams} />,
      );
      const { mobileDiv } = findActionDivs(container);
      const actionsButton = within(mobileDiv!).getByRole('button', {
        name: /Actions/,
      });
      await user.click(actionsButton);
      const dropdown = getDropdownContent();
      expect(within(dropdown).queryByText('Export')).not.toBeInTheDocument();
    });
  });
});
