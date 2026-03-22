/**
 * UploadReviewStep Component Tests
 *
 * Tests the review/confirm UI displayed after file upload completes,
 * allowing users to publish, edit, or discard uploaded draft items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import {
  UploadReviewStep,
  type UploadReviewItem,
  type UploadReviewStepProps,
} from '@/components/upload-review-step';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const singleItem: UploadReviewItem = {
  id: 'item-1',
  title: 'ISO 27001 Security Policy',
  contentType: 'pdf',
  classification: {
    domain: 'Compliance',
    subtopic: 'ISO Standards',
    confidence: 0.92,
  },
  aiSummary:
    'This document outlines the ISO 27001 information security management system requirements including risk assessment, control selection, and continuous improvement processes for organisations seeking certification.',
  qualityScore: 72,
  suggestedLayer: {
    suggestedLayer: 'reference',
    reason: 'PDF documents are typically reference material',
    confidence: 'high',
  },
  warnings: [],
  dedupMatches: [],
};

const itemWithWarnings: UploadReviewItem = {
  ...singleItem,
  id: 'item-2',
  title: 'Bid Response Template',
  warnings: ['Embedding generation failed', 'Classification confidence low'],
  dedupMatches: [
    {
      id: 'dup-1',
      title: 'Existing Bid Template',
      similarity: 0.89,
      match_type: 'near_duplicate',
    },
  ],
};

const itemNoClassification: UploadReviewItem = {
  id: 'item-3',
  title: 'Meeting Notes Q4',
  contentType: 'note',
  warnings: [],
  dedupMatches: [],
};

const longSummaryItem: UploadReviewItem = {
  ...singleItem,
  id: 'item-4',
  title: 'Long Summary Item',
  aiSummary:
    'A'.repeat(250), // 250 characters — exceeds 200 char preview limit
};

function defaultProps(overrides: Partial<UploadReviewStepProps> = {}): UploadReviewStepProps {
  return {
    items: [singleItem],
    onPublish: vi.fn().mockResolvedValue(undefined),
    onPublishAll: vi.fn().mockResolvedValue(undefined),
    onDiscard: vi.fn().mockResolvedValue(undefined),
    onEditItem: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('UploadReviewStep', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Rendering', () => {
    it('renders the review header with item count', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.getByText('Review uploaded content')).toBeInTheDocument();
      expect(screen.getByText('1 item')).toBeInTheDocument();
    });

    it('renders plural item count for multiple items', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [singleItem, itemWithWarnings] })}
        />,
      );

      expect(screen.getByText('2 items')).toBeInTheDocument();
    });

    it('renders item title', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.getByText('ISO 27001 Security Policy')).toBeInTheDocument();
    });

    it('renders domain badge when classification exists', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.getByTestId('domain-badge')).toHaveTextContent('Compliance');
    });

    it('renders subtopic badge when classification exists', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.getByTestId('subtopic-badge')).toHaveTextContent('ISO Standards');
    });

    it('renders content type badge', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.getByTestId('content-type-badge')).toHaveTextContent('Pdf');
    });

    it('renders quality badge with calculated score', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      // Quality badge includes score text — look for it via aria-label
      const badge = screen.getByLabelText(/quality score/i);
      expect(badge).toBeInTheDocument();
    });

    it('renders without classification badges when no classification exists', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [itemNoClassification] })}
        />,
      );

      expect(screen.queryByTestId('domain-badge')).not.toBeInTheDocument();
      expect(screen.queryByTestId('subtopic-badge')).not.toBeInTheDocument();
      // Content type badge still present
      expect(screen.getByTestId('content-type-badge')).toBeInTheDocument();
    });
  });

  describe('AI summary preview', () => {
    it('displays AI summary text', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByText(/ISO 27001 information security management/),
      ).toBeInTheDocument();
    });

    it('truncates long summaries with Show more button', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [longSummaryItem] })}
        />,
      );

      expect(screen.getByText('Show more')).toBeInTheDocument();
    });

    it('expands truncated summary on Show more click', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [longSummaryItem] })}
        />,
      );

      fireEvent.click(screen.getByText('Show more'));
      expect(screen.getByText('Show less')).toBeInTheDocument();
      // Full text should now be visible (250 A's)
      expect(screen.getByText('A'.repeat(250))).toBeInTheDocument();
    });

    it('does not show summary section when aiSummary is absent', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [itemNoClassification] })}
        />,
      );

      expect(screen.queryByText('Show more')).not.toBeInTheDocument();
    });
  });

  describe('Warnings and dedup', () => {
    it('displays pipeline warnings', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [itemWithWarnings] })}
        />,
      );

      expect(screen.getByText('Embedding generation failed')).toBeInTheDocument();
      expect(screen.getByText('Classification confidence low')).toBeInTheDocument();
    });

    it('displays DedupWarning when dedupMatches exist', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [itemWithWarnings] })}
        />,
      );

      expect(screen.getByText('Existing Bid Template')).toBeInTheDocument();
    });

    it('does not display warnings section when warnings array is empty', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.queryByTestId('warnings-section')).not.toBeInTheDocument();
    });
  });

  describe('Publish action', () => {
    it('calls onPublish with item ID when Confirm & publish is clicked', async () => {
      const onPublish = vi.fn().mockResolvedValue(undefined);
      render(<UploadReviewStep {...defaultProps({ onPublish })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(onPublish).toHaveBeenCalledWith('item-1');
      });
    });

    it('shows loading state during publish', async () => {
      // Use a slow-resolving promise to observe loading state
      let resolvePublish: () => void;
      const publishPromise = new Promise<void>((resolve) => {
        resolvePublish = resolve;
      });
      const onPublish = vi.fn().mockReturnValue(publishPromise);

      render(<UploadReviewStep {...defaultProps({ onPublish })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(screen.getByText('Publishing...')).toBeInTheDocument();
      });

      resolvePublish!();

      await waitFor(() => {
        expect(screen.queryByText('Publishing...')).not.toBeInTheDocument();
      });
    });

    it('shows error message when publish fails', async () => {
      const onPublish = vi.fn().mockRejectedValue(new Error('Network error'));

      render(<UploadReviewStep {...defaultProps({ onPublish })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(screen.getByText('Network error')).toBeInTheDocument();
      });
    });
  });

  describe('Edit action', () => {
    it('calls onEditItem with item ID when Edit is clicked', () => {
      const onEditItem = vi.fn();
      render(<UploadReviewStep {...defaultProps({ onEditItem })} />);

      fireEvent.click(screen.getByTestId('edit-button'));

      expect(onEditItem).toHaveBeenCalledWith('item-1');
    });
  });

  describe('Discard action', () => {
    it('shows confirmation prompt when Discard is clicked', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      fireEvent.click(screen.getByTestId('discard-button'));

      expect(screen.getByText(/Are you sure you want to discard/)).toBeInTheDocument();
    });

    it('calls onDiscard when confirmation is accepted', async () => {
      const onDiscard = vi.fn().mockResolvedValue(undefined);
      render(<UploadReviewStep {...defaultProps({ onDiscard })} />);

      // Click discard, then confirm
      fireEvent.click(screen.getByTestId('discard-button'));
      fireEvent.click(screen.getByText('Yes, discard'));

      await waitFor(() => {
        expect(onDiscard).toHaveBeenCalledWith('item-1');
      });
    });

    it('dismisses confirmation when Cancel is clicked', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      fireEvent.click(screen.getByTestId('discard-button'));
      expect(screen.getByText(/Are you sure/)).toBeInTheDocument();

      fireEvent.click(screen.getByText('Cancel'));
      expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument();
    });

    it('shows loading state during discard', async () => {
      let resolveDiscard: () => void;
      const discardPromise = new Promise<void>((resolve) => {
        resolveDiscard = resolve;
      });
      const onDiscard = vi.fn().mockReturnValue(discardPromise);

      render(<UploadReviewStep {...defaultProps({ onDiscard })} />);

      fireEvent.click(screen.getByTestId('discard-button'));
      fireEvent.click(screen.getByText('Yes, discard'));

      await waitFor(() => {
        expect(screen.getByText('Discarding...')).toBeInTheDocument();
      });

      resolveDiscard!();

      await waitFor(() => {
        expect(screen.queryByText('Discarding...')).not.toBeInTheDocument();
      });
    });
  });

  describe('Batch operations', () => {
    it('shows Confirm all button for multi-item uploads', () => {
      render(
        <UploadReviewStep
          {...defaultProps({ items: [singleItem, itemWithWarnings] })}
        />,
      );

      expect(screen.getByTestId('publish-all-button')).toBeInTheDocument();
      expect(screen.getByTestId('publish-all-button')).toHaveTextContent('Confirm all (2)');
    });

    it('does not show bulk actions for single-item upload', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(screen.queryByTestId('bulk-actions')).not.toBeInTheDocument();
    });

    it('calls onPublishAll when Confirm all is clicked', async () => {
      const onPublishAll = vi.fn().mockResolvedValue(undefined);
      render(
        <UploadReviewStep
          {...defaultProps({ items: [singleItem, itemWithWarnings], onPublishAll })}
        />,
      );

      fireEvent.click(screen.getByTestId('publish-all-button'));

      await waitFor(() => {
        expect(onPublishAll).toHaveBeenCalled();
      });
    });
  });

  describe('Completion state', () => {
    it('shows completion state when all items are published', async () => {
      const onPublish = vi.fn().mockResolvedValue(undefined);
      render(<UploadReviewStep {...defaultProps({ onPublish })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(screen.getByText('All items reviewed')).toBeInTheDocument();
      });
    });

    it('shows Upload more files button after completion', async () => {
      const onPublish = vi.fn().mockResolvedValue(undefined);
      render(<UploadReviewStep {...defaultProps({ onPublish })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(screen.getByTestId('upload-more-button')).toBeInTheDocument();
      });
    });

    it('calls onDismiss when Upload more files is clicked', async () => {
      const onPublish = vi.fn().mockResolvedValue(undefined);
      const onDismiss = vi.fn();
      render(<UploadReviewStep {...defaultProps({ onPublish, onDismiss })} />);

      fireEvent.click(screen.getByTestId('publish-button'));

      await waitFor(() => {
        expect(screen.getByTestId('upload-more-button')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByTestId('upload-more-button'));
      expect(onDismiss).toHaveBeenCalled();
    });
  });

  describe('Accessibility', () => {
    it('has region role with correct aria-label', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByRole('region', { name: 'Review uploaded content' }),
      ).toBeInTheDocument();
    });

    it('each review card has article role with title in aria-label', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByRole('article', { name: 'Review: ISO 27001 Security Policy' }),
      ).toBeInTheDocument();
    });

    it('publish button has descriptive aria-label including title', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByLabelText('Confirm and publish ISO 27001 Security Policy'),
      ).toBeInTheDocument();
    });

    it('edit button has descriptive aria-label including title', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByLabelText('Edit ISO 27001 Security Policy before publishing'),
      ).toBeInTheDocument();
    });

    it('discard button has descriptive aria-label including title', () => {
      render(<UploadReviewStep {...defaultProps()} />);

      expect(
        screen.getByLabelText('Discard ISO 27001 Security Policy'),
      ).toBeInTheDocument();
    });
  });

  describe('Multiple items rendering', () => {
    it('renders review cards for each item', () => {
      render(
        <UploadReviewStep
          {...defaultProps({
            items: [singleItem, itemWithWarnings, itemNoClassification],
          })}
        />,
      );

      expect(screen.getByText('ISO 27001 Security Policy')).toBeInTheDocument();
      expect(screen.getByText('Bid Response Template')).toBeInTheDocument();
      expect(screen.getByText('Meeting Notes Q4')).toBeInTheDocument();
      expect(screen.getByText('3 items')).toBeInTheDocument();
    });

    it('individual publish removes one card while keeping others', async () => {
      const onPublish = vi.fn().mockResolvedValue(undefined);
      render(
        <UploadReviewStep
          {...defaultProps({
            items: [singleItem, itemWithWarnings],
            onPublish,
          })}
        />,
      );

      // Publish the first item
      const firstCard = screen.getByTestId('review-card-item-1');
      const publishBtn = within(firstCard).getByTestId('publish-button');
      fireEvent.click(publishBtn);

      await waitFor(() => {
        // First card should be gone, second should remain
        expect(screen.queryByTestId('review-card-item-1')).not.toBeInTheDocument();
        expect(screen.getByTestId('review-card-item-2')).toBeInTheDocument();
      });
    });
  });
});
