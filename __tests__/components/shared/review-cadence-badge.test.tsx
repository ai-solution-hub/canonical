/**
 * ReviewCadenceBadge Component Tests
 *
 * §5.5 Phase 3 T1 — covers the spec §7.2 rendering matrix:
 *   - 'review_overdue' → red "Review overdue" badge (precedence rule)
 *   - next_review_date within 14 days → amber "Review due {DD/MM/YYYY}"
 *   - next_review_date within 30 days (>14) → muted "Review due {DD/MM/YYYY}"
 *   - next_review_date > 30 days OR null → no badge rendered
 *
 * Boundary cases at 0/7/14/15/30/31 days are explicit since spec §7.2 marks
 * the 14-day and 30-day boundaries as INCLUSIVE.
 *
 * Per CLAUDE.md "Date-sensitive tests need pinned time" — uses fake timers
 * pinned to a fixed `now` to avoid midnight-boundary flakiness.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import {
  ReviewCadenceBadge,
  calculateReviewBand,
} from '@/components/shared/review-cadence-badge';

// Pin "today" to a fixed UTC midday so day-delta arithmetic is deterministic
// regardless of host timezone. All `next_review_date` fixtures below are
// interpreted as DATE-only ISO strings (Postgres DATE columns).
const FIXED_NOW = new Date('2026-04-28T12:00:00Z');

function isoDateOffset(days: number): string {
  const d = new Date(FIXED_NOW);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

describe('calculateReviewBand', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns 'overdue' when governance_review_status === 'review_overdue'", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(60),
        governanceStatus: 'review_overdue',
      }),
    ).toBe('overdue');
  });

  it("returns 'overdue' when status is 'review_overdue' even with future date (precedence)", () => {
    // Date in 5 days but status overrides → red badge
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(5),
        governanceStatus: 'review_overdue',
      }),
    ).toBe('overdue');
  });

  it("returns 'due-soon' for date === today (0 days, status=null)", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(0),
        governanceStatus: null,
      }),
    ).toBe('due-soon');
  });

  it("returns 'due-soon' for 7 days (mid amber band)", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(7),
        governanceStatus: null,
      }),
    ).toBe('due-soon');
  });

  it("returns 'due-soon' for 14 days (boundary inclusive)", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(14),
        governanceStatus: null,
      }),
    ).toBe('due-soon');
  });

  it("returns 'due-later' for 15 days (band 2)", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(15),
        governanceStatus: null,
      }),
    ).toBe('due-later');
  });

  it("returns 'due-later' for 30 days (boundary inclusive)", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(30),
        governanceStatus: null,
      }),
    ).toBe('due-later');
  });

  it("returns 'none' for 31 days", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: isoDateOffset(31),
        governanceStatus: null,
      }),
    ).toBe('none');
  });

  it("returns 'none' when next_review_date is null", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: null,
        governanceStatus: null,
      }),
    ).toBe('none');
  });

  it("returns 'none' when next_review_date is undefined", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: undefined,
        governanceStatus: undefined,
      }),
    ).toBe('none');
  });

  it("returns 'none' for unparseable date string", () => {
    expect(
      calculateReviewBand({
        nextReviewDate: 'not-a-date',
        governanceStatus: null,
      }),
    ).toBe('none');
  });
});

describe('ReviewCadenceBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------
  // T1-AC1: review_overdue → "Review overdue" red
  // -----------------------------------------------------------------
  it('renders "Review overdue" when governance_review_status === "review_overdue"', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(60)}
        governanceStatus="review_overdue"
      />,
    );
    const badge = screen.getByRole('img', { name: 'Review overdue' });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Review overdue');
  });

  // -----------------------------------------------------------------
  // T1-AC9: precedence — overdue status overrides date-based bands
  // -----------------------------------------------------------------
  it('renders "Review overdue" (NOT "Review due") when overdue status + 5-day date', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(5)}
        governanceStatus="review_overdue"
      />,
    );
    expect(
      screen.getByRole('img', { name: 'Review overdue' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Review due/)).not.toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // T1-AC2: amber band — 0/7/14 days
  // -----------------------------------------------------------------
  it('renders amber "Review due {DD/MM/YYYY}" for 7 days out (mid amber band)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(7)}
        governanceStatus={null}
      />,
    );
    // 2026-04-28 + 7 days = 2026-05-05 → 05/05/2026
    const badge = screen.getByRole('img', { name: /Review due 05\/05\/2026/ });
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveTextContent('Review due 05/05/2026');
  });

  it('renders amber for === 14 days (boundary inclusive)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(14)}
        governanceStatus={null}
      />,
    );
    // 2026-04-28 + 14 days = 2026-05-12 → 12/05/2026
    const badge = screen.getByRole('img', { name: /Review due 12\/05\/2026/ });
    expect(badge).toHaveTextContent('Review due 12/05/2026');
  });

  // -----------------------------------------------------------------
  // T1-AC3: muted band — 15/30 days
  // -----------------------------------------------------------------
  it('renders muted "Review due {DD/MM/YYYY}" for 15 days (band 2)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(15)}
        governanceStatus={null}
      />,
    );
    // 2026-04-28 + 15 days = 2026-05-13 → 13/05/2026
    // Band discrimination (due-later vs due-soon) is asserted observably by the
    // calculateReviewBand suite; here we assert the rendered accessible badge.
    const badge = screen.getByRole('img', { name: /Review due 13\/05\/2026/ });
    expect(badge).toHaveTextContent('Review due 13/05/2026');
  });

  it('renders muted for === 30 days (boundary inclusive)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(30)}
        governanceStatus={null}
      />,
    );
    // 2026-04-28 + 30 days = 2026-05-28 → 28/05/2026
    const badge = screen.getByRole('img', { name: /Review due 28\/05\/2026/ });
    expect(badge).toHaveTextContent('Review due 28/05/2026');
  });

  // -----------------------------------------------------------------
  // T1-AC4: no badge — > 30 days OR null
  // -----------------------------------------------------------------
  it('renders no badge for 31 days', () => {
    const { container } = render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(31)}
        governanceStatus={null}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText(/Review/)).not.toBeInTheDocument();
  });

  it('renders no badge when next_review_date is null', () => {
    const { container } = render(
      <ReviewCadenceBadge nextReviewDate={null} governanceStatus={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders no badge when next_review_date is undefined', () => {
    const { container } = render(
      <ReviewCadenceBadge
        nextReviewDate={undefined}
        governanceStatus={undefined}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  // -----------------------------------------------------------------
  // T1-AC7: WCAG 2.1 AA — text label always present (never colour alone)
  // -----------------------------------------------------------------
  it('renders text content for the red overdue state (WCAG: not colour alone)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={null}
        governanceStatus="review_overdue"
      />,
    );
    expect(screen.getByText('Review overdue')).toBeInTheDocument();
  });

  it('renders text content for the amber due-soon state (WCAG: not colour alone)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={isoDateOffset(7)}
        governanceStatus={null}
      />,
    );
    // Text node is non-empty even without inspecting colour
    expect(screen.getByText(/Review due/)).toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // T1-AC: UK date format — DD/MM/YYYY
  // -----------------------------------------------------------------
  it('renders no badge for dates > 30 days out (T1-AC4 boundary)', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate="2026-12-03"
        governanceStatus={null}
        now={FIXED_NOW}
      />,
    );
    // 2026-12-03 is ~219 days from FIXED_NOW (2026-04-28) → no badge per T1-AC4.
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('formats the date as DD/MM/YYYY for an in-range date', () => {
    // 2026-05-02 = 4 days from FIXED_NOW (2026-04-28) → due-soon
    render(
      <ReviewCadenceBadge
        nextReviewDate="2026-05-02"
        governanceStatus={null}
      />,
    );
    expect(screen.getByText('Review due 02/05/2026')).toBeInTheDocument();
  });

  // -----------------------------------------------------------------
  // aria-label snapshot — assistive technology surface
  // -----------------------------------------------------------------
  it('provides aria-label matching visible text for overdue state', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate={null}
        governanceStatus="review_overdue"
      />,
    );
    const badge = screen.getByRole('img');
    expect(badge).toHaveAttribute('aria-label', 'Review overdue');
  });

  it('provides aria-label matching visible text for due-soon state', () => {
    render(
      <ReviewCadenceBadge
        nextReviewDate="2026-05-02"
        governanceStatus={null}
      />,
    );
    const badge = screen.getByRole('img');
    expect(badge).toHaveAttribute('aria-label', 'Review due 02/05/2026');
  });
});
