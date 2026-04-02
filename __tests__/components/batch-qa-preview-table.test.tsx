/**
 * BatchQAPreviewTable Component Tests
 *
 * Tests parsing logic (TSV, pipe-separated), empty row filtering,
 * maximum 100 pairs limit, add/remove row functionality,
 * content formatting, and inline editing.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  BatchQAPreviewTable,
  parsePastedQA,
  formatQAContent,
  type QAPair,
} from '@/components/qa/batch-qa-preview-table';

// ---------------------------------------------------------------------------
// parsePastedQA unit tests
// ---------------------------------------------------------------------------

describe('parsePastedQA', () => {
  it('parses tab-separated Q&A pairs', () => {
    const text =
      'What is X?\tX is a thing\nHow does Y work?\tY works by doing Z';
    const result = parsePastedQA(text);
    expect(result).toEqual([
      { question: 'What is X?', answer: 'X is a thing' },
      { question: 'How does Y work?', answer: 'Y works by doing Z' },
    ]);
  });

  it('parses pipe-separated Q&A pairs', () => {
    const text =
      'What is X? | X is a thing\nHow does Y work? | Y works by doing Z';
    const result = parsePastedQA(text);
    expect(result).toEqual([
      { question: 'What is X?', answer: 'X is a thing' },
      { question: 'How does Y work?', answer: 'Y works by doing Z' },
    ]);
  });

  it('trims whitespace from questions and answers', () => {
    const text = '  What is X?  \t  X is a thing  ';
    const result = parsePastedQA(text);
    expect(result).toEqual([
      { question: 'What is X?', answer: 'X is a thing' },
    ]);
  });

  it('filters out empty rows', () => {
    const text =
      'What is X?\tX is a thing\n\n\n  \nHow does Y work?\tY works by doing Z';
    const result = parsePastedQA(text);
    expect(result).toHaveLength(2);
  });

  it('filters out rows with empty question', () => {
    const text = '\tSome answer\nWhat is X?\tX is a thing';
    const result = parsePastedQA(text);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('What is X?');
  });

  it('filters out rows with empty answer', () => {
    const text = 'What is X?\t\nHow does Y work?\tY works by doing Z';
    const result = parsePastedQA(text);
    expect(result).toHaveLength(1);
    expect(result[0].question).toBe('How does Y work?');
  });

  it('prefers tab separator over pipe when both present', () => {
    const text = 'What is X? | extra\tX is a thing';
    const result = parsePastedQA(text);
    expect(result).toEqual([
      { question: 'What is X? | extra', answer: 'X is a thing' },
    ]);
  });

  it('handles a single line', () => {
    const text = 'What is X?\tX is a thing';
    const result = parsePastedQA(text);
    expect(result).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(parsePastedQA('')).toEqual([]);
  });

  it('returns empty array for whitespace-only input', () => {
    expect(parsePastedQA('   \n  \n  ')).toEqual([]);
  });

  it('handles lines with only a question (no separator)', () => {
    const text = 'Just a question without separator';
    const result = parsePastedQA(text);
    // No tab or pipe, so it gets parsed as a single part — answer is empty
    expect(result).toHaveLength(0);
  });

  it('respects the 100 pair limit when called externally (parsing has no limit itself)', () => {
    // parsePastedQA itself does not enforce the limit — that is the UI's job.
    // But we test that it can parse more than 100 rows.
    const lines = Array.from({ length: 150 }, (_, i) => `Q${i}?\tA${i}`).join(
      '\n',
    );
    const result = parsePastedQA(lines);
    expect(result).toHaveLength(150);
  });
});

// ---------------------------------------------------------------------------
// formatQAContent unit tests
// ---------------------------------------------------------------------------

describe('formatQAContent', () => {
  it('formats a Q&A pair as "Q: {question}\\n\\nA: {answer}"', () => {
    const pair: QAPair = { question: 'What is X?', answer: 'X is a thing' };
    expect(formatQAContent(pair)).toBe('Q: What is X?\n\nA: X is a thing');
  });

  it('handles empty strings', () => {
    const pair: QAPair = { question: '', answer: '' };
    expect(formatQAContent(pair)).toBe('Q: \n\nA: ');
  });

  it('preserves multi-line answers', () => {
    const pair: QAPair = {
      question: 'What is X?',
      answer: 'Line 1\nLine 2\nLine 3',
    };
    expect(formatQAContent(pair)).toBe(
      'Q: What is X?\n\nA: Line 1\nLine 2\nLine 3',
    );
  });
});

// ---------------------------------------------------------------------------
// BatchQAPreviewTable component tests
// ---------------------------------------------------------------------------

describe('BatchQAPreviewTable', () => {
  const defaultPairs: QAPair[] = [
    { question: 'What is X?', answer: 'X is a thing' },
    { question: 'How does Y work?', answer: 'Y works by doing Z' },
  ];

  it('renders a table with the correct number of rows', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Two data rows plus header row
    expect(screen.getByText('What is X?')).toBeInTheDocument();
    expect(screen.getByText('How does Y work?')).toBeInTheDocument();
    expect(screen.getByText('X is a thing')).toBeInTheDocument();
    expect(screen.getByText('Y works by doing Z')).toBeInTheDocument();
  });

  it('shows row numbers', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('shows "Ready" status for items without status', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    const readyStatuses = screen.getAllByText('Ready');
    expect(readyStatuses).toHaveLength(2);
  });

  it('shows "Created" status for created items', () => {
    const onPairsChange = vi.fn();
    const statuses = new Map<
      number,
      { status: 'created' | 'failed'; error?: string }
    >();
    statuses.set(0, { status: 'created' });

    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
        itemStatuses={statuses}
      />,
    );

    expect(screen.getByText('Created')).toBeInTheDocument();
  });

  it('shows "Failed" status with error for failed items', () => {
    const onPairsChange = vi.fn();
    const statuses = new Map<
      number,
      { status: 'created' | 'failed'; error?: string }
    >();
    statuses.set(1, { status: 'failed', error: 'Duplicate title' });

    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
        itemStatuses={statuses}
      />,
    );

    expect(screen.getByText('Failed: Duplicate title')).toBeInTheDocument();
  });

  it('shows empty state message when no pairs', () => {
    const onPairsChange = vi.fn();
    render(<BatchQAPreviewTable pairs={[]} onPairsChange={onPairsChange} />);

    expect(
      screen.getByText(
        'No Q&A pairs yet. Paste from a spreadsheet or add rows manually.',
      ),
    ).toBeInTheDocument();
  });

  it('calls onPairsChange when "Add row" is clicked', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    fireEvent.click(screen.getByText('Add row'));
    expect(onPairsChange).toHaveBeenCalledWith([
      ...defaultPairs,
      { question: '', answer: '' },
    ]);
  });

  it('disables "Add row" when at 100 pairs', () => {
    const onPairsChange = vi.fn();
    const manyPairs = Array.from({ length: 100 }, (_, i) => ({
      question: `Q${i}`,
      answer: `A${i}`,
    }));

    render(
      <BatchQAPreviewTable pairs={manyPairs} onPairsChange={onPairsChange} />,
    );

    const addButton = screen.getByText('Add row');
    expect(addButton.closest('button')).toBeDisabled();
  });

  it('calls onPairsChange when a row is removed', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Click the remove button for the first row
    const removeButtons = screen.getAllByLabelText(/Remove row/);
    fireEvent.click(removeButtons[0]);

    expect(onPairsChange).toHaveBeenCalledWith([
      { question: 'How does Y work?', answer: 'Y works by doing Z' },
    ]);
  });

  it('enters edit mode when a question cell is clicked', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Click on the question button to enter edit mode
    fireEvent.click(screen.getByLabelText('Edit question 1: What is X?'));

    // An input should now be visible
    const input = screen.getByLabelText('Question 1');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('What is X?');
  });

  it('enters edit mode when an answer cell is clicked', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Edit answer 1: X is a thing'));

    const input = screen.getByLabelText('Answer 1');
    expect(input).toBeInTheDocument();
    expect(input).toHaveValue('X is a thing');
  });

  it('does not enter edit mode when disabled', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
        disabled
      />,
    );

    // Click on the question button — should be disabled
    const button = screen.getByLabelText('Edit question 1: What is X?');
    expect(button).toBeDisabled();
  });

  it('shows pair count and maximum', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    expect(screen.getByText('2 of 100 maximum pairs')).toBeInTheDocument();
  });

  it('has accessible table structure with grid role', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    expect(
      screen.getByRole('grid', { name: 'Q&A pairs preview' }),
    ).toBeInTheDocument();
  });

  it('updates pair when editing a cell value', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Click to edit
    fireEvent.click(screen.getByLabelText('Edit question 1: What is X?'));

    // Type in the input
    const input = screen.getByLabelText('Question 1');
    fireEvent.change(input, { target: { value: 'Updated question?' } });

    expect(onPairsChange).toHaveBeenCalledWith([
      { question: 'Updated question?', answer: 'X is a thing' },
      { question: 'How does Y work?', answer: 'Y works by doing Z' },
    ]);
  });

  it('exits edit mode on blur', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Enter edit mode
    fireEvent.click(screen.getByLabelText('Edit question 1: What is X?'));
    const input = screen.getByLabelText('Question 1');

    // Blur to exit
    fireEvent.blur(input);

    // Input should be gone, text button should be back
    expect(screen.queryByLabelText('Question 1')).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('Edit question 1: What is X?'),
    ).toBeInTheDocument();
  });

  it('exits edit mode on Enter key', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Enter edit mode
    fireEvent.click(screen.getByLabelText('Edit question 1: What is X?'));
    const input = screen.getByLabelText('Question 1');

    // Press Enter
    fireEvent.keyDown(input, { key: 'Enter' });

    // Input should be gone
    expect(screen.queryByLabelText('Question 1')).not.toBeInTheDocument();
  });

  it('exits edit mode on Escape key', () => {
    const onPairsChange = vi.fn();
    render(
      <BatchQAPreviewTable
        pairs={defaultPairs}
        onPairsChange={onPairsChange}
      />,
    );

    // Enter edit mode
    fireEvent.click(screen.getByLabelText('Edit question 1: What is X?'));
    const input = screen.getByLabelText('Question 1');

    // Press Escape
    fireEvent.keyDown(input, { key: 'Escape' });

    // Input should be gone
    expect(screen.queryByLabelText('Question 1')).not.toBeInTheDocument();
  });
});
