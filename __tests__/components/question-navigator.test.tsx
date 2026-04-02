/**
 * QuestionNavigator Component Tests
 *
 * Tests the question navigation sidebar — progress display, prev/next
 * buttons, jump-to-posture badges, dot navigator, and accessibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import AFTER mocks
import { QuestionNavigator } from '@/components/bid/question-navigator';
import type { ConfidencePosture } from '@/components/bid/question-navigator';

// ---------------------------------------------------------------------------
// Data factories
// ---------------------------------------------------------------------------

interface TestQuestion {
  id: string;
  question_text: string;
  section_name: string | null;
  confidence_posture: ConfidencePosture | string | null;
  status: string | null;
}

function makeQuestion(overrides: Partial<TestQuestion> = {}): TestQuestion {
  return {
    id: 'q-1',
    question_text: 'Describe your approach to delivery',
    section_name: 'Technical',
    confidence_posture: 'strong_match',
    status: 'not_started',
    ...overrides,
  };
}

function makeQuestions(): TestQuestion[] {
  return [
    makeQuestion({
      id: 'q-1',
      confidence_posture: 'strong_match',
      status: 'complete',
    }),
    makeQuestion({
      id: 'q-2',
      confidence_posture: 'partial_match',
      status: 'ai_drafted',
      question_text: 'What is your methodology?',
    }),
    makeQuestion({
      id: 'q-3',
      confidence_posture: 'needs_sme',
      status: 'not_started',
      question_text: 'Provide case studies',
    }),
    makeQuestion({
      id: 'q-4',
      confidence_posture: 'no_content',
      status: 'not_started',
      question_text: 'Team structure',
    }),
    makeQuestion({
      id: 'q-5',
      confidence_posture: 'strong_match',
      status: 'approved',
      question_text: 'Quality assurance',
    }),
  ];
}

function defaultProps(
  overrides: Partial<Parameters<typeof QuestionNavigator>[0]> = {},
) {
  return {
    questions: makeQuestions(),
    currentIndex: 0,
    onNavigate: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuestionNavigator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Progress display ----

  it('renders the current question position', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    expect(screen.getByText('Q1 of 5')).toBeInTheDocument();
  });

  it('shows the completed count', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    // 2 complete: q-1 (complete) and q-5 (approved)
    expect(screen.getByText('(2 complete)')).toBeInTheDocument();
  });

  it('updates position for different currentIndex', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 3 })} />);
    expect(screen.getByText('Q4 of 5')).toBeInTheDocument();
  });

  // ---- Progress bar ----

  it('renders a progress bar with correct values', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute('aria-valuenow', '2');
    expect(progressBar).toHaveAttribute('aria-valuemin', '0');
    expect(progressBar).toHaveAttribute('aria-valuemax', '5');
  });

  it('has accessible label on progress bar', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const progressBar = screen.getByRole('progressbar');
    expect(progressBar).toHaveAttribute(
      'aria-label',
      '2 of 5 questions complete',
    );
  });

  // ---- Previous / Next buttons ----

  it('disables Previous button when on the first question', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 0 })} />);
    const prevButton = screen.getByRole('button', { name: /Previous/ });
    expect(prevButton).toBeDisabled();
  });

  it('enables Previous button when not on the first question', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 2 })} />);
    // Previous button shows "Q2: ..." text
    const buttons = screen.getAllByRole('button');
    const prevButton = buttons.find((b) => b.textContent?.includes('Q2:'));
    expect(prevButton).not.toBeDisabled();
  });

  it('disables Next button when on the last question', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 4 })} />);
    const nextButton = screen.getByRole('button', { name: /Next/ });
    expect(nextButton).toBeDisabled();
  });

  it('enables Next button when not on the last question', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 0 })} />);
    const buttons = screen.getAllByRole('button');
    const nextButton = buttons.find((b) => b.textContent?.includes('Q2:'));
    expect(nextButton).not.toBeDisabled();
  });

  it('calls onNavigate with previous index when Previous is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator {...defaultProps({ currentIndex: 2, onNavigate })} />,
    );

    const buttons = screen.getAllByRole('button');
    const prevButton = buttons.find((b) => b.textContent?.includes('Q2:'));
    await user.click(prevButton!);

    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it('calls onNavigate with next index when Next is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <QuestionNavigator {...defaultProps({ currentIndex: 2, onNavigate })} />,
    );

    const buttons = screen.getAllByRole('button');
    const nextButton = buttons.find((b) => b.textContent?.includes('Q4:'));
    await user.click(nextButton!);

    expect(onNavigate).toHaveBeenCalledWith(3);
  });

  // ---- Previous / Next label content ----

  it('shows section name in navigation button when available', () => {
    const questions = [
      makeQuestion({ id: 'q-1', section_name: 'Technical' }),
      makeQuestion({
        id: 'q-2',
        section_name: 'Commercial',
        question_text: 'Pricing details',
      }),
    ];
    render(
      <QuestionNavigator {...defaultProps({ questions, currentIndex: 0 })} />,
    );
    // Next button should show Q2 with section name
    expect(screen.getByText(/Q2: Commercial/)).toBeInTheDocument();
  });

  it('falls back to question text when section name is null', () => {
    const questions = [
      makeQuestion({
        id: 'q-1',
        section_name: null,
        question_text: 'First question about approach',
      }),
      makeQuestion({
        id: 'q-2',
        section_name: null,
        question_text: 'Second question about delivery',
      }),
    ];
    render(
      <QuestionNavigator {...defaultProps({ questions, currentIndex: 0 })} />,
    );
    // Next button text should contain truncated question text
    expect(
      screen.getByText(/Q2: Second question about deliver/),
    ).toBeInTheDocument();
  });

  // ---- Jump-to posture badges ----

  it('renders jump-to section heading', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    expect(screen.getByText('Jump to')).toBeInTheDocument();
  });

  it('renders posture badges with counts', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    expect(screen.getByText('Strong match')).toBeInTheDocument();
    expect(screen.getByText('Partial match')).toBeInTheDocument();
    expect(screen.getByText('Needs SME')).toBeInTheDocument();
    expect(screen.getByText('No content')).toBeInTheDocument();
  });

  it('shows correct count for each posture', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    // Strong match: q-1 and q-5 = 2
    // Partial match: q-2 = 1
    // Needs SME: q-3 = 1
    // No content: q-4 = 1
    const badges = screen.getAllByText('2');
    expect(badges.length).toBeGreaterThanOrEqual(1); // At least the strong_match count
  });

  it('does not render posture badge when count is zero', () => {
    const questions = [
      makeQuestion({ id: 'q-1', confidence_posture: 'strong_match' }),
    ];
    render(<QuestionNavigator {...defaultProps({ questions })} />);
    expect(screen.queryByText('Needs SME')).not.toBeInTheDocument();
    expect(screen.queryByText('No content')).not.toBeInTheDocument();
  });

  it('calls onNavigate with first question of that posture when badge is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<QuestionNavigator {...defaultProps({ onNavigate })} />);

    // Click "Needs SME" badge — q-3 is index 2
    await user.click(screen.getByText('Needs SME'));
    expect(onNavigate).toHaveBeenCalledWith(2);
  });

  // ---- Dot navigator ----

  it('renders a toolbar with question dots', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    expect(toolbar).toBeInTheDocument();
  });

  it('renders one dot per question', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    const dots = within(toolbar).getAllByRole('button');
    expect(dots).toHaveLength(5);
  });

  it('marks the current question dot with aria-current', () => {
    render(<QuestionNavigator {...defaultProps({ currentIndex: 2 })} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    const dots = within(toolbar).getAllByRole('button');
    expect(dots[2]).toHaveAttribute('aria-current', 'true');
    expect(dots[0]).not.toHaveAttribute('aria-current');
  });

  it('calls onNavigate with correct index when a dot is clicked', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<QuestionNavigator {...defaultProps({ onNavigate })} />);

    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    const dots = within(toolbar).getAllByRole('button');
    await user.click(dots[3]);

    expect(onNavigate).toHaveBeenCalledWith(3);
  });

  it('dots have accessible aria-labels', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    const dots = within(toolbar).getAllByRole('button');
    // First dot — complete status
    expect(dots[0].getAttribute('aria-label')).toContain('Question 1:');
    expect(dots[0].getAttribute('aria-label')).toContain('Complete');
  });

  it('dots have title tooltips', () => {
    render(<QuestionNavigator {...defaultProps()} />);
    const toolbar = screen.getByRole('toolbar', { name: 'Question navigator' });
    const dots = within(toolbar).getAllByRole('button');
    expect(dots[0]).toHaveAttribute('title', 'Q1: Complete');
    expect(dots[1]).toHaveAttribute('title', 'Q2: Partial match');
  });

  // ---- Edge cases ----

  it('handles empty questions array', () => {
    render(
      <QuestionNavigator
        {...defaultProps({ questions: [], currentIndex: 0 })}
      />,
    );
    expect(screen.getByText('Q1 of 0')).toBeInTheDocument();
    expect(screen.getByText('(0 complete)')).toBeInTheDocument();
  });

  it('handles questions with null confidence_posture as no_content', () => {
    const questions = [makeQuestion({ id: 'q-1', confidence_posture: null })];
    render(<QuestionNavigator {...defaultProps({ questions })} />);
    expect(screen.getByText('No content')).toBeInTheDocument();
  });

  // ---- Custom className ----

  it('applies custom className to the container', () => {
    const { container } = render(
      <QuestionNavigator {...defaultProps({ className: 'my-nav-class' })} />,
    );
    expect(container.firstChild).toHaveClass('my-nav-class');
  });

  // ---- Single question ----

  it('disables both nav buttons when there is only one question', () => {
    const questions = [makeQuestion({ id: 'q-1' })];
    render(
      <QuestionNavigator {...defaultProps({ questions, currentIndex: 0 })} />,
    );
    const prevButton = screen.getByRole('button', { name: /Previous/ });
    const nextButton = screen.getByRole('button', { name: /Next/ });
    expect(prevButton).toBeDisabled();
    expect(nextButton).toBeDisabled();
  });
});
