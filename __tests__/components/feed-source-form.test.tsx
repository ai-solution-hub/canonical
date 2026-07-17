/**
 * FeedSourceForm Component Tests
 *
 * SI-M5 — verifies that the validated feed metadata returned by the create
 * endpoint (`feed_title` + `initial_article_count`) is surfaced inline to the
 * user as a confirmation card after a successful add. Without this, the
 * server-side validation in `lib/intelligence/feed-poller.validateFeedUrl()`
 * has no UI consumer and the API response fields are dead.
 *
 * Tests cover:
 *   - No confirmation card when `lastAdded` is null
 *   - Confirmation card with title + plural article count
 *   - Confirmation card with title + singular article count
 *   - Confirmation card with title only (count missing)
 *   - Confirmation card hidden in edit mode (initialData set)
 *   - CTA labels switch to "Close" / "Add Another" after confirmation
 *   - Submit handler still emits the typed FeedSourceInput
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks for UI primitives — keep tests deterministic and free of Radix
// portals / focus traps that don't render predictably in jsdom.
// ---------------------------------------------------------------------------

vi.mock('@/components/ui/button', () => ({
  Button: ({
    children,
    onClick,
    disabled,
    type,
    ...props
  }: Record<string, unknown>) => (
    <button
      type={(type as 'button' | 'submit' | 'reset') ?? 'button'}
      onClick={onClick as React.MouseEventHandler}
      disabled={disabled as boolean}
      {...props}
    >
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => (
    <input
      {...props}
      onChange={props.onChange as React.ChangeEventHandler<HTMLInputElement>}
    />
  ),
}));

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: Record<string, unknown>) => (
    <label {...props}>{children as React.ReactNode}</label>
  ),
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <select
      data-testid="source-type-select"
      value={value}
      onChange={(e) => onValueChange?.(e.target.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <option value={value}>{children}</option>,
}));

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    checked,
    onCheckedChange,
    id,
  }: {
    checked?: boolean;
    onCheckedChange?: (v: boolean) => void;
    id?: string;
  }) => (
    <input
      type="checkbox"
      id={id}
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
    />
  ),
}));

vi.mock('lucide-react', () => ({
  CheckCircle2: (props: Record<string, unknown>) => (
    <span
      data-testid="check-circle-icon"
      aria-hidden={
        props['aria-hidden'] as boolean | 'true' | 'false' | undefined
      }
    />
  ),
}));

import { FeedSourceForm } from '@/components/intelligence/feed-source-form';
import type { FeedSource } from '@/hooks/intelligence/use-feed-sources';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const mockOnSubmit = vi.fn();
const mockOnCancel = vi.fn();

function renderForm(
  overrides: Partial<React.ComponentProps<typeof FeedSourceForm>> = {},
) {
  return render(
    <FeedSourceForm
      onSubmit={mockOnSubmit}
      onCancel={mockOnCancel}
      isPending={false}
      {...overrides}
    />,
  );
}

const sampleEditSource: FeedSource = {
  id: '00000000-0000-4000-8000-000000000001',
  workspace_id: '00000000-0000-4000-8000-000000000002',
  name: 'Existing feed',
  url: 'https://example.com/feed.xml',
  source_type: 'rss',
  polling_interval_minutes: 30,
  is_active: true,
  last_polled_at: null,
  last_polled_status: null,
  consecutive_failures: 0,
  etag: null,
  last_modified: null,
  created_by: null,
  created_at: '2026-04-06T00:00:00Z',
  updated_at: '2026-04-06T00:00:00Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FeedSourceForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('default render (no confirmation)', () => {
    it('renders the create heading and CTAs', () => {
      renderForm();
      expect(screen.getByText('Add Feed Source')).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Cancel' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add Source' }),
      ).toBeInTheDocument();
    });

    it('does not render the confirmation card when lastAdded is null', () => {
      renderForm({ lastAdded: null });
      expect(
        screen.queryByTestId('feed-add-confirmation'),
      ).not.toBeInTheDocument();
    });

    it('does not render the confirmation card when lastAdded is undefined', () => {
      renderForm();
      expect(
        screen.queryByTestId('feed-add-confirmation'),
      ).not.toBeInTheDocument();
    });

    it('emits the typed FeedSourceInput when submit is clicked with required fields', () => {
      renderForm();
      fireEvent.change(screen.getByLabelText('Name *'), {
        target: { value: 'DfE News' },
      });
      fireEvent.change(screen.getByLabelText('Feed URL *'), {
        target: { value: 'https://example.gov.uk/feed.xml' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Add Source' }));
      expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      expect(mockOnSubmit).toHaveBeenCalledWith({
        name: 'DfE News',
        url: 'https://example.gov.uk/feed.xml',
        source_type: 'rss',
        polling_interval_minutes: 30,
        is_active: true,
      });
    });
  });

  describe('confirmation card (SI-M5)', () => {
    it('renders the validated feed_title and plural article count after a successful add', () => {
      renderForm({
        lastAdded: {
          feed_title: 'DfE News',
          initial_article_count: 25,
        },
      });

      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toBeInTheDocument();
      // The title should be wrapped in quotes so the user can see exactly which
      // feed the pipeline parsed.
      expect(card).toHaveTextContent('Added "DfE News"');
      // Plural article count copy.
      expect(card).toHaveTextContent('25 articles available from this feed');
    });

    it('renders singular "article" when only one item is in the feed', () => {
      renderForm({
        lastAdded: {
          feed_title: 'Single Article Feed',
          initial_article_count: 1,
        },
      });

      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveTextContent('Added "Single Article Feed"');
      expect(card).toHaveTextContent('1 article available from this feed');
      expect(card).not.toHaveTextContent('1 articles');
    });

    it('shows zero-article copy when feed is valid but currently empty', () => {
      renderForm({
        lastAdded: {
          feed_title: 'Empty Feed',
          initial_article_count: 0,
        },
      });

      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveTextContent('Added "Empty Feed"');
      expect(card).toHaveTextContent('0 articles available from this feed');
    });

    it('falls back to a generic confirmation when the feed has no title', () => {
      renderForm({
        lastAdded: {
          feed_title: undefined,
          initial_article_count: 10,
        },
      });

      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveTextContent('Feed source added');
      expect(card).toHaveTextContent('10 articles available from this feed');
    });

    it('renders title-only confirmation when article count is missing', () => {
      renderForm({
        lastAdded: {
          feed_title: 'Title Only Feed',
        },
      });

      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveTextContent('Added "Title Only Feed"');
      expect(card).not.toHaveTextContent('available from this feed');
    });

    it('does not render the confirmation card when lastAdded has neither title nor count', () => {
      renderForm({
        lastAdded: {
          feed_title: undefined,
          initial_article_count: undefined,
        },
      });
      expect(
        screen.queryByTestId('feed-add-confirmation'),
      ).not.toBeInTheDocument();
    });

    it('uses an aria-live region so screen readers announce the confirmation', () => {
      renderForm({
        lastAdded: {
          feed_title: 'A11y Feed',
          initial_article_count: 3,
        },
      });
      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveAttribute('role', 'status');
      expect(card).toHaveAttribute('aria-live', 'polite');
    });

    it('switches the cancel CTA to "Close" and the submit CTA to "Add Another" after confirmation', () => {
      renderForm({
        lastAdded: {
          feed_title: 'DfE News',
          initial_article_count: 25,
        },
      });

      // Cancel becomes "Close" — the form is no longer in a "pending choice" state.
      expect(
        screen.queryByRole('button', { name: 'Cancel' }),
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();

      // Submit becomes "Add Another" so the user knows clicking again creates
      // a NEW feed (not a duplicate of the one they just added).
      expect(
        screen.queryByRole('button', { name: 'Add Source' }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Add Another' }),
      ).toBeInTheDocument();
    });

    it('does not render the confirmation card in edit mode even when lastAdded is set', () => {
      renderForm({
        initialData: sampleEditSource,
        lastAdded: {
          feed_title: 'Should Not Show',
          initial_article_count: 5,
        },
      });
      expect(
        screen.queryByTestId('feed-add-confirmation'),
      ).not.toBeInTheDocument();
      // Edit mode keeps the standard "Cancel" / "Update Source" CTAs.
      expect(
        screen.getByRole('button', { name: 'Cancel' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Update Source' }),
      ).toBeInTheDocument();
    });

    it('trims whitespace-only titles and falls back to the generic message', () => {
      renderForm({
        lastAdded: {
          feed_title: '   ',
          initial_article_count: 4,
        },
      });
      const card = screen.getByTestId('feed-add-confirmation');
      expect(card).toHaveTextContent('Feed source added');
      expect(card).not.toHaveTextContent('Added ""');
    });
  });
});
