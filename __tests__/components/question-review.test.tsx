/**
 * QuestionReview Component Tests
 *
 * Tests the extracted question review screen — selection toggling,
 * select/deselect all, informational warnings, section grouping,
 * confirm/cancel actions, and API interaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

// Import AFTER mocks
import { QuestionReview } from '@/components/procurement/question-review';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

interface TestExtractedQuestion {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  category: string;
}

function makeExtractedQuestion(
  overrides: Partial<TestExtractedQuestion> = {},
): TestExtractedQuestion {
  return {
    section_name: 'Technical Approach',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach to delivery',
    word_limit: 500,
    category: 'mandatory',
    ...overrides,
  };
}

function makeQuestions(): TestExtractedQuestion[] {
  return [
    makeExtractedQuestion({
      section_name: 'Technical Approach',
      section_sequence: 1,
      question_sequence: 1,
      question_text: 'Describe your delivery approach',
      word_limit: 500,
      category: 'mandatory',
    }),
    makeExtractedQuestion({
      section_name: 'Technical Approach',
      section_sequence: 1,
      question_sequence: 2,
      question_text: 'What quality assurance processes do you use?',
      word_limit: 300,
      category: 'desirable',
    }),
    makeExtractedQuestion({
      section_name: 'Commercial',
      section_sequence: 2,
      question_sequence: 1,
      question_text: 'Provide your pricing schedule',
      word_limit: null,
      category: 'mandatory',
    }),
    makeExtractedQuestion({
      section_name: 'Administrative',
      section_sequence: 3,
      question_sequence: 1,
      question_text: 'Company registration number',
      word_limit: null,
      category: 'informational',
    }),
  ];
}

function defaultProps(
  overrides: Partial<Parameters<typeof QuestionReview>[0]> = {},
) {
  return {
    procurementId: 'bid-1',
    questions: makeQuestions(),
    onConfirmed: vi.fn(),
    onCancelled: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuestionReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  // ---- Basic rendering ----

  it('renders the heading', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('Review Extracted Questions')).toBeInTheDocument();
  });

  it('shows total question and section count', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(
      screen.getByText(/4 questions found across 3 sections/),
    ).toBeInTheDocument();
  });

  it('renders section headers', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('Technical Approach')).toBeInTheDocument();
    expect(screen.getByText('Commercial')).toBeInTheDocument();
    expect(screen.getByText('Administrative')).toBeInTheDocument();
  });

  it('renders question texts', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(
      screen.getByText('Describe your delivery approach'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('What quality assurance processes do you use?'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Provide your pricing schedule'),
    ).toBeInTheDocument();
    expect(screen.getByText('Company registration number')).toBeInTheDocument();
  });

  it('shows word limits when present', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('Word limit: 500')).toBeInTheDocument();
    expect(screen.getByText('Word limit: 300')).toBeInTheDocument();
  });

  it('shows category badges for non-informational questions', () => {
    render(<QuestionReview {...defaultProps()} />);
    // Two mandatory questions (q1 and q3) + one desirable (q2)
    expect(screen.getAllByText('mandatory')).toHaveLength(2);
    expect(screen.getByText('desirable')).toBeInTheDocument();
  });

  // ---- Informational warning ----

  it('shows informational warning when informational questions exist', () => {
    render(<QuestionReview {...defaultProps()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      /1 question is categorised as informational/,
    );
  });

  it('shows informational badge on informational questions', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('Informational')).toBeInTheDocument();
  });

  it('does not show informational warning when no informational questions', () => {
    const questions = [
      makeExtractedQuestion({ category: 'mandatory' }),
      makeExtractedQuestion({
        section_sequence: 2,
        section_name: 'B',
        category: 'desirable',
      }),
    ];
    render(<QuestionReview {...defaultProps({ questions })} />);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('uses plural when multiple informational questions exist', () => {
    const questions = [
      makeExtractedQuestion({
        category: 'informational',
        question_sequence: 1,
      }),
      makeExtractedQuestion({
        category: 'informational',
        question_sequence: 2,
        question_text: 'VAT number',
      }),
    ];
    render(<QuestionReview {...defaultProps({ questions })} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      /2 questions are categorised as informational/,
    );
  });

  // ---- Selection state ----

  it('all questions are selected by default', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('4 of 4 questions selected')).toBeInTheDocument();
  });

  it('shows correct confirm button text with all selected', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(
      screen.getByRole('button', { name: 'Confirm 4 Questions' }),
    ).toBeInTheDocument();
  });

  // ---- Select All / Deselect All ----

  it('disables Select All when all are already selected', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /Select All/ })).toBeDisabled();
  });

  it('enables Deselect All when some are selected', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(
      screen.getByRole('button', { name: /Deselect All/ }),
    ).not.toBeDisabled();
  });

  it('deselects all when Deselect All is clicked', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /Deselect All/ }));

    expect(screen.getByText('0 of 4 questions selected')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Select All/ }),
    ).not.toBeDisabled();
    expect(screen.getByRole('button', { name: /Deselect All/ })).toBeDisabled();
  });

  it('re-selects all when Select All is clicked after deselecting', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /Deselect All/ }));
    expect(screen.getByText('0 of 4 questions selected')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Select All/ }));
    expect(screen.getByText('4 of 4 questions selected')).toBeInTheDocument();
  });

  // ---- Individual toggle ----

  it('updates selected count when a question checkbox is toggled', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    // Find a checkbox and click it to deselect
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    expect(screen.getByText('3 of 4 questions selected')).toBeInTheDocument();
  });

  it('updates confirm button text when selection changes', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    expect(
      screen.getByRole('button', { name: 'Confirm 3 Questions' }),
    ).toBeInTheDocument();
  });

  it('uses singular "Question" when exactly one is selected', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    // Deselect all, then select one
    await user.click(screen.getByRole('button', { name: /Deselect All/ }));
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    expect(
      screen.getByRole('button', { name: 'Confirm 1 Question' }),
    ).toBeInTheDocument();
  });

  // ---- Confirm action ----

  it('calls API and onConfirmed on successful confirmation', async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    mockFetch.mockResolvedValueOnce({ ok: true });

    render(<QuestionReview {...defaultProps({ onConfirmed })} />);
    await user.click(
      screen.getByRole('button', { name: /Confirm 4 Questions/ }),
    );

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/procurement/bid-1/questions',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    expect(mockToast.success).toHaveBeenCalledWith(
      '4 questions confirmed and saved',
    );
    expect(onConfirmed).toHaveBeenCalled();
  });

  it('sends only selected questions to the API', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({ ok: true });

    render(<QuestionReview {...defaultProps()} />);

    // Deselect the first question
    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);

    await user.click(
      screen.getByRole('button', { name: /Confirm 3 Questions/ }),
    );

    const fetchCall = mockFetch.mock.calls[0];
    const body = JSON.parse(fetchCall[1].body as string);
    expect(body.questions).toHaveLength(3);
    // First question should not be included
    expect(
      body.questions.find(
        (q: TestExtractedQuestion) =>
          q.question_text === 'Describe your delivery approach',
      ),
    ).toBeUndefined();
  });

  it('shows error toast when API returns error', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: 'Database error' }),
    });

    render(<QuestionReview {...defaultProps()} />);
    await user.click(
      screen.getByRole('button', { name: /Confirm 4 Questions/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith('Database error');
  });

  it('shows generic error toast when API returns non-JSON error', async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error('parse error')),
    });

    render(<QuestionReview {...defaultProps()} />);
    await user.click(
      screen.getByRole('button', { name: /Confirm 4 Questions/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith(
      'Failed to save questions (500)',
    );
  });

  it('shows error when confirming with no questions selected', async () => {
    const user = userEvent.setup();
    render(<QuestionReview {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /Deselect All/ }));

    // Confirm button should be disabled when none selected
    const confirmButton = screen.getByRole('button', {
      name: /Confirm 0 Questions/,
    });
    expect(confirmButton).toBeDisabled();
  });

  // ---- Cancel action ----

  it('calls onCancelled when Cancel is clicked', async () => {
    const user = userEvent.setup();
    const onCancelled = vi.fn();
    render(<QuestionReview {...defaultProps({ onCancelled })} />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancelled).toHaveBeenCalled();
  });

  // ---- Section grouping ----

  it('shows question count per section', () => {
    render(<QuestionReview {...defaultProps()} />);
    expect(screen.getByText('(2 questions)')).toBeInTheDocument();
    expect(screen.getAllByText('(1 question)')).toHaveLength(2);
  });

  // ---- Checkbox accessibility ----

  it('checkboxes have accessible aria-labels', () => {
    render(<QuestionReview {...defaultProps()} />);
    const checkboxes = screen.getAllByRole('checkbox');
    expect(checkboxes[0]).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Select question'),
    );
  });

  // ---- Single question ----

  it('handles a single question correctly', () => {
    const questions = [makeExtractedQuestion()];
    render(<QuestionReview {...defaultProps({ questions })} />);
    expect(
      screen.getByText(/1 questions found across 1 sections/),
    ).toBeInTheDocument();
    expect(screen.getByText('1 of 1 questions selected')).toBeInTheDocument();
  });

  // ---- Network failure ----

  it('handles fetch rejection gracefully', async () => {
    const user = userEvent.setup();
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    render(<QuestionReview {...defaultProps()} />);
    await user.click(
      screen.getByRole('button', { name: /Confirm 4 Questions/ }),
    );

    expect(mockToast.error).toHaveBeenCalledWith('Network failure');
  });
});
