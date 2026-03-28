import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReviewHistorySection } from '@/components/review/review-history-section';
import type { ReviewHistoryEntry } from '@/hooks/review/use-review-history';

// ─── Test data ──────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<ReviewHistoryEntry> = {}): ReviewHistoryEntry {
  return {
    id: 'log-1',
    flag_type: 'classification_low',
    severity: 'warning',
    details: null,
    resolution_notes: null,
    created_at: '2026-03-20T10:00:00Z',
    created_by: 'user-1',
    created_by_name: null,
    resolved: false,
    resolved_at: null,
    resolved_by: null,
    resolved_by_name: null,
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('ReviewHistorySection', () => {
  it('renders nothing when history is empty', () => {
    const { container } = render(<ReviewHistorySection history={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows loading skeleton when isLoading is true', () => {
    render(<ReviewHistorySection history={[]} isLoading />);
    expect(screen.getByRole('status', { name: 'Loading review history' })).toBeInTheDocument();
  });

  it('shows collapsed header with entry count', () => {
    const entries = [makeEntry(), makeEntry({ id: 'log-2' })];
    render(<ReviewHistorySection history={entries} />);

    expect(screen.getByText('Review history (2)')).toBeInTheDocument();
    // List should not be visible initially (collapsed)
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('expands on click to show entries', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({
        flag_type: 'review_needed',
        details: { notes: 'Needs attention' },
      }),
    ];
    render(<ReviewHistorySection history={entries} />);

    // Click to expand
    await user.click(screen.getByText('Review history (1)'));

    // List should now be visible
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getByText('Review Needed')).toBeInTheDocument();
  });

  it('shows flag notes in expanded view', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({
        details: { notes: 'Confidence below threshold' },
      }),
    ];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/Confidence below threshold/)).toBeInTheDocument();
  });

  it('shows details.reason when notes not present', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({
        details: { reason: 'Manual flag reason' },
      }),
    ];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/Manual flag reason/)).toBeInTheDocument();
  });

  it('shows "System" when created_by_name is null', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry({ created_by_name: null })];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/by System/)).toBeInTheDocument();
  });

  it('shows creator name when available', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry({ created_by_name: 'Liam' })];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/by Liam/)).toBeInTheDocument();
  });

  it('shows resolution details for resolved entries', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({
        resolved: true,
        resolved_at: '2026-03-21T10:00:00Z',
        resolved_by_name: 'Liam',
        resolution_notes: 'Reclassified correctly',
      }),
    ];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/Resolved/)).toBeInTheDocument();
    expect(screen.getByText(/by Liam/)).toBeInTheDocument();
    expect(screen.getByText(/Reclassified correctly/)).toBeInTheDocument();
    expect(screen.getByText(/21\/03\/2026/)).toBeInTheDocument();
  });

  it('formats flag date in UK format (DD/MM/YYYY)', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry({ created_at: '2026-03-20T10:00:00Z' })];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText(/20\/03\/2026/)).toBeInTheDocument();
  });

  it('formats unknown flag types to title case', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry({ flag_type: 'some_custom_flag' })];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (1)'));

    expect(screen.getByText('Some Custom Flag')).toBeInTheDocument();
  });

  it('has correct aria-expanded attribute on toggle button', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry()];
    render(<ReviewHistorySection history={entries} />);

    const button = screen.getByRole('button', { name: /Review history/ });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });

  it('has proper section landmark with label', () => {
    const entries = [makeEntry()];
    render(<ReviewHistorySection history={entries} />);

    expect(screen.getByRole('region', { name: 'Review history' })).toBeInTheDocument();
  });

  it('collapses on second click', async () => {
    const user = userEvent.setup();
    const entries = [makeEntry()];
    render(<ReviewHistorySection history={entries} />);

    const button = screen.getByText('Review history (1)');

    // Expand
    await user.click(button);
    expect(screen.getByRole('list')).toBeInTheDocument();

    // Collapse
    await user.click(button);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('renders multiple entries', async () => {
    const user = userEvent.setup();
    const entries = [
      makeEntry({ id: 'log-1', flag_type: 'review_needed' }),
      makeEntry({ id: 'log-2', flag_type: 'classification_low' }),
      makeEntry({ id: 'log-3', flag_type: 'short_content' }),
    ];
    render(<ReviewHistorySection history={entries} />);

    await user.click(screen.getByText('Review history (3)'));

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
  });
});
