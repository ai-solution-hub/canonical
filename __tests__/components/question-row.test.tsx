import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionRow } from '@/components/bid/question-row';
import type { BidQuestion, QuestionStatus } from '@/types/bid';

// Mock sonner toast (used by QuestionRow for save/delete feedback)
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe('QuestionRow', () => {
  const onUpdated = vi.fn();
  const onDeleted = vi.fn();
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function makeQuestion(overrides: Partial<BidQuestion> = {}): BidQuestion {
    return {
      id: 'q-1',
      project_id: 'bid-1',
      section_name: null,
      section_sequence: 1,
      question_sequence: 1,
      question_text: 'Describe your approach to quality management.',
      word_limit: null,
      evaluation_weight: null,
      confidence_posture: null,
      matched_content_ids: null,
      status: 'not_started',
      has_variants: false,
      assigned_to: null,
      created_by: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
      ...overrides,
    };
  }

  function renderRow(questionOverrides: Partial<BidQuestion> = {}, canEdit = false) {
    return render(
      <QuestionRow
        question={makeQuestion(questionOverrides)}
        index={1}
        canEdit={canEdit}
        bidId="bid-1"
        onUpdated={onUpdated}
        onDeleted={onDeleted}
      />,
    );
  }

  // ----------------------------------------------------------
  // Rendering question text
  // ----------------------------------------------------------

  it('renders the question text', () => {
    renderRow();
    expect(
      screen.getByText('Describe your approach to quality management.'),
    ).toBeInTheDocument();
  });

  it('renders the sequence number', () => {
    renderRow();
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Status badge for each status
  // ----------------------------------------------------------

  it.each<[QuestionStatus, string]>([
    ['not_started', 'Not Started'],
    ['ai_drafted', 'AI Drafted'],
    ['in_progress', 'In Progress'],
    ['needs_review', 'Needs Review'],
    ['complete', 'Complete'],
  ])('shows "%s" status as "%s"', (status, label) => {
    renderRow({ status });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Word limit display
  // ----------------------------------------------------------

  it('shows word limit when present', () => {
    renderRow({ word_limit: 500 });
    expect(screen.getByText('500w')).toBeInTheDocument();
  });

  it('does not show word limit when null', () => {
    renderRow({ word_limit: null });
    expect(screen.queryByText(/\dw$/)).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Click to expand / collapse
  // ----------------------------------------------------------

  it('expands on click to show full question text', async () => {
    const user = userEvent.setup();
    renderRow({ section_name: 'Quality' });

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Section: Quality')).toBeInTheDocument();
  });

  it('collapses on second click', async () => {
    const user = userEvent.setup();
    renderRow();

    const button = screen.getByRole('button');
    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
  });

  // ----------------------------------------------------------
  // Edit / Delete buttons (canEdit = true)
  // ----------------------------------------------------------

  it('shows Edit and Delete buttons when expanded and canEdit is true', async () => {
    const user = userEvent.setup();
    renderRow({}, true);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Delete/ })).toBeInTheDocument();
  });

  it('does not show Edit and Delete buttons when canEdit is false', async () => {
    const user = userEvent.setup();
    renderRow({}, false);

    await user.click(screen.getByRole('button'));
    expect(screen.queryByRole('button', { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Listitem role
  // ----------------------------------------------------------

  it('renders with listitem role for accessibility', () => {
    renderRow();
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });
});
