/**
 * SourceDocumentDiffReview Component Tests
 *
 * Tests the diff review UI including summary rendering, diff entry badges,
 * filter tabs, content display, affected KB item links, similarity scores,
 * empty states, unchanged entry visibility, action buttons, bulk actions,
 * and side-by-side view toggle.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
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

// Mock lucide-react icons
vi.mock('lucide-react', () => ({
  ChevronRight: ({ className, ...props }: Record<string, unknown>) => (
    <span data-testid="chevron-right" className={className as string} {...props} />
  ),
  CheckCircle2: ({ className, ...props }: Record<string, unknown>) => (
    <span data-testid="check-circle" className={className as string} {...props} />
  ),
  Loader2: ({ className, ...props }: Record<string, unknown>) => (
    <span data-testid="loader" className={className as string} {...props} />
  ),
}));

import {
  SourceDocumentDiffReview,
  type SourceDocumentDiffReviewProps,
  type DiffReviewEntry,
} from '@/components/source-document/source-document-diff-review';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

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
    documentId: 'test-doc-id',
    oldDocument: OLD_DOC,
    newDocument: NEW_DOC,
    summary: DEFAULT_SUMMARY,
    entries: DEFAULT_ENTRIES,
    ...overrides,
  };
  const { Wrapper } = createQueryWrapper();
  return render(<SourceDocumentDiffReview {...props} />, { wrapper: Wrapper });
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
      // Header now includes formatted dates, so match filenames within the banner element.
      // policy-v2.docx also appears in the back link, so scope to <header>.
      const header = screen.getByRole('banner');
      expect(within(header).getByText(/policy-v1\.docx/)).toBeInTheDocument();
      expect(within(header).getByText(/policy-v2\.docx/)).toBeInTheDocument();
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

      const summaryRegion = screen.getByLabelText('Diff summary');
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

      const toggle = screen.getByRole('checkbox', { name: /Show unchanged/ });
      await user.click(toggle);

      expect(
        screen.getByText('Q: What is your company name?'),
      ).toBeInTheDocument();
    });

    it('hides unchanged entries again when toggle is unchecked', async () => {
      const user = userEvent.setup();
      renderComponent();

      const toggle = screen.getByRole('checkbox', { name: /Show unchanged/ });
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
    it('has breadcrumb navigation with correct links', () => {
      renderComponent();
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      expect(breadcrumb).toBeInTheDocument();

      const sourceDocsLink = within(breadcrumb).getByRole('link', { name: 'Source Documents' });
      expect(sourceDocsLink).toHaveAttribute('href', '/documents');

      const filenameLink = within(breadcrumb).getByRole('link', { name: 'policy-v2.docx' });
      expect(filenameLink).toHaveAttribute('href', '/documents/doc-new-id');

      expect(within(breadcrumb).getByText('Diff Review')).toBeInTheDocument();
    });

    it('breadcrumb has aria-current on the current page', () => {
      renderComponent();
      const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
      const currentItem = within(breadcrumb).getByText('Diff Review');
      expect(currentItem.closest('li')).toHaveAttribute('aria-current', 'page');
    });

    it('has ChevronRight separators in breadcrumb', () => {
      renderComponent();
      const chevrons = screen.getAllByTestId('chevron-right');
      expect(chevrons.length).toBe(2);
    });

    it('has a tablist for filter buttons', () => {
      renderComponent();
      expect(
        screen.getByRole('tablist', { name: 'Filter diff entries' }),
      ).toBeInTheDocument();
    });

    it('has a tabpanel for diff entries with aria-live', () => {
      renderComponent();
      const panel = screen.getByRole('tabpanel');
      expect(panel).toHaveAttribute('aria-live', 'polite');
    });

    it('entries container has role="feed"', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('feed', { name: 'Diff review entries' }),
      ).toBeInTheDocument();
    });

    it('each diff entry has role="article" with aria-setsize and aria-posinset', () => {
      renderComponent({ entries: [MODIFIED_ENTRY, ADDED_ENTRY] });
      const articles = screen.getAllByRole('article');
      expect(articles).toHaveLength(2);
      expect(articles[0]).toHaveAttribute('aria-setsize', '2');
      expect(articles[0]).toHaveAttribute('aria-posinset', '1');
      expect(articles[1]).toHaveAttribute('aria-setsize', '2');
      expect(articles[1]).toHaveAttribute('aria-posinset', '2');
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

  // -------------------------------------------------------------------------
  // Per-entry action buttons
  // -------------------------------------------------------------------------

  describe('action buttons', () => {
    it('shows Apply button on pending_review entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('button', { name: 'Apply this change' }),
      ).toBeInTheDocument();
    });

    it('shows Dismiss button on pending_review entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('button', { name: 'Dismiss this change' }),
      ).toBeInTheDocument();
    });

    it('shows Reset button on applied/dismissed entries', () => {
      const appliedEntry = makeEntry({
        id: 'diff-applied',
        diff_type: 'modified',
        old_content: 'old',
        new_content: 'new',
        status: 'applied',
      });
      renderComponent({ entries: [appliedEntry] });
      expect(
        screen.getByRole('button', { name: 'Reset to pending review' }),
      ).toBeInTheDocument();
    });

    it('does not show action buttons on unchanged entries', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [UNCHANGED_ENTRY] });

      // Show unchanged entries
      const toggle = screen.getByRole('checkbox', { name: /Show unchanged/ });
      await user.click(toggle);

      expect(
        screen.queryByRole('button', { name: 'Apply this change' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Dismiss this change' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Reset to pending review' }),
      ).not.toBeInTheDocument();
    });

    it('optimistically updates status when Apply is clicked', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [{ id: 'diff-1', status: 'applied', updated_at: new Date().toISOString() }],
          summary: { pending_review: 0, applied: 2, dismissed: 1 },
        }),
      });

      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Apply this change' }));

      // After click, the entry should show Reset button (optimistic update)
      await waitFor(() => {
        expect(
          screen.getByRole('button', { name: 'Reset to pending review' }),
        ).toBeInTheDocument();
      });
    });

    it('action buttons are disabled while loading', async () => {
      const user = userEvent.setup();
      // Never resolve the fetch to keep loading state
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Apply this change' }));

      // The Reset button (from optimistic update) should be disabled
      await waitFor(() => {
        const resetButton = screen.getByRole('button', { name: 'Reset to pending review' });
        expect(resetButton).toBeDisabled();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Bulk actions toolbar
  // -------------------------------------------------------------------------

  describe('bulk actions', () => {
    it('shows Accept All Pending button', () => {
      renderComponent();
      expect(
        screen.getByRole('button', { name: 'Accept all pending changes' }),
      ).toBeInTheDocument();
    });

    it('shows Dismiss All Pending button', () => {
      renderComponent();
      expect(
        screen.getByRole('button', { name: 'Dismiss all pending changes' }),
      ).toBeInTheDocument();
    });

    it('shows Reset All button when entries are reviewed', () => {
      renderComponent();
      // REMOVED_ENTRY has status 'dismissed', so Reset All should be visible
      expect(
        screen.getByRole('button', { name: 'Reset all reviewed changes to pending' }),
      ).toBeInTheDocument();
    });

    it('disables bulk buttons when no pending entries', () => {
      const allApplied = [
        makeEntry({ id: 'e1', diff_type: 'modified', status: 'applied', old_content: 'a', new_content: 'b' }),
        makeEntry({ id: 'e2', diff_type: 'added', status: 'applied', new_content: 'c' }),
      ];
      renderComponent({ entries: allApplied });

      const acceptBtn = screen.getByRole('button', { name: 'Accept all pending changes' });
      const dismissBtn = screen.getByRole('button', { name: 'Dismiss all pending changes' });
      expect(acceptBtn).toBeDisabled();
      expect(dismissBtn).toBeDisabled();
    });

    it('bulk Accept All Pending triggers fetch', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [],
          summary: { pending_review: 0, applied: 3, dismissed: 1 },
        }),
      });

      renderComponent();

      await user.click(
        screen.getByRole('button', { name: 'Accept all pending changes' }),
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/source-documents/test-doc-id/diff',
          expect.objectContaining({ method: 'PATCH' }),
        );
      });
    });

    it('bulk Dismiss All Pending triggers fetch', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [],
          summary: { pending_review: 0, applied: 0, dismissed: 3 },
        }),
      });

      renderComponent();

      await user.click(
        screen.getByRole('button', { name: 'Dismiss all pending changes' }),
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/source-documents/test-doc-id/diff',
          expect.objectContaining({ method: 'PATCH' }),
        );
      });
    });

    it('displays status counts in the bulk toolbar', () => {
      renderComponent();
      const toolbar = screen.getByRole('toolbar', { name: 'Bulk review actions' });
      // 2 pending (MODIFIED + ADDED), 0 applied, 1 dismissed (REMOVED)
      expect(within(toolbar).getByText(/2 pending/)).toBeInTheDocument();
      expect(within(toolbar).getByText(/1 dismissed/)).toBeInTheDocument();
    });

    it('summary counts update after status change', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [{ id: 'diff-1', status: 'applied' }],
          summary: { pending_review: 0, applied: 1, dismissed: 0 },
        }),
      });

      // Use a single pending entry to avoid multiple "Apply this change" buttons
      const singleEntry = makeEntry({
        id: 'diff-1',
        diff_type: 'modified',
        old_content: 'old text',
        new_content: 'new text',
        status: 'pending_review',
      });
      renderComponent({
        entries: [singleEntry],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      await user.click(screen.getByRole('button', { name: 'Apply this change' }));

      await waitFor(() => {
        const summaryRegion = screen.getByLabelText('Diff summary');
        expect(within(summaryRegion).getByText(/0 pending/)).toBeInTheDocument();
        expect(within(summaryRegion).getByText(/1 applied/)).toBeInTheDocument();
      });
    });
  });

  // -------------------------------------------------------------------------
  // Side-by-side view toggle
  // -------------------------------------------------------------------------

  describe('side-by-side view', () => {
    it('shows view mode toggle when modified entries exist', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('radiogroup', { name: 'View mode' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: 'Card View' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: 'Side-by-Side' }),
      ).toBeInTheDocument();
    });

    it('hides view mode toggle when no modified entries exist', () => {
      renderComponent({
        entries: [ADDED_ENTRY, REMOVED_ENTRY],
        summary: { added: 1, removed: 1, modified: 0, unchanged: 0 },
      });
      expect(
        screen.queryByRole('radiogroup', { name: 'View mode' }),
      ).not.toBeInTheDocument();
    });

    it('shows Card View as default selected', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      const cardRadio = screen.getByRole('radio', { name: 'Card View' });
      expect(cardRadio).toHaveAttribute('aria-checked', 'true');
    });

    it('switches to side-by-side layout when toggled', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('radio', { name: 'Side-by-Side' }));

      const sideBySideRadio = screen.getByRole('radio', { name: 'Side-by-Side' });
      expect(sideBySideRadio).toHaveAttribute('aria-checked', 'true');

      // In side-by-side mode, a grid container should be present
      // The grid layout has md:grid-cols-2 class
      const grids = document.querySelectorAll('.grid');
      expect(grids.length).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Completion banner
  // -------------------------------------------------------------------------

  describe('completion banner', () => {
    it('does not show when entries are still pending', () => {
      renderComponent();
      expect(
        screen.queryByRole('status', { name: 'Review complete' }),
      ).not.toBeInTheDocument();
    });

    it('shows when all actionable entries are reviewed', () => {
      const allReviewed = [
        makeEntry({ id: 'e1', diff_type: 'modified', status: 'applied', old_content: 'a', new_content: 'b', affected_item: { id: 'item-1', title: 'Item One' } }),
        makeEntry({ id: 'e2', diff_type: 'added', status: 'dismissed', new_content: 'c' }),
        // Unchanged entries do not count — their status is irrelevant
        makeEntry({ id: 'e3', diff_type: 'unchanged', old_content: 'x' }),
      ];
      renderComponent({
        entries: allReviewed,
        summary: { added: 1, removed: 0, modified: 1, unchanged: 1 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      expect(banner).toBeInTheDocument();
      expect(within(banner).getByText('All changes reviewed')).toBeInTheDocument();
      expect(within(banner).getByText(/1 applied, 1 dismissed/)).toBeInTheDocument();
    });

    it('lists affected KB items with links', () => {
      const allReviewed = [
        makeEntry({ id: 'e1', diff_type: 'modified', status: 'applied', old_content: 'a', new_content: 'b', affected_item: { id: 'item-1', title: 'Data Policy' } }),
        makeEntry({ id: 'e2', diff_type: 'removed', status: 'dismissed', old_content: 'c', affected_item: { id: 'item-2', title: 'Access Control' } }),
      ];
      renderComponent({
        entries: allReviewed,
        summary: { added: 0, removed: 1, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      const dataLink = within(banner).getByRole('link', { name: 'Data Policy' });
      expect(dataLink).toHaveAttribute('href', '/item/item-1');
      const accessLink = within(banner).getByRole('link', { name: 'Access Control' });
      expect(accessLink).toHaveAttribute('href', '/item/item-2');
    });

    it('does not show when there are no actionable entries', () => {
      renderComponent({
        entries: [UNCHANGED_ENTRY],
        summary: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      });
      expect(
        screen.queryByRole('status', { name: 'Review complete' }),
      ).not.toBeInTheDocument();
    });

    it('shows check icon in completion banner', () => {
      const allReviewed = [
        makeEntry({ id: 'e1', diff_type: 'modified', status: 'applied', old_content: 'a', new_content: 'b' }),
      ];
      renderComponent({
        entries: allReviewed,
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      expect(within(banner).getByTestId('check-circle')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Progress indicator
  // -------------------------------------------------------------------------

  describe('progress indicator', () => {
    it('shows "Reviewed X of Y" for actionable entries', () => {
      renderComponent();
      // 1 dismissed (REMOVED_ENTRY) out of 3 actionable (MODIFIED + ADDED + REMOVED)
      expect(screen.getByText('Reviewed 1 of 3')).toBeInTheDocument();
    });

    it('updates count after status change', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [{ id: 'diff-1', status: 'applied' }],
          summary: { pending_review: 1, applied: 1, dismissed: 1 },
        }),
      });

      renderComponent();
      expect(screen.getByText('Reviewed 1 of 3')).toBeInTheDocument();

      // Apply the first entry
      const applyButtons = screen.getAllByRole('button', { name: 'Apply this change' });
      await user.click(applyButtons[0]);

      await waitFor(() => {
        expect(screen.getByText('Reviewed 2 of 3')).toBeInTheDocument();
      });
    });

    it('does not show when no actionable entries exist', () => {
      renderComponent({
        entries: [UNCHANGED_ENTRY],
        summary: { added: 0, removed: 0, modified: 0, unchanged: 1 },
      });
      expect(screen.queryByText(/Reviewed \d+ of \d+/)).not.toBeInTheDocument();
    });

    it('has aria-live for screen reader updates', () => {
      renderComponent();
      const progress = screen.getByText('Reviewed 1 of 3');
      expect(progress).toHaveAttribute('aria-live', 'polite');
    });
  });

  // -------------------------------------------------------------------------
  // Reviewer notes
  // -------------------------------------------------------------------------

  describe('reviewer notes', () => {
    it('shows "Add note" button on actionable entries', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('button', { name: 'Add a reviewer note' }),
      ).toBeInTheDocument();
    });

    it('does not show "Add note" button on unchanged entries', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [UNCHANGED_ENTRY] });

      const toggle = screen.getByRole('checkbox', { name: /Show unchanged/ });
      await user.click(toggle);

      expect(
        screen.queryByRole('button', { name: 'Add a reviewer note' }),
      ).not.toBeInTheDocument();
    });

    it('expands textarea when "Add note" is clicked', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Add a reviewer note' }));

      expect(
        screen.getByLabelText('Reviewer note'),
      ).toBeInTheDocument();
    });

    it('shows existing note in expanded state', () => {
      const entryWithNote = makeEntry({
        id: 'diff-noted',
        diff_type: 'modified',
        old_content: 'old',
        new_content: 'new',
        reviewer_note: 'This was checked by the legal team.',
      });
      renderComponent({ entries: [entryWithNote] });

      const textarea = screen.getByLabelText('Reviewer note');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('This was checked by the legal team.');
    });

    it('includes note in PATCH payload when status changes', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          updated: [{ id: 'diff-1', status: 'applied', updated_at: new Date().toISOString() }],
          summary: { pending_review: 0, applied: 1, dismissed: 0 },
        }),
      });

      renderComponent({
        entries: [MODIFIED_ENTRY],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      // Expand the note textarea
      await user.click(screen.getByRole('button', { name: 'Add a reviewer note' }));
      const textarea = screen.getByLabelText('Reviewer note');
      await user.type(textarea, 'Approved by legal');

      // Apply the change
      await user.click(screen.getByRole('button', { name: 'Apply this change' }));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          '/api/source-documents/test-doc-id/diff',
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('Approved by legal'),
          }),
        );
      });
    });

    it('shows character count when note textarea is expanded', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Add a reviewer note' }));

      expect(screen.getByText('0/500')).toBeInTheDocument();
    });

    it('updates character count as user types', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Add a reviewer note' }));
      const textarea = screen.getByLabelText('Reviewer note');
      await user.type(textarea, 'Test note');

      expect(screen.getByText('9/500')).toBeInTheDocument();
    });

    it('textarea has maxLength attribute of 500', async () => {
      const user = userEvent.setup();
      renderComponent({ entries: [MODIFIED_ENTRY] });

      await user.click(screen.getByRole('button', { name: 'Add a reviewer note' }));
      const textarea = screen.getByLabelText('Reviewer note');

      expect(textarea).toHaveAttribute('maxLength', '500');
    });

    it('displays saved note in read-only view for reviewed entries', () => {
      const reviewedEntry = makeEntry({
        id: 'diff-reviewed',
        diff_type: 'modified',
        old_content: 'old',
        new_content: 'new',
        status: 'applied',
        reviewer_note: 'Verified by compliance team.',
      });
      renderComponent({ entries: [reviewedEntry] });

      const noteRegion = screen.getByLabelText('Saved reviewer note');
      expect(noteRegion).toBeInTheDocument();
      expect(screen.getByText('Verified by compliance team.')).toBeInTheDocument();
    });

    it('shows "Edit note" button on reviewed entries with saved notes', () => {
      const reviewedEntry = makeEntry({
        id: 'diff-reviewed',
        diff_type: 'modified',
        old_content: 'old',
        new_content: 'new',
        status: 'applied',
        reviewer_note: 'Verified by compliance team.',
      });
      renderComponent({ entries: [reviewedEntry] });

      expect(
        screen.getByRole('button', { name: 'Edit reviewer note' }),
      ).toBeInTheDocument();
    });

    it('switches to editable textarea when "Edit note" is clicked on reviewed entry', async () => {
      const user = userEvent.setup();
      const reviewedEntry = makeEntry({
        id: 'diff-reviewed',
        diff_type: 'modified',
        old_content: 'old',
        new_content: 'new',
        status: 'applied',
        reviewer_note: 'Verified by compliance team.',
      });
      renderComponent({ entries: [reviewedEntry] });

      await user.click(screen.getByRole('button', { name: 'Edit reviewer note' }));

      const textarea = screen.getByLabelText('Reviewer note');
      expect(textarea).toBeInTheDocument();
      expect(textarea).toHaveValue('Verified by compliance team.');
    });

    it('shows "Add note" button on pending entries without existing note', () => {
      renderComponent({ entries: [MODIFIED_ENTRY] });
      expect(
        screen.getByRole('button', { name: 'Add a reviewer note' }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Send to Review Queue
  // -------------------------------------------------------------------------

  describe('send to review queue', () => {
    // Helper: entries where all actionable are reviewed + have affected items
    const allReviewedWithAffected = [
      makeEntry({
        id: 'e1',
        diff_type: 'modified',
        status: 'applied',
        old_content: 'old text',
        new_content: 'new text',
        affected_item: { id: 'item-1', title: 'Data Policy' },
      }),
      makeEntry({
        id: 'e2',
        diff_type: 'removed',
        status: 'dismissed',
        old_content: 'old removed',
        affected_item: { id: 'item-2', title: 'Access Control' },
      }),
    ];

    const allReviewedNoAffected = [
      makeEntry({
        id: 'e1',
        diff_type: 'modified',
        status: 'applied',
        old_content: 'old',
        new_content: 'new',
      }),
      makeEntry({
        id: 'e2',
        diff_type: 'added',
        status: 'dismissed',
        new_content: 'added content',
      }),
    ];

    // 12. Send button visible when all reviewed + affected items exist
    it('shows "Send to Review Queue" button when all entries reviewed and affected items exist', () => {
      renderComponent({
        entries: allReviewedWithAffected,
        summary: { added: 0, removed: 1, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      expect(
        within(banner).getByRole('button', { name: /send 2 affected items to review queue/i }),
      ).toBeInTheDocument();
    });

    // 13. Button not visible when no affected items
    it('does not show send button when no affected items exist', () => {
      renderComponent({
        entries: allReviewedNoAffected,
        summary: { added: 1, removed: 0, modified: 1, unchanged: 0 },
      });

      // Banner should be visible but no send button (the affected items section isn't rendered)
      const banner = screen.getByRole('status', { name: 'Review complete' });
      expect(banner).toBeInTheDocument();
      expect(
        within(banner).queryByRole('button', { name: /send.*to review queue/i }),
      ).not.toBeInTheDocument();
    });

    // 14. Loading state during API call
    it('shows loading state during API call', async () => {
      const user = userEvent.setup();
      // Never resolve to keep loading state
      mockFetch.mockReturnValueOnce(new Promise(() => {}));

      renderComponent({
        entries: allReviewedWithAffected,
        summary: { added: 0, removed: 1, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      await user.click(
        within(banner).getByRole('button', { name: /send 2 affected items to review queue/i }),
      );

      await waitFor(() => {
        expect(
          within(banner).getByRole('button', { name: /sending items to review queue/i }),
        ).toBeInTheDocument();
        expect(within(banner).getByText('Sending...')).toBeInTheDocument();
      });
    });

    // 15. Success state shows count + review queue link
    it('shows success state with count and review queue link', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          sent: 2,
          already_pending: 0,
          skipped_draft: 0,
          total_requested: 2,
          sent_ids: ['item-1', 'item-2'],
          review_url: '/review?status=all&source_document_id=test-doc-id',
        }),
      });

      renderComponent({
        entries: allReviewedWithAffected,
        summary: { added: 0, removed: 1, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      await user.click(
        within(banner).getByRole('button', { name: /send 2 affected items to review queue/i }),
      );

      await waitFor(() => {
        expect(within(banner).getByText(/2 items sent to review queue/)).toBeInTheDocument();
        const reviewLink = within(banner).getByRole('link', { name: /view items in review queue/i });
        expect(reviewLink).toHaveAttribute(
          'href',
          '/review?status=all&source_document_id=test-doc-id',
        );
      });
    });

    // 16. Error state shows retry
    it('shows error state with retry option', async () => {
      const user = userEvent.setup();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      renderComponent({
        entries: allReviewedWithAffected,
        summary: { added: 0, removed: 1, modified: 1, unchanged: 0 },
      });

      const banner = screen.getByRole('status', { name: 'Review complete' });
      await user.click(
        within(banner).getByRole('button', { name: /send 2 affected items to review queue/i }),
      );

      await waitFor(() => {
        expect(within(banner).getByText(/failed to send items to review queue/i)).toBeInTheDocument();
        expect(
          within(banner).getByRole('button', { name: /retry sending items to review queue/i }),
        ).toBeInTheDocument();
      });
    });

    // 17. Secondary button visible in toolbar when affected items exist
    it('shows secondary send button in toolbar when affected items exist', () => {
      // Use entries with pending status (not all reviewed) but with affected items
      const entriesWithAffected = [
        makeEntry({
          id: 'e1',
          diff_type: 'modified',
          status: 'pending_review',
          old_content: 'old',
          new_content: 'new',
          affected_item: { id: 'item-1', title: 'Policy Doc' },
        }),
      ];

      renderComponent({
        entries: entriesWithAffected,
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      const toolbar = screen.getByRole('toolbar', { name: 'Bulk review actions' });
      expect(
        within(toolbar).getByRole('button', { name: /send affected items to review/i }),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Full-text diff mode rendering
  // -------------------------------------------------------------------------

  describe('full-text diff mode', () => {
    const FULL_TEXT_ADDED = makeEntry({
      id: 'ft-1',
      diff_type: 'added',
      diff_mode: 'full_text' as const,
      new_content: 'This is a newly added paragraph about compliance.',
    });

    const FULL_TEXT_REMOVED = makeEntry({
      id: 'ft-2',
      diff_type: 'removed',
      diff_mode: 'full_text' as const,
      old_content: 'This outdated paragraph has been removed.',
    });

    const FULL_TEXT_MODIFIED = makeEntry({
      id: 'ft-3',
      diff_type: 'modified',
      diff_mode: 'full_text' as const,
      old_content: 'The old version of this paragraph.',
      new_content: 'The new version of this paragraph with updates.',
    });

    const FULL_TEXT_UNCHANGED = makeEntry({
      id: 'ft-4',
      diff_type: 'unchanged',
      diff_mode: 'full_text' as const,
      old_content: 'This paragraph has not changed.',
      new_content: 'This paragraph has not changed.',
    });

    const FULL_TEXT_ENTRIES = [FULL_TEXT_ADDED, FULL_TEXT_REMOVED, FULL_TEXT_MODIFIED, FULL_TEXT_UNCHANGED];

    const FULL_TEXT_SUMMARY = {
      added: 1,
      removed: 1,
      modified: 1,
      unchanged: 1,
    };

    it('detects full-text mode from diff_mode field', () => {
      renderComponent({
        entries: FULL_TEXT_ENTRIES,
        summary: FULL_TEXT_SUMMARY,
      });

      // Full-text mode uses "Added:" label instead of "Answer:"
      expect(screen.getByText('Added:')).toBeInTheDocument();
    });

    it('infers full-text mode when no entries have questions', () => {
      // Entries without diff_mode field but also without questions
      const noQuestionEntries = [
        makeEntry({
          id: 'nq-1',
          diff_type: 'added',
          new_content: 'Some new text block.',
        }),
        makeEntry({
          id: 'nq-2',
          diff_type: 'removed',
          old_content: 'Some old text block.',
        }),
      ];

      renderComponent({
        entries: noQuestionEntries,
        summary: { added: 1, removed: 1, modified: 0, unchanged: 0 },
      });

      // Should use full-text labels
      expect(screen.getByText('Added:')).toBeInTheDocument();
      expect(screen.getByText('Removed:')).toBeInTheDocument();
    });

    it('does not show "Q:" heading for full-text entries', () => {
      renderComponent({
        entries: FULL_TEXT_ENTRIES,
        summary: FULL_TEXT_SUMMARY,
      });

      // No Q: prefix should appear
      expect(screen.queryByText(/^Q:/)).not.toBeInTheDocument();
    });

    it('shows "Added:" label for added full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_ADDED],
        summary: { added: 1, removed: 0, modified: 0, unchanged: 0 },
      });

      expect(screen.getByText('Added:')).toBeInTheDocument();
      expect(screen.getByText('This is a newly added paragraph about compliance.')).toBeInTheDocument();
    });

    it('shows "Removed:" label for removed full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_REMOVED],
        summary: { added: 0, removed: 1, modified: 0, unchanged: 0 },
      });

      expect(screen.getByText('Removed:')).toBeInTheDocument();
      expect(screen.getByText('This outdated paragraph has been removed.')).toBeInTheDocument();
    });

    it('shows "Old version:" and "New version:" labels for modified full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_MODIFIED],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      expect(screen.getByText('Old version:')).toBeInTheDocument();
      expect(screen.getByText('New version:')).toBeInTheDocument();
    });

    it('applies green-tinted background for added full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_ADDED],
        summary: { added: 1, removed: 0, modified: 0, unchanged: 0 },
      });

      // The FullTextDiffEntryCard for added entries has bg-quality-good-bg/30
      const card = screen.getByLabelText('added text block');
      expect(card.className).toContain('bg-quality-good-bg/30');
    });

    it('applies destructive-tinted background for removed full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_REMOVED],
        summary: { added: 0, removed: 1, modified: 0, unchanged: 0 },
      });

      const card = screen.getByLabelText('removed text block');
      expect(card.className).toContain('bg-destructive/5');
    });

    it('shows review controls (Apply/Dismiss) for full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_MODIFIED],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      expect(screen.getByRole('button', { name: 'Apply this change' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Dismiss this change' })).toBeInTheDocument();
    });

    it('shows diff type badges for full-text entries', () => {
      renderComponent({
        entries: [FULL_TEXT_ADDED, FULL_TEXT_MODIFIED],
        summary: { added: 1, removed: 0, modified: 1, unchanged: 0 },
      });

      expect(screen.getByLabelText('Diff type: Added')).toBeInTheDocument();
      expect(screen.getByLabelText('Diff type: Modified')).toBeInTheDocument();
    });

    it('renders Q&A mode when entries have questions', () => {
      // This should use the standard Q&A card, not full-text
      renderComponent({
        entries: [MODIFIED_ENTRY],
        summary: { added: 0, removed: 0, modified: 1, unchanged: 0 },
      });

      // Q&A mode should show "Q:" heading
      expect(screen.getByText('Q: What is your data protection policy?')).toBeInTheDocument();
      // And "Old answer:" / "New answer:" labels
      expect(screen.getByText('Old answer:')).toBeInTheDocument();
      expect(screen.getByText('New answer:')).toBeInTheDocument();
    });
  });
});

