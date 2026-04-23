/**
 * QAAnswerDisplay Component Tests
 *
 * Tests verification border treatment (green/amber), inline VerificationBadge
 * rendering for both Standard and Advanced answer cards, copy button behaviour,
 * inline editing via inlineEdit (per-field edit/save/cancel with change reason),
 * and empty/fallback states.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QAAnswerDisplay } from '@/components/qa/qa-answer-display';
import type {
  QAAnswerDisplayProps,
  QAAnswerInlineEdit,
} from '@/components/qa/qa-answer-display';
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
    summary: null,
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

function makeInlineEdit(
  overrides: Partial<QAAnswerInlineEdit> = {},
): QAAnswerInlineEdit {
  return {
    editingField: null,
    editValue: '',
    isSaving: false,
    startEdit: vi.fn(),
    cancelEdit: vi.fn(),
    saveEdit: vi.fn().mockResolvedValue(undefined),
    setEditValue: vi.fn(),
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<QAAnswerDisplayProps> = {},
): QAAnswerDisplayProps {
  return {
    item: makeItem(),
    handleCopyAnswer: vi.fn(),
    canEdit: false,
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
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
    const cards = container.querySelectorAll('.rounded-xl');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[3px]');
      expect(card).toHaveClass('border-l-[var(--color-status-success)]');
    }
  });

  it('defaults to unverified styling when verified_at is null', () => {
    const item = makeItem({ verified_at: null });
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
    const cards = container.querySelectorAll('.rounded-xl');
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[var(--color-status-warning)]');
    }
  });

  it('defaults to unverified styling when verified_at is undefined', () => {
    const item = makeItem();
    delete (item as unknown as Record<string, unknown>).verified_at;
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
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
    render(<QAAnswerDisplay {...makeProps({ handleCopyAnswer })} />);
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyButtons[0]);
    expect(handleCopyAnswer).toHaveBeenCalledWith('standard');
  });

  it('calls handleCopyAnswer with "advanced" when advanced copy is clicked', () => {
    const handleCopyAnswer = vi.fn();
    render(<QAAnswerDisplay {...makeProps({ handleCopyAnswer })} />);
    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyButtons[1]);
    expect(handleCopyAnswer).toHaveBeenCalledWith('advanced');
  });

  it('hides copy buttons when a field is being edited', () => {
    const inlineEdit = makeInlineEdit({ editingField: 'answer_standard' });
    render(
      <QAAnswerDisplay
        {...makeProps({ inlineEdit, canEdit: true })}
      />,
    );
    const copyButtons = screen.queryAllByRole('button', { name: /copy/i });
    expect(copyButtons).toHaveLength(0);
  });

  it('still shows verification badges when editing', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Editing...',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ inlineEdit, canEdit: true })}
      />,
    );
    const badges = screen.getAllByText('Unverified');
    expect(badges).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Edit button rendering (canEdit + inlineEdit)
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — edit button', () => {
  it('does not show edit buttons when canEdit is false', () => {
    const inlineEdit = makeInlineEdit();
    render(
      <QAAnswerDisplay {...makeProps({ canEdit: false, inlineEdit })} />,
    );
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('shows edit buttons for both answers when canEdit is true and no field is being edited', () => {
    const inlineEdit = makeInlineEdit();
    render(
      <QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />,
    );
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    expect(editButtons).toHaveLength(2);
  });

  it('hides edit buttons when a field is being edited', () => {
    const inlineEdit = makeInlineEdit({ editingField: 'answer_standard' });
    render(
      <QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />,
    );
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument();
  });

  it('calls startEdit with answer_standard when standard edit button is clicked', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit();
    const item = makeItem();
    render(
      <QAAnswerDisplay
        {...makeProps({ item, canEdit: true, inlineEdit })}
      />,
    );
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    await user.click(editButtons[0]);
    expect(inlineEdit.startEdit).toHaveBeenCalledWith(
      'answer_standard',
      'This is the standard answer.',
    );
  });

  it('calls startEdit with answer_advanced when advanced edit button is clicked', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit();
    const item = makeItem();
    render(
      <QAAnswerDisplay
        {...makeProps({ item, canEdit: true, inlineEdit })}
      />,
    );
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    await user.click(editButtons[1]);
    expect(inlineEdit.startEdit).toHaveBeenCalledWith(
      'answer_advanced',
      'This is the advanced answer with more detail.',
    );
  });
});

// ---------------------------------------------------------------------------
// Inline editing — full data flow
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — inline editing data flow', () => {
  it('renders textarea when editing answer_standard', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Edited standard answer',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    const textarea = screen.getByLabelText('Edit Standard answer');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Edited standard answer');
  });

  it('renders textarea when editing answer_advanced', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_advanced',
      editValue: 'Edited advanced answer',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    const textarea = screen.getByLabelText('Edit Advanced answer');
    expect(textarea).toBeInTheDocument();
    expect(textarea).toHaveValue('Edited advanced answer');
  });

  it('calls setEditValue when textarea content changes', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: '',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    const textarea = screen.getByLabelText('Edit Standard answer');
    await user.type(textarea, 'A');
    expect(inlineEdit.setEditValue).toHaveBeenCalled();
  });

  it('shows "Why change?" input in inline editor', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    expect(screen.getByLabelText(/why change/i)).toBeInTheDocument();
  });

  it('shows per-field save hint in inline editor', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    expect(
      screen.getByText(/changes are saved per field/i),
    ).toBeInTheDocument();
  });

  it('calls saveEdit with field, value, and change reason on Save click', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Updated standard answer',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );

    // Fill change reason
    const reasonInput = screen.getByLabelText(/why change/i);
    await user.type(reasonInput, 'Updated to 2026 policy');

    // Click Save
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
      'answer_standard',
      'Updated standard answer',
      'Updated to 2026 policy',
    );
  });

  it('passes null change reason when reason is empty', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Updated answer',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );

    // Click Save without entering a reason
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
      'answer_standard',
      'Updated answer',
      null,
    );
  });

  it('calls cancelEdit when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(inlineEdit.cancelEdit).toHaveBeenCalledOnce();
  });

  it('shows Saving state when isSaving is true', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
      isSaving: true,
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    const saveButton = screen.getByRole('button', { name: /saving/i });
    expect(saveButton).toBeDisabled();
  });

  it('does not render standard answer text while editing answer_standard', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Editing...',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    // The original answer text should not be visible — textarea replaces it
    expect(
      screen.queryByText('This is the standard answer.'),
    ).not.toBeInTheDocument();
  });

  it('still shows advanced answer as read-only while editing standard answer', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Editing standard...',
    });
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
      />,
    );
    expect(
      screen.getByText('This is the advanced answer with more detail.'),
    ).toBeInTheDocument();
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
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
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
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
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
});

// ---------------------------------------------------------------------------
// Markdown rendering (Phase 3 ContentRenderer swap — AC5)
// ---------------------------------------------------------------------------

describe('QAAnswerDisplay — markdown rendering via ContentRenderer', () => {
  it('renders bold markdown in standard answer', () => {
    const item = makeItem({
      answer_standard: 'We have **comprehensive** quality policies.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('comprehensive');
  });

  it('renders bold markdown in advanced answer', () => {
    const item = makeItem({
      answer_advanced: 'Our **advanced** approach exceeds requirements.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('advanced');
  });

  it('renders unordered list markdown in answers', () => {
    const item = makeItem({
      answer_standard: 'Key policies:\n\n- Quality management\n- Environmental management\n- Health and safety',
      answer_advanced: null,
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const listItems = document.querySelectorAll('li');
    expect(listItems.length).toBe(3);
    expect(listItems[0]).toHaveTextContent('Quality management');
  });

  it('renders table markdown in answers via remark-gfm', () => {
    const item = makeItem({
      answer_standard: '| Certification | Year |\n|---|---|\n| ISO 9001 | 2024 |\n| ISO 14001 | 2023 |',
      answer_advanced: null,
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const table = document.querySelector('table');
    expect(table).toBeInTheDocument();
    const cells = document.querySelectorAll('td');
    expect(cells.length).toBeGreaterThanOrEqual(4);
  });

  it('renders plain text identically to pre-Phase-3 display', () => {
    // Plain text with no markdown syntax — should render as simple paragraphs
    const item = makeItem({
      answer_standard: 'This is a plain text answer.',
      answer_advanced: 'This is a plain advanced answer.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    expect(screen.getByText('This is a plain text answer.')).toBeInTheDocument();
    expect(screen.getByText('This is a plain advanced answer.')).toBeInTheDocument();
  });

  it('preserves UK English text through ContentRenderer', () => {
    const item = makeItem({
      answer_standard: 'Our organisation follows colour-coded procedures for behaviour management.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    expect(
      screen.getByText('Our organisation follows colour-coded procedures for behaviour management.'),
    ).toBeInTheDocument();
  });
});
