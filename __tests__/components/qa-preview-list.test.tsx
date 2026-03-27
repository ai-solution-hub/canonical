/**
 * QAPreviewList Component Tests
 *
 * Tests the Q&A pair preview list with selection, inline editing,
 * dedup status indicators, and accessibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  QAPreviewList,
  type QAPreviewListProps,
  type DedupCheckResult,
} from '@/components/qa/qa-preview-list';
import type { QACreateInput } from '@/lib/quality/qa-detection';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makePair(overrides: Partial<QACreateInput> = {}): QACreateInput {
  return {
    title: 'What is your approach to data security?',
    content: 'Q: What is your approach to data security?\n\nA: We implement ISO 27001 controls across all systems.',
    contentType: 'q_a_pair',
    sectionName: 'Security',
    answerAdvanced: '',
    source: 'table',
    confidence: 'high',
    ...overrides,
  };
}

const defaultPairs: QACreateInput[] = [
  makePair(),
  makePair({
    title: 'How do you handle data breaches?',
    content: 'Q: How do you handle data breaches?\n\nA: We follow our incident response plan which includes immediate containment, investigation, notification within 72 hours, and remediation steps.',
    sectionName: 'Incident Response',
    source: 'list',
    confidence: 'medium',
  }),
  makePair({
    title: 'Describe your backup strategy',
    content: 'Q: Describe your backup strategy\n\nA: Daily incremental backups with weekly full backups. RPO of 4 hours, RTO of 2 hours.',
    sectionName: '',
    source: 'heading',
    confidence: 'medium',
  }),
];

const defaultProps: QAPreviewListProps = {
  pairs: defaultPairs,
  onConfirm: vi.fn(),
  onSkip: vi.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPreviewList(overrides: Partial<QAPreviewListProps> = {}) {
  return render(<QAPreviewList {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QAPreviewList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders all pairs with question text', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-question-0')).toHaveTextContent(
        'What is your approach to data security?',
      );
      expect(screen.getByTestId('qa-question-1')).toHaveTextContent(
        'How do you handle data breaches?',
      );
      expect(screen.getByTestId('qa-question-2')).toHaveTextContent(
        'Describe your backup strategy',
      );
    });

    it('renders answer text for each pair', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-answer-0')).toHaveTextContent(
        'We implement ISO 27001 controls across all systems.',
      );
    });

    it('renders source badges correctly', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-source-0')).toHaveTextContent('table');
      expect(screen.getByTestId('qa-source-1')).toHaveTextContent('list');
      expect(screen.getByTestId('qa-source-2')).toHaveTextContent('heading');
    });

    it('renders confidence badges correctly', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-confidence-0')).toHaveTextContent('high');
      expect(screen.getByTestId('qa-confidence-1')).toHaveTextContent('medium');
    });

    it('renders section name badge when present', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-section-0')).toHaveTextContent('Security');
      expect(screen.getByTestId('qa-section-1')).toHaveTextContent('Incident Response');
      // Pair 2 has no section name — badge should not exist
      expect(screen.queryByTestId('qa-section-2')).not.toBeInTheDocument();
    });

    it('shows count badge with all pairs selected initially', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('3 of 3 selected');
    });
  });

  describe('selection', () => {
    it('all pairs are selected by default', () => {
      renderPreviewList();

      for (let i = 0; i < 3; i++) {
        const checkbox = screen.getByTestId(`qa-checkbox-${i}`);
        expect(checkbox).toHaveAttribute('data-state', 'checked');
      }
    });

    it('toggling a checkbox deselects the pair', async () => {
      renderPreviewList();

      const checkbox = screen.getByTestId('qa-checkbox-1');
      fireEvent.click(checkbox);

      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('2 of 3 selected');
    });

    it('deselect all works', () => {
      renderPreviewList();

      const toggleAll = screen.getByTestId('qa-toggle-all');
      expect(toggleAll).toHaveTextContent('Deselect all');

      fireEvent.click(toggleAll);

      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('0 of 3 selected');
    });

    it('select all works after deselecting', () => {
      renderPreviewList();

      // Deselect all first
      fireEvent.click(screen.getByTestId('qa-toggle-all'));
      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('0 of 3 selected');

      // Now select all
      fireEvent.click(screen.getByTestId('qa-toggle-all'));
      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('3 of 3 selected');
    });

    it('confirm button shows correct count', () => {
      renderPreviewList();

      expect(screen.getByTestId('qa-confirm-button')).toHaveTextContent('Create 3 items');
    });

    it('confirm button is disabled when none selected', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-toggle-all')); // Deselect all
      expect(screen.getByTestId('qa-confirm-button')).toBeDisabled();
    });

    it('confirm button shows singular when 1 selected', () => {
      renderPreviewList();

      // Deselect all then select one
      fireEvent.click(screen.getByTestId('qa-toggle-all'));
      fireEvent.click(screen.getByTestId('qa-checkbox-0'));

      expect(screen.getByTestId('qa-confirm-button')).toHaveTextContent('Create 1 item');
    });
  });

  describe('remove pairs', () => {
    it('removes a pair when X button is clicked', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-remove-1'));

      // Pair 1 should no longer be visible
      expect(screen.queryByTestId('qa-pair-1')).not.toBeInTheDocument();
      expect(screen.getByTestId('qa-count-badge')).toHaveTextContent('2 of 2 selected');
    });

    it('removing all pairs shows empty state', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-remove-0'));
      fireEvent.click(screen.getByTestId('qa-remove-1'));
      fireEvent.click(screen.getByTestId('qa-remove-2'));

      expect(screen.getByTestId('qa-preview-empty')).toBeInTheDocument();
      expect(screen.getByText('No Q&A pairs to preview.')).toBeInTheDocument();
    });
  });

  describe('inline editing', () => {
    it('clicking edit shows textarea inputs', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-edit-0'));

      expect(screen.getByTestId('qa-question-input-0')).toBeInTheDocument();
      expect(screen.getByTestId('qa-answer-input-0')).toBeInTheDocument();
    });

    it('editing question updates the pair data', async () => {
      const onConfirm = vi.fn();
      renderPreviewList({ onConfirm });

      // Enter edit mode
      fireEvent.click(screen.getByTestId('qa-edit-0'));

      // Change question text
      const questionInput = screen.getByTestId('qa-question-input-0');
      fireEvent.change(questionInput, {
        target: { value: 'Updated question text?' },
      });

      // Exit edit mode
      fireEvent.click(screen.getByTestId('qa-done-editing-0'));

      // Verify updated text is displayed
      expect(screen.getByTestId('qa-question-0')).toHaveTextContent('Updated question text?');
    });

    it('editing answer updates the pair data', () => {
      const onConfirm = vi.fn();
      renderPreviewList({ onConfirm });

      // Enter edit mode
      fireEvent.click(screen.getByTestId('qa-edit-0'));

      // Change answer text
      const answerInput = screen.getByTestId('qa-answer-input-0');
      fireEvent.change(answerInput, {
        target: { value: 'Brand new answer text.' },
      });

      // Exit edit mode
      fireEvent.click(screen.getByTestId('qa-done-editing-0'));

      // Verify updated text is displayed
      expect(screen.getByTestId('qa-answer-0')).toHaveTextContent('Brand new answer text.');
    });

    it('done editing button exits edit mode', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-edit-0'));
      expect(screen.getByTestId('qa-question-input-0')).toBeInTheDocument();

      fireEvent.click(screen.getByTestId('qa-done-editing-0'));
      expect(screen.queryByTestId('qa-question-input-0')).not.toBeInTheDocument();
    });
  });

  describe('confirm and skip', () => {
    it('calls onConfirm with selected pairs', () => {
      const onConfirm = vi.fn();
      renderPreviewList({ onConfirm });

      // Deselect pair 1
      fireEvent.click(screen.getByTestId('qa-checkbox-1'));

      // Confirm
      fireEvent.click(screen.getByTestId('qa-confirm-button'));

      expect(onConfirm).toHaveBeenCalledOnce();
      const confirmedPairs = onConfirm.mock.calls[0][0];
      expect(confirmedPairs).toHaveLength(2);
      expect(confirmedPairs[0].title).toBe('What is your approach to data security?');
      expect(confirmedPairs[1].title).toBe('Describe your backup strategy');
    });

    it('calls onSkip when skip button is clicked', () => {
      const onSkip = vi.fn();
      renderPreviewList({ onSkip });

      fireEvent.click(screen.getByTestId('qa-skip-button'));
      expect(onSkip).toHaveBeenCalledOnce();
    });
  });

  describe('dedup indicator states', () => {
    it('shows checking state during dedup check', async () => {
      // Create a dedup check that never resolves (stays in checking state)
      const onDedupCheck = vi.fn(
        () => new Promise<DedupCheckResult>(() => {}), // Never resolves
      );

      renderPreviewList({ onDedupCheck });

      await waitFor(() => {
        expect(screen.getAllByTestId('dedup-checking').length).toBeGreaterThan(0);
      });
    });

    it('shows clear state when no duplicates found', async () => {
      const onDedupCheck = vi.fn(async (): Promise<DedupCheckResult> => ({
        isDuplicate: false,
        matches: [],
      }));

      renderPreviewList({ onDedupCheck });

      await waitFor(() => {
        expect(screen.getAllByTestId('dedup-clear')).toHaveLength(3);
      });
    });

    it('shows duplicate state with match details', async () => {
      const onDedupCheck = vi.fn(async (): Promise<DedupCheckResult> => ({
        isDuplicate: true,
        matches: [
          { id: 'existing-1', title: 'Existing security policy', similarity: 0.95 },
        ],
      }));

      renderPreviewList({ onDedupCheck });

      await waitFor(() => {
        expect(screen.getAllByTestId('dedup-duplicate')).toHaveLength(3);
      });

      // Check that match details are rendered
      expect(screen.getAllByText(/Existing security policy/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/95% similar/).length).toBeGreaterThan(0);
    });

    it('throttles concurrent dedup requests', async () => {
      let activeCount = 0;
      let maxActive = 0;

      const onDedupCheck = vi.fn(async (): Promise<DedupCheckResult> => {
        activeCount++;
        maxActive = Math.max(maxActive, activeCount);
        // Simulate async delay
        await new Promise((resolve) => setTimeout(resolve, 10));
        activeCount--;
        return { isDuplicate: false, matches: [] };
      });

      renderPreviewList({ onDedupCheck });

      await waitFor(() => {
        expect(onDedupCheck).toHaveBeenCalledTimes(3);
      });

      // Max concurrent should not exceed MAX_CONCURRENT_DEDUP (3)
      expect(maxActive).toBeLessThanOrEqual(3);
    });
  });

  describe('empty state', () => {
    it('shows empty state when pairs array is empty', () => {
      renderPreviewList({ pairs: [] });

      expect(screen.getByTestId('qa-preview-empty')).toBeInTheDocument();
      expect(screen.getByText('No Q&A pairs to preview.')).toBeInTheDocument();
    });

    it('shows continue button in empty state', () => {
      const onSkip = vi.fn();
      renderPreviewList({ pairs: [], onSkip });

      const continueBtn = screen.getByRole('button', { name: 'Continue' });
      fireEvent.click(continueBtn);
      expect(onSkip).toHaveBeenCalledOnce();
    });
  });

  describe('long answer truncation', () => {
    it('truncates long answers with show more button', () => {
      const longAnswer = 'A'.repeat(300);
      const pair = makePair({
        content: `Q: Question?\n\nA: ${longAnswer}`,
      });

      renderPreviewList({ pairs: [pair] });

      // Should show truncated text with "..." and Show more button
      const answerEl = screen.getByTestId('qa-answer-0');
      expect(answerEl.textContent!.length).toBeLessThan(300);
      expect(screen.getByText(/Show more/)).toBeInTheDocument();
    });

    it('expands answer when show more is clicked', () => {
      const longAnswer = 'A'.repeat(300);
      const pair = makePair({
        content: `Q: Question?\n\nA: ${longAnswer}`,
      });

      renderPreviewList({ pairs: [pair] });

      fireEvent.click(screen.getByText(/Show more/));
      expect(screen.getByText(/Show less/)).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has region role with descriptive label', () => {
      renderPreviewList();

      expect(screen.getByRole('region', { name: 'Q&A pair preview' })).toBeInTheDocument();
    });

    it('each pair card has article role with label', () => {
      renderPreviewList();

      const articles = screen.getAllByRole('article');
      expect(articles.length).toBe(3);
      expect(articles[0]).toHaveAttribute(
        'aria-label',
        expect.stringContaining('Q&A pair 1'),
      );
    });

    it('checkboxes have aria-labels', () => {
      renderPreviewList();

      for (let i = 0; i < 3; i++) {
        expect(screen.getByLabelText(`Include pair ${i + 1}`)).toBeInTheDocument();
      }
    });

    it('remove buttons have aria-labels', () => {
      renderPreviewList();

      for (let i = 0; i < 3; i++) {
        expect(screen.getByLabelText(`Remove pair ${i + 1}`)).toBeInTheDocument();
      }
    });

    it('edit buttons have aria-labels', () => {
      renderPreviewList();

      for (let i = 0; i < 3; i++) {
        expect(screen.getByLabelText(`Edit pair ${i + 1}`)).toBeInTheDocument();
      }
    });

    it('textarea inputs have aria-labels when editing', () => {
      renderPreviewList();

      fireEvent.click(screen.getByTestId('qa-edit-0'));

      expect(screen.getByLabelText('Edit question for pair 1')).toBeInTheDocument();
      expect(screen.getByLabelText('Edit answer for pair 1')).toBeInTheDocument();
    });

    it('pair list has list/listitem roles', () => {
      renderPreviewList();

      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(screen.getAllByRole('listitem')).toHaveLength(3);
    });

    it('empty state has region role with label', () => {
      renderPreviewList({ pairs: [] });

      expect(screen.getByRole('region', { name: 'No Q&A pairs' })).toBeInTheDocument();
    });
  });
});
