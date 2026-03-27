/**
 * QAAnswerDisplay Component Tests
 *
 * Tests verification border treatment (green/amber), inline VerificationBadge
 * rendering for both Standard and Advanced answer cards, copy button behaviour,
 * and empty/fallback states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QAAnswerDisplay } from '@/components/qa-answer-display';
import type { QAAnswerDisplayProps } from '@/components/qa-answer-display';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Mock data factory
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Q&A Pair',
    suggested_title: null,
    content: null,
    ai_summary: null,
    ai_keywords: null,
    primary_domain: 'Corporate',
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'qa_pair',
    platform: null,
    author_name: null,
    source_url: null,
    file_path: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: '2026-01-15T10:00:00Z',
    classification_confidence: null,
    classification_reasoning: null,
    classified_at: null,
    summary_data: null,
    priority: null,
    user_tags: null,
    freshness: 'fresh',
    governance_review_status: null,
    metadata: null,
    verified_at: null,
    verified_by: null,
    answer_standard: 'This is the standard answer.',
    answer_advanced: 'This is the advanced answer with more detail.',
    ...overrides,
  };
}

function makeProps(overrides: Partial<QAAnswerDisplayProps> = {}): QAAnswerDisplayProps {
  return {
    item: makeItem(),
    isEditing: false,
    editStandard: '',
    editAdvanced: '',
    setEditStandard: vi.fn(),
    setEditAdvanced: vi.fn(),
    setEditDirty: vi.fn(),
    handleCopyAnswer: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Verification border treatment
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — verification border', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows amber (warning) left border when item is unverified', () => {
    const { container } = render(<QAAnswerDisplay {...makeProps()} />);
    const cards = container.querySelectorAll('.rounded-xl');
    // Standard + Advanced answer cards
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[3px]');
      expect(card).toHaveClass('border-l-[var(--color-status-warning)]');
    }
  });

  it('shows green (success) left border when item is verified', () => {
    const item = makeItem({ verified_at: '2026-03-20T10:00:00Z' });
    const { container } = render(
      <QAAnswerDisplay {...makeProps({ item })} />,
    );
    const cards = container.querySelectorAll('.rounded-xl');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[3px]');
      expect(card).toHaveClass('border-l-[var(--color-status-success)]');
    }
  });

  it('defaults to unverified styling when verified_at is null', () => {
    const item = makeItem({ verified_at: null });
    const { container } = render(
      <QAAnswerDisplay {...makeProps({ item })} />,
    );
    const cards = container.querySelectorAll('.rounded-xl');
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[var(--color-status-warning)]');
    }
  });

  it('defaults to unverified styling when verified_at is undefined', () => {
    const item = makeItem();
    delete (item as unknown as Record<string, unknown>).verified_at;
    const { container } = render(
      <QAAnswerDisplay {...makeProps({ item })} />,
    );
    const cards = container.querySelectorAll('.rounded-xl');
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[var(--color-status-warning)]');
    }
  });
});

// ---------------------------------------------------------------------------
// Inline VerificationBadge rendering
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — inline VerificationBadge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders "Unverified" badge text in both answer card headers when unverified', () => {
    render(<QAAnswerDisplay {...makeProps()} />);
    const badges = screen.getAllByText('Unverified');
    // One badge per answer card (Standard + Advanced)
    expect(badges).toHaveLength(2);
  });

  it('renders "Verified" badge text in both answer card headers when verified', () => {
    const item = makeItem({ verified_at: '2026-03-20T10:00:00Z' });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    const badges = screen.getAllByText(/^Verified/);
    // One badge per answer card (Standard + Advanced)
    expect(badges).toHaveLength(2);
  });

  it('renders VerificationBadge with relative time when verifiedAt is present', () => {
    const item = makeItem({ verified_at: '2026-03-22T12:00:00Z' });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    const badges = screen.getAllByText('Verified 3 days ago');
    expect(badges).toHaveLength(2);
  });

  it('renders badge with role="img" (not role="status") for non-live-region badges', () => {
    const item = makeItem({ verified_at: '2026-03-20T10:00:00Z' });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    const imgBadges = screen.getAllByRole('img');
    // Both answer cards should have role="img" badges
    expect(imgBadges.length).toBeGreaterThanOrEqual(2);
  });

  it('renders only one badge per card when only standard answer exists', () => {
    const item = makeItem({ answer_advanced: null });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    const badges = screen.getAllByText('Unverified');
    expect(badges).toHaveLength(1);
  });

  it('renders only one badge per card when only advanced answer exists', () => {
    const item = makeItem({ answer_standard: null });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    const badges = screen.getAllByText('Unverified');
    expect(badges).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Copy button behaviour
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — copy button', () => {
  it('shows copy buttons when not editing', () => {
    render(<QAAnswerDisplay {...makeProps()} />);
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    expect(copyButtons).toHaveLength(2);
  });

  it('calls handleCopyAnswer with "standard" when standard copy is clicked', () => {
    const handleCopyAnswer = vi.fn();
    render(
      <QAAnswerDisplay {...makeProps({ handleCopyAnswer })} />,
    );
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyButtons[0]);
    expect(handleCopyAnswer).toHaveBeenCalledWith('standard');
  });

  it('calls handleCopyAnswer with "advanced" when advanced copy is clicked', () => {
    const handleCopyAnswer = vi.fn();
    render(
      <QAAnswerDisplay {...makeProps({ handleCopyAnswer })} />,
    );
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyButtons[1]);
    expect(handleCopyAnswer).toHaveBeenCalledWith('advanced');
  });

  it('hides copy buttons when editing', () => {
    render(
      <QAAnswerDisplay {...makeProps({ isEditing: true })} />,
    );
    const copyButtons = screen.queryAllByRole('button', { name: /copy/i });
    expect(copyButtons).toHaveLength(0);
  });

  it('still shows verification badges when editing', () => {
    render(
      <QAAnswerDisplay {...makeProps({ isEditing: true })} />,
    );
    const badges = screen.getAllByText('Unverified');
    expect(badges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Empty and fallback states
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — empty and fallback states', () => {
  it('shows fallback content card when no answers but content exists', () => {
    const item = makeItem({
      answer_standard: null,
      answer_advanced: null,
      content: 'Some fallback content here.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    expect(screen.getByText('Some fallback content here.')).toBeInTheDocument();
    // No verification badges on fallback content
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('shows empty state when no answers and no content', () => {
    const item = makeItem({
      answer_standard: null,
      answer_advanced: null,
      content: null,
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);
    expect(screen.getByText('No answer recorded yet.')).toBeInTheDocument();
    // No verification badges on empty state
    expect(screen.queryByText('Unverified')).not.toBeInTheDocument();
    expect(screen.queryByText('Verified')).not.toBeInTheDocument();
  });

  it('does not render verification border on fallback content card', () => {
    const item = makeItem({
      answer_standard: null,
      answer_advanced: null,
      content: 'Fallback content.',
    });
    const { container } = render(
      <QAAnswerDisplay {...makeProps({ item })} />,
    );
    const cards = container.querySelectorAll('.rounded-xl');
    expect(cards).toHaveLength(1);
    expect(cards[0]).not.toHaveClass('border-l-[var(--color-status-warning)]');
    expect(cards[0]).not.toHaveClass('border-l-[var(--color-status-success)]');
  });

  it('does not render verification border on empty state card', () => {
    const item = makeItem({
      answer_standard: null,
      answer_advanced: null,
      content: null,
    });
    const { container } = render(
      <QAAnswerDisplay {...makeProps({ item })} />,
    );
    const cards = container.querySelectorAll('.rounded-xl');
    expect(cards).toHaveLength(1);
    expect(cards[0]).not.toHaveClass('border-l-[var(--color-status-warning)]');
    expect(cards[0]).not.toHaveClass('border-l-[var(--color-status-success)]');
  });
});

// ---------------------------------------------------------------------------
// Answer card labels
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — answer card labels', () => {
  it('renders "Standard Answer" and "Advanced Answer" labels', () => {
    render(<QAAnswerDisplay {...makeProps()} />);
    expect(screen.getByText('Standard Answer')).toBeInTheDocument();
    expect(screen.getByText('Advanced Answer')).toBeInTheDocument();
  });

  it('renders answer text content correctly', () => {
    render(<QAAnswerDisplay {...makeProps()} />);
    expect(
      screen.getByText('This is the standard answer.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This is the advanced answer with more detail.'),
    ).toBeInTheDocument();
  });

  it('renders textareas in edit mode with correct placeholders', () => {
    render(
      <QAAnswerDisplay
        {...makeProps({
          isEditing: true,
          editStandard: 'Editing standard...',
          editAdvanced: 'Editing advanced...',
        })}
      />,
    );
    expect(screen.getByPlaceholderText('Standard answer...')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Advanced answer...')).toBeInTheDocument();
  });
});
