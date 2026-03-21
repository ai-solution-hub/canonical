/**
 * SourceDocumentDiffReview Component Tests
 *
 * Tests the diff review UI including summary rendering, diff entry badges,
 * filter tabs, content display, affected KB item links, similarity scores,
 * empty states, and unchanged entry visibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Mock next/link as a plain anchor
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import {
  SourceDocumentDiffReview,
  type SourceDocumentDiffReviewProps,
  type DiffReviewEntry,
} from '@/components/source-document-diff-review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const OLD_DOC = {
  id: 'doc-old-id',
  filename: 'policy-v1.docx',
  version: 1,
  uploaded_at: '2026-01-15T10:00:00Z',
};

const NEW_DOC = {
  id: 'doc-new-id',
  filename: 'policy-v2.docx',
  version: 2,
  uploaded_at: '2026-02-20T14:00:00Z',
};

function makeEntry(
  overrides: Partial<DiffReviewEntry> & { id: string; diff_type: DiffReviewEntry['diff_type'] },
): DiffReviewEntry {
  return {
    status: 'pending_review',
    ...overrides,
  };
}

const MODIFIED_ENTRY = makeEntry({
  id: 'diff-1',
  diff_type: 'modified',
  old_question: 'What is your data protection policy?',
  new_question: 'What is your data protection policy?',
  old_content: 'We follow GDPR guidelines and have appointed a DPO.',
  new_content: 'We comply with UK GDPR and Data Protection Act 2018.',
  similarity_score: 0.92,
  affected_item: { id: 'item-1', title: 'Data Protection Policy' },
});

const ADDED_ENTRY = makeEntry({
  id: 'diff-2',
  diff_type: 'added',
  new_question: 'What is your AI governance policy?',
  new_content: 'We have established an AI governance framework.',
});

const REMOVED_ENTRY = makeEntry({
  id: 'diff-3',
  diff_type: 'removed',
  old_question: 'Do you use third-party processors?',
  old_content: 'Yes, we use AWS and Supabase.',
  affected_item: { id: 'item-2', title: 'Third-Party Processors' },
  status: 'dismissed',
});

const UNCHANGED_ENTRY = makeEntry({
  id: 'diff-4',
  diff_type: 'unchanged',
  old_question: 'What is your company name?',
  old_content: 'Acme Ltd.',
  new_question: 'What is your company name?',
  new_content: 'Acme Ltd.',
});

const DEFAULT_ENTRIES = [MODIFIED_ENTRY, ADDED_ENTRY, REMOVED_ENTRY, UNCHANGED_ENTRY];

const DEFAULT_SUMMARY = {
  added: 1,
  removed: 1,
  modified: 1,
  unchanged: 1,
};

function renderComponent(overrides?: Partial<SourceDocumentDiffReviewProps>) {
  const props: SourceDocumentDiffReviewProps = {
    oldDocument: OLD_DOC,
    newDocument: NEW_DOC,
    summary: DEFAULT_SUMMARY,
    entries: DEFAULT_ENTRIES,
    ...overrides,
  };
  return render(<SourceDocumentDiffReview {...props} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SourceDocumentDiffReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Summary rendering
  // -------------------------------------------------------------------------

  describe('summary', () => {
    it('renders the document filenames and versions in the header', () => {
      renderComponent();
      expect(
        screen.getByText(/policy-v1\.docx \(v1\).*policy-v2\.docx \(v2\)/),
      ).toBeInTheDocument();
    });

    it('renders the page heading', () => {
      renderComponent();
      expect(
        screen.getByRole('heading', { name: 'Document Diff Review' }),
      ).toBeInTheDocument();
    });

    it('displays summary counts for each diff type', () => {
      renderComponent({
        summary: { added: 3, removed: 2, modified: 5, unchanged: 10 },
      });

      const summaryRegion = screen.getByRole('status', {
        name: 'Diff summary',
      });
      expect(within(summaryRegion).getByText('Modified')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('Added')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('Removed')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('Unchanged')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('5')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('3')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('2')).toBeInTheDocument();
      expect(within(summaryRegion).getByText('10')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Diff entry badges
  // -------------------------------------------------------------------------

  describe('badges', () => {
    it('shows "Added" badge for added entries', () => {
      renderComponent({ entries: [ADDED_ENTRY], summary: { ...DEFAULT_SUMMARY, added: 1 } });
      expect(screen.getByLabelText('Diff type: Added')).toBeInTheDocument();
    });

    it('shows "Modified" badge for modified entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY], summary: { ...DEFAULT_SUMMARY, modified: 1 } });
      expect(screen.getByLabelText('Diff type: Modified')).toBeInTheDocument();
    });

    it('shows "Removed" badge for removed entries', () => {
      renderComponent({ entries: [REMOVED_ENTRY], summary: { ...DEFAULT_SUMMARY, removed: 1 } });
      expect(screen.getByLabelText('Diff type: Removed')).toBeInTheDocument();
    });

    it('applies correct CSS classes for added badge', () => {
      renderComponent({ entries: [ADDED_ENTRY], summary: { ...DEFAULT_SUMMARY } });
      const badge = screen.getByLabelText('Diff type: Added');
      expect(badge.className).toContain('text-quality-good');
      expect(badge.className).toContain('bg-quality-good-bg');
    });

    it('applies correct CSS classes for modified badge', () => {
      renderComponent({ entries: [MODIFIED_ENTRY], summary: { ...DEFAULT_SUMMARY } });
      const badge = screen.getByLabelText('Diff type: Modified');
      expect(badge.className).toContain('text-freshness-aging');
      expect(badge.className).toContain('bg-freshness-aging-bg');
    });

    it('applies correct CSS classes for removed badge', () => {
      renderComponent({ entries: [REMOVED_ENTRY], summary: { ...DEFAULT_SUMMARY } });
      const badge = screen.getByLabelText('Diff type: Removed');
      expect(badge.className).toContain('text-destructive');
      expect(badge.className).toContain('bg-destructive/10');
    });

    it('shows status badge with correct label for pending_review', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(screen.getByLabelText('Status: Needs Review')).toBeInTheDocument();
    });

    it('shows status badge with correct label for dismissed', () => {
      renderComponent({ entries: [REMOVED_ENTRY] });
      expect(screen.getByLabelText('Status: Dismissed')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Filter tabs
  // -------------------------------------------------------------------------

  describe('filter tabs', () => {
    it('renders all filter tabs', () => {
      renderComponent();
      expect(screen.getByRole('tab', { name: /show all entries/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /show added entries/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /show modified entries/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /show removed entries/i })).toBeInTheDocument();
    });

    it('shows "All" tab as selected by default', () => {
      renderComponent();
      const allTab = screen.getByRole('tab', { name: /show all entries/i });
      expect(allTab).toHaveAttribute('aria-selected', 'true');
    });

    it('filters to show only added entries when "Added" tab is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(screen.getByRole('tab', { name: /show added entries/i }));

      // Added entry should be visible
      expect(
        screen.getByText('Q: What is your AI governance policy?'),
      ).toBeInTheDocument();

      // Modified and removed entries should be hidden
      expect(
        screen.queryByText('Q: What is your data protection policy?'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('Q: Do you use third-party processors?'),
      ).not.toBeInTheDocument();
    });

    it('filters to show only modified entries when "Modified" tab is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(
        screen.getByRole('tab', { name: /show modified entries/i }),
      );

      expect(
        screen.getByText('Q: What is your data protection policy?'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Q: What is your AI governance policy?'),
      ).not.toBeInTheDocument();
    });

    it('filters to show only removed entries when "Removed" tab is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      await user.click(
        screen.getByRole('tab', { name: /show removed entries/i }),
      );

      expect(
        screen.getByText('Q: Do you use third-party processors?'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Q: What is your AI governance policy?'),
      ).not.toBeInTheDocument();
    });

    it('returns to showing all entries when "All" tab is clicked', async () => {
      const user = userEvent.setup();
      renderComponent();

      // Switch to Added
      await user.click(screen.getByRole('tab', { name: /show added entries/i }));
      // Switch back to All
      await user.click(screen.getByRole('tab', { name: /show all entries/i }));

      expect(
        screen.getByText('Q: What is your data protection policy?'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Q: What is your AI governance policy?'),
      ).toBeInTheDocument();
      expect(
        screen.getByText('Q: Do you use third-party processors?'),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Modified entries — old and new content
  // -------------------------------------------------------------------------

  describe('modified entries', () => {
    it('shows both old and new content for modified entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });

      expect(screen.getByText('Old answer:')).toBeInTheDocument();
      expect(
        screen.getByText(
          'We follow GDPR guidelines and have appointed a DPO.',
        ),
      ).toBeInTheDocument();

      expect(screen.getByText('New answer:')).toBeInTheDocument();
      expect(
        screen.getByText(
          'We comply with UK GDPR and Data Protection Act 2018.',
        ),
      ).toBeInTheDocument();
    });

    it('shows question change indicator when question text differs', () => {
      const entry = makeEntry({
        id: 'diff-changed-q',
        diff_type: 'modified',
        old_question: 'What is GDPR?',
        new_question: 'What is UK GDPR compliance?',
        old_content: 'Old answer',
        new_content: 'New answer',
        similarity_score: 0.85,
      });
      renderComponent({ entries: [entry] });

      expect(
        screen.getByText(/Question changed to:/),
      ).toBeInTheDocument();
      expect(
        screen.getByText('What is UK GDPR compliance?', { selector: 'em' }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Affected KB items
  // -------------------------------------------------------------------------

  describe('affected KB items', () => {
    it('renders affected item as a link to /item/[id]', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });

      const link = screen.getByRole('link', {
        name: /view affected item: data protection policy/i,
      });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute('href', '/item/item-1');
    });

    it('does not show affected item section when no affected item', () => {
      renderComponent({ entries: [ADDED_ENTRY] });
      expect(screen.queryByText('Affected KB item:')).not.toBeInTheDocument();
    });

    it('renders multiple affected items across entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY, REMOVED_ENTRY] });

      expect(
        screen.getByRole('link', {
          name: /view affected item: data protection policy/i,
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', {
          name: /view affected item: third-party processors/i,
        }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Similarity score
  // -------------------------------------------------------------------------

  describe('similarity score', () => {
    it('displays similarity percentage for modified entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(screen.getByText('(similarity: 92%)')).toBeInTheDocument();
    });

    it('has aria-label for similarity score', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByLabelText('Similarity: 92%'),
      ).toBeInTheDocument();
    });

    it('does not show similarity for added entries', () => {
      renderComponent({ entries: [ADDED_ENTRY] });
      expect(screen.queryByText(/similarity:/)).not.toBeInTheDocument();
    });

    it('does not show similarity for removed entries', () => {
      renderComponent({ entries: [REMOVED_ENTRY] });
      expect(screen.queryByText(/similarity:/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Empty state
  // -------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows empty message when there are no entries', () => {
      renderComponent({
        entries: [],
        summary: { added: 0, removed: 0, modified: 0, unchanged: 0 },
      });
      expect(
        screen.getByText('No diff entries found.'),
      ).toBeInTheDocument();
    });

    it('shows filter message when filter produces no results', async () => {
      const user = userEvent.setup();
      renderComponent({
        entries: [MODIFIED_ENTRY],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      await user.click(screen.getByRole('tab', { name: /show added entries/i }));

      expect(
        screen.getByText('No entries match the current filter.'),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Unchanged entries — hidden by default
  // -------------------------------------------------------------------------

  describe('unchanged entries', () => {
    it('hides unchanged entries by default', () => {
      renderComponent();
      expect(
        screen.queryByText('Q: What is your company name?'),
      ).not.toBeInTheDocument();
    });

    it('shows unchanged entries when toggle is checked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const toggle = screen.getByLabelText('Show unchanged entries');
      await user.click(toggle);

      expect(
        screen.getByText('Q: What is your company name?'),
      ).toBeInTheDocument();
    });

    it('hides unchanged entries again when toggle is unchecked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const toggle = screen.getByLabelText('Show unchanged entries');
      // Show
      await user.click(toggle);
      expect(
        screen.getByText('Q: What is your company name?'),
      ).toBeInTheDocument();

      // Hide again
      await user.click(toggle);
      expect(
        screen.queryByText('Q: What is your company name?'),
      ).not.toBeInTheDocument();
    });

    it('shows unchanged count in the toggle label', () => {
      renderComponent({
        summary: { added: 0, removed: 0, modified: 0, unchanged: 5 },
      });
      expect(screen.getByText(/Show unchanged \(5\)/)).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Accessibility
  // -------------------------------------------------------------------------

  describe('accessibility', () => {
    it('has a back link with aria-label', () => {
      renderComponent();
      expect(
        screen.getByRole('link', { name: 'Back to browse' }),
      ).toBeInTheDocument();
    });

    it('has a tablist for filter buttons', () => {
      renderComponent();
      expect(
        screen.getByRole('tablist', { name: 'Filter diff entries' }),
      ).toBeInTheDocument();
    });

    it('has a region for diff entries with aria-live', () => {
      renderComponent();
      const region = screen.getByRole('region', { name: 'Diff entries' });
      expect(region).toHaveAttribute('aria-live', 'polite');
    });

    it('each diff entry card has an aria-label', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('article', {
          name: /modified entry: what is your data protection policy/i,
        }),
      ).toBeInTheDocument();
    });

    it('diff type badges have aria-labels', () => {
      renderComponent({ entries: [ADDED_ENTRY] });
      expect(
        screen.getByLabelText('Diff type: Added'),
      ).toBeInTheDocument();
    });

    it('status badges have aria-labels', () => {
      renderComponent({ entries: [REMOVED_ENTRY] });
      expect(
        screen.getByLabelText('Status: Dismissed'),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Content display for different diff types
  // -------------------------------------------------------------------------

  describe('content display', () => {
    it('shows only new content for added entries', () => {
      renderComponent({ entries: [ADDED_ENTRY] });
      expect(screen.getByText('Answer:')).toBeInTheDocument();
      expect(
        screen.getByText('We have established an AI governance framework.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Old answer:')).not.toBeInTheDocument();
      expect(screen.queryByText('New answer:')).not.toBeInTheDocument();
    });

    it('shows only old content for removed entries', () => {
      renderComponent({ entries: [REMOVED_ENTRY] });
      expect(screen.getByText('Answer:')).toBeInTheDocument();
      expect(
        screen.getByText('Yes, we use AWS and Supabase.'),
      ).toBeInTheDocument();
      expect(screen.queryByText('Old answer:')).not.toBeInTheDocument();
      expect(screen.queryByText('New answer:')).not.toBeInTheDocument();
    });
  });
});
