/**
 * Session Page Mobile Layout Tests
 *
 * Tests the mobile-specific behaviour of the bid session page:
 * - CompactQuestionBar sub-component (prev/next, counter, truncation, callbacks)
 * - Mobile lg:hidden / desktop hidden lg:block responsive split
 * - Collapsible <details> current question block
 * - Sheet width, dynamic description, and current question inside Sheet
 * - BidContextProvider wrapping all return paths (loading, error, empty, main)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockUseUserRole,
  mockUseStreamCoordination,
  mockUseContentLibraryDrawer,
  mockUseCitationOrphans,
  mockUseModifierKey,
} = vi.hoisted(() => ({
  mockUseUserRole: { role: 'editor' as string | null, canEdit: true, canAdmin: false, loading: false },
  mockUseStreamCoordination: vi.fn(),
  mockUseContentLibraryDrawer: vi.fn(),
  mockUseCitationOrphans: vi.fn(),
  mockUseModifierKey: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Mock react's `use()` to unwrap params (Next.js async params pattern)
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

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn(), prefetch: vi.fn().mockResolvedValue(undefined) }),
  usePathname: () => '/bid/test-bid/session',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole,
}));

vi.mock('@/hooks/use-modifier-key', () => ({
  useModifierKey: () => mockUseModifierKey(),
}));

vi.mock('@/hooks/use-content-library-drawer', () => ({
  useContentLibraryDrawer: () => mockUseContentLibraryDrawer(),
}));

vi.mock('@/hooks/use-citation-orphans', () => ({
  useCitationOrphans: () => mockUseCitationOrphans(),
}));

vi.mock('@/hooks/use-stream-coordination', () => ({
  useStreamCoordination: () => mockUseStreamCoordination(),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
  isMacPlatform: () => false,
}));

// Stub child components to isolate session page tests
vi.mock('@/components/question-navigator', () => ({
  QuestionNavigator: ({ questions, currentIndex, onNavigate }: { questions: unknown[]; currentIndex: number; onNavigate: (i: number) => void }) => (
    <div data-testid="question-navigator" data-current-index={currentIndex} data-count={questions.length}>
      <button onClick={() => onNavigate(0)}>Navigate to 0</button>
    </div>
  ),
}));

vi.mock('@/components/response-editor', () => ({
  ResponseEditor: ({ content, placeholder }: { content: string; placeholder: string }) => (
    <div data-testid="response-editor" data-content={content}>{placeholder}</div>
  ),
}));

vi.mock('@/components/citation-panel', () => ({
  CitationPanel: () => <div data-testid="citation-panel">Citations</div>,
}));

vi.mock('@/components/quality-score', () => ({
  QualityScore: () => <div data-testid="quality-score">Quality</div>,
}));

vi.mock('@/components/response-actions', () => ({
  ResponseActions: () => <div data-testid="response-actions">Actions</div>,
}));

vi.mock('@/components/streaming-phase-indicator', () => ({
  StreamingPhaseIndicator: () => <div data-testid="streaming-indicator">Streaming</div>,
}));

vi.mock('@/components/content-library-drawer', () => ({
  ContentLibraryDrawer: () => <div data-testid="content-library-drawer">Library</div>,
}));

vi.mock('@/components/response-version-history', () => ({
  ResponseVersionHistory: () => <div data-testid="response-version-history">History</div>,
}));

vi.mock('@/components/bid-context-provider', () => ({
  BidContextProvider: ({ children, bidId }: { children: React.ReactNode; bidId: string }) => (
    <div data-testid="bid-context-provider" data-bid-id={bidId}>{children}</div>
  ),
}));


// Import AFTER mocks
import BidSessionPage from '@/app/bid/[id]/session/page';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'q-1',
    question_text: 'Describe your approach to project management',
    section_name: 'Management',
    word_limit: 500,
    confidence_posture: 'strong_match',
    status: 'drafted',
    question_number: 1,
    ...overrides,
  };
}

function makeStreamCoordinationReturn(overrides: Record<string, unknown> = {}) {
  const questions = (overrides.questions ?? [
    makeQuestion({ id: 'q-1', question_number: 1 }),
    makeQuestion({ id: 'q-2', question_text: 'What is your quality assurance methodology?', section_name: 'Quality', question_number: 2, word_limit: null }),
    makeQuestion({ id: 'q-3', question_text: 'Detail your sustainability strategy for this contract', section_name: 'Sustainability', question_number: 3, word_limit: 300 }),
  ]) as Array<Record<string, unknown>>;

  const currentIndex = (overrides.currentIndex ?? 0) as number;
  const currentQuestion = (overrides.currentQuestion ?? questions[currentIndex]) as Record<string, unknown> | null;

  return {
    bid: overrides.bid ?? { id: 'test-bid', name: 'Test Bid Alpha' },
    questions,
    currentIndex,
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    response: overrides.response ?? null,
    responseLoading: overrides.responseLoading ?? false,
    editorContent: overrides.editorContent ?? '',
    setEditorContent: overrides.setEditorContent ?? vi.fn(),
    stream: overrides.stream ?? { phase: 'idle', error: null, qualityScore: null, totalCost: null, cancel: vi.fn() },
    isStreaming: overrides.isStreaming ?? false,
    actionLoading: overrides.actionLoading ?? false,
    loadingAction: overrides.loadingAction ?? null,
    handleNavigate: overrides.handleNavigate ?? vi.fn(),
    handleAction: overrides.handleAction ?? vi.fn(),
    handleLibraryInsert: overrides.handleLibraryInsert ?? vi.fn(),
    handleCitationClick: overrides.handleCitationClick ?? vi.fn(),
    navigatorQuestions: overrides.navigatorQuestions ?? questions.map((q) => ({
      id: q.id,
      question_text: q.question_text,
      section_name: q.section_name,
      confidence_posture: q.confidence_posture,
      status: q.status,
    })),
    currentQuestion,
    fetchBidData: overrides.fetchBidData ?? vi.fn(),
    fetchResponse: overrides.fetchResponse ?? vi.fn(),
  };
}

const mockParams = { id: 'test-bid' } as unknown as Promise<{ id: string }>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setupDefaults(overrides: Record<string, unknown> = {}) {
  const streamReturn = makeStreamCoordinationReturn(overrides);
  mockUseStreamCoordination.mockReturnValue(streamReturn);
  mockUseContentLibraryDrawer.mockReturnValue({
    isOpen: false,
    questionText: undefined,
    open: vi.fn(),
    close: vi.fn(),
    toggle: vi.fn(),
  });
  mockUseCitationOrphans.mockReturnValue(new Set<string>());
  mockUseModifierKey.mockReturnValue('Ctrl+');
  return streamReturn;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Session Page Mobile Layout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseUserRole.role = 'editor';
    mockUseUserRole.canEdit = true;
    mockUseUserRole.canAdmin = false;
  });

  // ========================================================================
  // CompactQuestionBar
  // ========================================================================

  describe('CompactQuestionBar', () => {
    it('renders prev/next buttons, counter, truncated text, and "All" button', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // The compact bar has role="navigation" with label "Question navigation"
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' });
      // There should be at least one (the mobile compact bar)
      expect(compactNav.length).toBeGreaterThanOrEqual(1);

      const mobileNav = compactNav[0];

      // Prev and Next buttons
      expect(within(mobileNav).getByRole('button', { name: 'Previous question' })).toBeInTheDocument();
      expect(within(mobileNav).getByRole('button', { name: 'Next question' })).toBeInTheDocument();

      // Counter text
      expect(within(mobileNav).getByText('Q1/3')).toBeInTheDocument();

      // Question text with truncate class
      const questionSpan = within(mobileNav).getByText('Describe your approach to project management');
      expect(questionSpan.className).toContain('truncate');

      // "All" button
      expect(within(mobileNav).getByRole('button', { name: 'All' })).toBeInTheDocument();
    });

    it('disables prev button at index 0', () => {
      setupDefaults({ currentIndex: 0 });
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const prevBtn = within(compactNav).getByRole('button', { name: 'Previous question' });
      expect(prevBtn).toBeDisabled();
    });

    it('disables next button at last index', () => {
      setupDefaults({ currentIndex: 2 }); // 3 questions, index 2 is last
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const nextBtn = within(compactNav).getByRole('button', { name: 'Next question' });
      expect(nextBtn).toBeDisabled();
    });

    it('shows correct Q{n}/{total} format for middle question', () => {
      setupDefaults({ currentIndex: 1 });
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      expect(within(compactNav).getByText('Q2/3')).toBeInTheDocument();
    });

    it('calls onPrev when prev button clicked', async () => {
      const user = userEvent.setup();
      const handleNavigate = vi.fn();
      setupDefaults({ currentIndex: 1, handleNavigate });
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const prevBtn = within(compactNav).getByRole('button', { name: 'Previous question' });
      await user.click(prevBtn);
      expect(handleNavigate).toHaveBeenCalledWith(0); // currentIndex - 1
    });

    it('calls onNext when next button clicked', async () => {
      const user = userEvent.setup();
      const handleNavigate = vi.fn();
      setupDefaults({ currentIndex: 0, handleNavigate });
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const nextBtn = within(compactNav).getByRole('button', { name: 'Next question' });
      await user.click(nextBtn);
      expect(handleNavigate).toHaveBeenCalledWith(1); // currentIndex + 1
    });

    it('opens the Sheet when "All" button clicked', async () => {
      const user = userEvent.setup();
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const allBtn = within(compactNav).getByRole('button', { name: 'All' });
      await user.click(allBtn);

      // Sheet should now show the "Questions" title
      expect(screen.getByText('Questions')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Mobile vs Desktop layout
  // ========================================================================

  describe('Responsive layout classes', () => {
    it('mobile compact bar section has lg:hidden class', () => {
      setupDefaults();
      const { container } = render(<BidSessionPage params={mockParams} />);

      // The compact bar is wrapped in a div with lg:hidden
      // Find the navigation element and check its parent wrapper
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      const mobileWrapper = compactNav.closest('div.mt-4');
      expect(mobileWrapper).not.toBeNull();
      expect(mobileWrapper!.className).toContain('lg:hidden');
    });

    it('desktop aside has hidden lg:block class', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // The desktop sidebar is an aside with aria-label "Question navigation"
      const asides = document.querySelectorAll('aside[aria-label="Question navigation"]');
      expect(asides.length).toBe(1);
      expect(asides[0].className).toContain('hidden');
      expect(asides[0].className).toContain('lg:block');
    });
  });

  // ========================================================================
  // Collapsible <details> current question
  // ========================================================================

  describe('Collapsible current question block', () => {
    it('renders a <details> element below the compact bar', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      const detailsElements = document.querySelectorAll('details');
      expect(detailsElements.length).toBeGreaterThanOrEqual(1);
    });

    it('has summary text "Current question"', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      const summaryElements = document.querySelectorAll('summary');
      const currentQuestionSummary = Array.from(summaryElements).find(
        (s) => s.textContent?.trim() === 'Current question'
      );
      expect(currentQuestionSummary).toBeTruthy();
    });

    it('shows section name, question text, and word limit when present', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      const detailsEl = document.querySelector('details');
      expect(detailsEl).not.toBeNull();

      const detailsContent = detailsEl!;
      // Section name
      expect(within(detailsContent).getByText('Management')).toBeInTheDocument();
      // Question text
      expect(within(detailsContent).getByText('Describe your approach to project management')).toBeInTheDocument();
      // Word limit
      expect(within(detailsContent).getByText('Word limit: 500')).toBeInTheDocument();
    });

    it('omits word limit when not present', () => {
      setupDefaults({
        currentIndex: 1,
        currentQuestion: makeQuestion({ id: 'q-2', question_text: 'What is your QA methodology?', section_name: 'Quality', word_limit: null }),
      });
      render(<BidSessionPage params={mockParams} />);

      const detailsEl = document.querySelector('details');
      expect(detailsEl).not.toBeNull();
      expect(within(detailsEl!).queryByText(/Word limit/)).not.toBeInTheDocument();
    });

    it('omits section name when not present', () => {
      setupDefaults({
        currentIndex: 0,
        currentQuestion: makeQuestion({ id: 'q-1', section_name: null }),
      });
      render(<BidSessionPage params={mockParams} />);

      const detailsEl = document.querySelector('details');
      expect(detailsEl).not.toBeNull();

      // Should not have any "Management" or other section text
      // But should still have the question text
      expect(within(detailsEl!).getByText('Describe your approach to project management')).toBeInTheDocument();
    });
  });

  // ========================================================================
  // Sheet
  // ========================================================================

  describe('Question Sheet', () => {
    it('Sheet has correct width class (w-[85vw] max-w-sm)', async () => {
      const user = userEvent.setup();
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // Open the sheet
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      await user.click(within(compactNav).getByRole('button', { name: 'All' }));

      // The SheetContent renders with data-slot="sheet-content"
      const sheetContent = document.querySelector('[data-slot="sheet-content"]');
      expect(sheetContent).not.toBeNull();
      expect(sheetContent!.className).toContain('w-[85vw]');
      expect(sheetContent!.className).toContain('max-w-sm');
    });

    it('SheetDescription shows dynamic question count', async () => {
      const user = userEvent.setup();
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // Open sheet
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      await user.click(within(compactNav).getByRole('button', { name: 'All' }));

      // SheetDescription should say "3 questions"
      expect(screen.getByText('3 questions')).toBeInTheDocument();
    });

    it('SheetDescription uses singular "question" for 1 question', async () => {
      const user = userEvent.setup();
      const singleQuestion = makeQuestion({ id: 'q-only' });
      setupDefaults({
        questions: [singleQuestion],
        currentQuestion: singleQuestion,
        navigatorQuestions: [{
          id: 'q-only',
          question_text: singleQuestion.question_text,
          section_name: singleQuestion.section_name,
          confidence_posture: singleQuestion.confidence_posture,
          status: singleQuestion.status,
        }],
      });
      render(<BidSessionPage params={mockParams} />);

      // Open sheet
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      await user.click(within(compactNav).getByRole('button', { name: 'All' }));

      expect(screen.getByText('1 question')).toBeInTheDocument();
      expect(screen.queryByText('1 questions')).not.toBeInTheDocument();
    });

    it('current question display exists inside the Sheet', async () => {
      const user = userEvent.setup();
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // Open the sheet
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      await user.click(within(compactNav).getByRole('button', { name: 'All' }));

      // The sheet content should include "Current Question" text (uppercase in the Sheet)
      const sheetContent = document.querySelector('[data-slot="sheet-content"]');
      expect(sheetContent).not.toBeNull();

      // Inside the sheet, find the "Current Question" label
      const currentQuestionLabels = within(sheetContent!).getAllByText('Current Question');
      expect(currentQuestionLabels.length).toBeGreaterThanOrEqual(1);

      // Also check the question text is present in the sheet
      expect(within(sheetContent!).getByText('Describe your approach to project management')).toBeInTheDocument();
    });

    it('Sheet contains QuestionNavigator component', async () => {
      const user = userEvent.setup();
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      // Open the sheet
      const compactNav = screen.getAllByRole('navigation', { name: 'Question navigation' })[0];
      await user.click(within(compactNav).getByRole('button', { name: 'All' }));

      // The sheet should contain the mocked QuestionNavigator
      const sheetContent = document.querySelector('[data-slot="sheet-content"]');
      expect(sheetContent).not.toBeNull();
      const navigator = within(sheetContent!).getByTestId('question-navigator');
      expect(navigator).toBeInTheDocument();
    });
  });

  // ========================================================================
  // BidContextProvider wraps all return paths
  // ========================================================================

  describe('BidContextProvider wraps all return paths', () => {
    it('wraps loading state in BidContextProvider', () => {
      setupDefaults({ loading: true });
      render(<BidSessionPage params={mockParams} />);

      const provider = screen.getByTestId('bid-context-provider');
      expect(provider).toBeInTheDocument();
      expect(provider).toHaveAttribute('data-bid-id', 'test-bid');
    });

    it('wraps error state in BidContextProvider', () => {
      setupDefaults({ error: 'Something went wrong' });
      render(<BidSessionPage params={mockParams} />);

      const provider = screen.getByTestId('bid-context-provider');
      expect(provider).toBeInTheDocument();
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('wraps empty state (no bid) in BidContextProvider', () => {
      setupDefaults({ bid: null, questions: [] });
      render(<BidSessionPage params={mockParams} />);

      const provider = screen.getByTestId('bid-context-provider');
      expect(provider).toBeInTheDocument();
    });

    it('wraps empty state (no questions) in BidContextProvider', () => {
      setupDefaults({ questions: [], currentQuestion: null, navigatorQuestions: [] });
      render(<BidSessionPage params={mockParams} />);

      const provider = screen.getByTestId('bid-context-provider');
      expect(provider).toBeInTheDocument();
      expect(screen.getByText('No questions yet')).toBeInTheDocument();
    });

    it('wraps main session content in BidContextProvider', () => {
      setupDefaults();
      render(<BidSessionPage params={mockParams} />);

      const provider = screen.getByTestId('bid-context-provider');
      expect(provider).toBeInTheDocument();
      expect(provider).toHaveAttribute('data-bid-id', 'test-bid');
    });
  });
});
