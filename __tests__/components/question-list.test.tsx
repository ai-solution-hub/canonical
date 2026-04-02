/**
 * QuestionList Component Tests
 *
 * Tests the question list — rendering sections, collapsing/expanding,
 * empty states, add question dialog, and section grouping behaviour.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { BidQuestion } from '@/types/bid';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast, mockFetch } = vi.hoisted(() => ({
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
  mockFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/components/bid/question-row', () => ({
  QuestionRow: ({
    question,
    index,
  }: {
    question: BidQuestion;
    index: number;
  }) => (
    <div data-testid={`question-row-${question.id}`} role="listitem">
      Q{index}: {question.question_text}
    </div>
  ),
}));

// Import AFTER mocks
import { QuestionList } from '@/components/bid/question-list';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

function makeQuestion(overrides: Partial<BidQuestion> = {}): BidQuestion {
  return {
    id: 'q-1',
    project_id: 'bid-1',
    section_name: 'Technical Approach',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach',
    word_limit: 500,
    evaluation_weight: null,
    confidence_posture: null,
    matched_content_ids: null,
    status: 'not_started',
    has_variants: false,
    assigned_to: null,
    created_by: null,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
    ...overrides,
  };
}

function makeQuestions(): BidQuestion[] {
  return [
    makeQuestion({
      id: 'q-1',
      section_name: 'Technical Approach',
      section_sequence: 1,
      question_sequence: 1,
      question_text: 'Describe your approach',
    }),
    makeQuestion({
      id: 'q-2',
      section_name: 'Technical Approach',
      section_sequence: 1,
      question_sequence: 2,
      question_text: 'What is your methodology?',
    }),
    makeQuestion({
      id: 'q-3',
      section_name: 'Commercial',
      section_sequence: 2,
      question_sequence: 1,
      question_text: 'Provide your pricing',
    }),
  ];
}

function defaultProps(
  overrides: Partial<Parameters<typeof QuestionList>[0]> = {},
) {
  return {
    bidId: 'bid-1',
    questions: makeQuestions(),
    canEdit: true,
    onQuestionsChanged: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuestionList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  // ---- Basic rendering ----

  it('renders the question count heading', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(screen.getByText('3 Questions')).toBeInTheDocument();
  });

  it('renders singular "Question" when there is exactly one', () => {
    render(<QuestionList {...defaultProps({ questions: [makeQuestion()] })} />);
    expect(screen.getByText('1 Question')).toBeInTheDocument();
  });

  it('renders section count text when multiple sections exist', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(screen.getByText('Across 2 sections')).toBeInTheDocument();
  });

  it('does not render section count when only one section exists', () => {
    const questions = [
      makeQuestion({
        id: 'q-1',
        section_name: 'Technical',
        section_sequence: 1,
      }),
      makeQuestion({
        id: 'q-2',
        section_name: 'Technical',
        section_sequence: 1,
        question_sequence: 2,
      }),
    ];
    render(<QuestionList {...defaultProps({ questions })} />);
    expect(screen.queryByText(/Across/)).not.toBeInTheDocument();
  });

  // ---- Section headers ----

  it('renders section header buttons', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(screen.getByText('Technical Approach')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
  });

  it('shows question count per section', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(screen.getByText('2 questions')).toBeInTheDocument();
    expect(screen.getByText('1 question')).toBeInTheDocument();
  });

  // ---- QuestionRow rendering ----

  it('renders QuestionRow components for each question', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(screen.getByTestId('question-row-q-1')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-q-2')).toBeInTheDocument();
    expect(screen.getByTestId('question-row-q-3')).toBeInTheDocument();
  });

  // ---- Section collapsing ----

  it('collapses a section when its header is clicked', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);

    // Both sections visible initially
    expect(screen.getByTestId('question-row-q-1')).toBeInTheDocument();

    // Click the Technical Approach section header
    await user.click(screen.getByText('Technical Approach'));

    // Questions in that section should be hidden
    expect(screen.queryByTestId('question-row-q-1')).not.toBeInTheDocument();
    expect(screen.queryByTestId('question-row-q-2')).not.toBeInTheDocument();

    // Questions in other sections remain visible
    expect(screen.getByTestId('question-row-q-3')).toBeInTheDocument();
  });

  it('re-expands a collapsed section when clicked again', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);

    // Collapse
    await user.click(screen.getByText('Technical Approach'));
    expect(screen.queryByTestId('question-row-q-1')).not.toBeInTheDocument();

    // Expand
    await user.click(screen.getByText('Technical Approach'));
    expect(screen.getByTestId('question-row-q-1')).toBeInTheDocument();
  });

  it('sets aria-expanded correctly on section buttons', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);

    const sectionButton = screen
      .getByText('Technical Approach')
      .closest('button')!;
    expect(sectionButton).toHaveAttribute('aria-expanded', 'true');

    await user.click(sectionButton);
    expect(sectionButton).toHaveAttribute('aria-expanded', 'false');
  });

  // ---- Empty states ----

  it('shows empty state for viewers when no questions exist', () => {
    render(
      <QuestionList {...defaultProps({ questions: [], canEdit: false })} />,
    );
    expect(
      screen.getByText('No questions have been added yet.'),
    ).toBeInTheDocument();
  });

  it('shows editor-specific empty state when no questions exist and canEdit is true', () => {
    render(<QuestionList {...defaultProps({ questions: [] })} />);
    expect(
      screen.getByText(
        /No questions yet. Upload a tender document or add questions manually./,
      ),
    ).toBeInTheDocument();
  });

  it('shows Add Question button in editor empty state', () => {
    render(<QuestionList {...defaultProps({ questions: [] })} />);
    const buttons = screen.getAllByRole('button', { name: /Add Question/ });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Add Question button visibility ----

  it('shows Add Question button for editors with existing questions', () => {
    render(<QuestionList {...defaultProps()} />);
    expect(
      screen.getByRole('button', { name: /Add Question/ }),
    ).toBeInTheDocument();
  });

  it('hides Add Question button for non-editors', () => {
    render(<QuestionList {...defaultProps({ canEdit: false })} />);
    expect(
      screen.queryByRole('button', { name: /Add Question/ }),
    ).not.toBeInTheDocument();
  });

  // ---- Add Question dialog ----

  it('opens add question dialog when Add Question is clicked', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));
    expect(
      screen.getByText('Manually add a tender question to this bid.'),
    ).toBeInTheDocument();
  });

  it('renders all form fields in the add dialog', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));

    expect(screen.getByLabelText('Section Name')).toBeInTheDocument();
    expect(screen.getByLabelText(/Question Text/)).toBeInTheDocument();
    expect(screen.getByLabelText('Word Limit')).toBeInTheDocument();
  });

  it('shows validation error when submitting with empty question text', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));

    // Click add without entering text
    const buttons = screen.getAllByRole('button', { name: /Add Question/ });
    const submitButton = buttons[buttons.length - 1];
    await user.click(submitButton);

    expect(mockToast.error).toHaveBeenCalledWith('Question text is required');
  });

  it('submits add question form successfully', async () => {
    const user = userEvent.setup();
    const onQuestionsChanged = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true });

    render(<QuestionList {...defaultProps({ onQuestionsChanged })} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));

    // Fill in question text
    await user.type(
      screen.getByLabelText(/Question Text/),
      'How will you deliver?',
    );

    // Submit
    const buttons = screen.getAllByRole('button', { name: /Add Question/ });
    const submitButton = buttons[buttons.length - 1];
    await user.click(submitButton);

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/bids/bid-1/questions',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('How will you deliver?'),
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith('Question added');
    expect(onQuestionsChanged).toHaveBeenCalled();
  });

  it('shows error toast when add question API fails', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Server error' }),
    });

    render(<QuestionList {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));
    await user.type(screen.getByLabelText(/Question Text/), 'Test question');

    const buttons = screen.getAllByRole('button', { name: /Add Question/ });
    const submitButton = buttons[buttons.length - 1];
    await user.click(submitButton);

    expect(mockToast.error).toHaveBeenCalledWith('Server error');
  });

  // ---- Ungrouped questions ----

  it('renders ungrouped section for questions without section_name', () => {
    const questions = [
      makeQuestion({ id: 'q-1', section_name: null, section_sequence: 0 }),
    ];
    render(<QuestionList {...defaultProps({ questions })} />);
    expect(screen.getByText('Ungrouped')).toBeInTheDocument();
  });

  // ---- Question list role ----

  it('renders question list containers with role="list"', () => {
    render(<QuestionList {...defaultProps()} />);
    const lists = screen.getAllByRole('list');
    expect(lists.length).toBeGreaterThanOrEqual(1);
  });

  // ---- Cancel in dialog ----

  it('closes dialog when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<QuestionList {...defaultProps()} />);
    await user.click(screen.getByRole('button', { name: /Add Question/ }));

    expect(
      screen.getByText('Manually add a tender question to this bid.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    // Dialog description should no longer be visible
    expect(
      screen.queryByText('Manually add a tender question to this bid.'),
    ).not.toBeInTheDocument();
  });
});
