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

// S198 §1.5 WP4 — M1/M2/M3: AC8 (save-safety guard) surfaces a toast and
// blocks the saveEdit call; we need to assert on `toast.error` from sonner.
// Hoist via `vi.hoisted` so the mock is set up before the QAAnswerDisplay
// import is resolved (Vitest hoisting rules).
const { mockToast } = vi.hoisted(() => ({
  mockToast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
  },
}));
vi.mock('sonner', () => ({ toast: mockToast }));

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
      expect(card).toHaveClass('border-l-[var(--status-warning)]');
    }
  });

  it('shows green (success) left border when item is verified', () => {
    const item = makeItem({ verified_at: '2026-03-20T10:00:00Z' });
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
    const cards = container.querySelectorAll('.rounded-xl');
    expect(cards.length).toBeGreaterThanOrEqual(2);
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[3px]');
      expect(card).toHaveClass('border-l-[var(--status-success)]');
    }
  });

  it('defaults to unverified styling when verified_at is null', () => {
    const item = makeItem({ verified_at: null });
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
    const cards = container.querySelectorAll('.rounded-xl');
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[var(--status-warning)]');
    }
  });

  it('defaults to unverified styling when verified_at is undefined', () => {
    const item = makeItem();
    delete (item as unknown as Record<string, unknown>).verified_at;
    const { container } = render(<QAAnswerDisplay {...makeProps({ item })} />);
    const cards = container.querySelectorAll('.rounded-xl');
    for (const card of cards) {
      expect(card).toHaveClass('border-l-[var(--status-warning)]');
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
    render(<QAAnswerDisplay {...makeProps({ inlineEdit, canEdit: true })} />);
    const copyButtons = screen.queryAllByRole('button', { name: /copy/i });
    expect(copyButtons).toHaveLength(0);
  });

  it('still shows verification badges when editing', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Editing...',
    });
    render(<QAAnswerDisplay {...makeProps({ inlineEdit, canEdit: true })} />);
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
    render(<QAAnswerDisplay {...makeProps({ canEdit: false, inlineEdit })} />);
    expect(
      screen.queryByRole('button', { name: /^edit$/i }),
    ).not.toBeInTheDocument();
  });

  it('shows edit buttons for both answers when canEdit is true and no field is being edited', () => {
    const inlineEdit = makeInlineEdit();
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    const editButtons = screen.getAllByRole('button', { name: /^edit$/i });
    expect(editButtons).toHaveLength(2);
  });

  it('hides edit buttons when a field is being edited', () => {
    const inlineEdit = makeInlineEdit({ editingField: 'answer_standard' });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    expect(
      screen.queryByRole('button', { name: /^edit$/i }),
    ).not.toBeInTheDocument();
  });

  it('calls startEdit with answer_standard when standard edit button is clicked', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit();
    const item = makeItem();
    render(
      <QAAnswerDisplay {...makeProps({ item, canEdit: true, inlineEdit })} />,
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
      <QAAnswerDisplay {...makeProps({ item, canEdit: true, inlineEdit })} />,
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
  // S198 §1.5 WP4: ContentEditor (Tiptap/ProseMirror) calls scrollIntoView /
  // getClientRects on autofocus / cursor placement. jsdom only ships partial
  // stubs — without these jsdom shims, async dispatches throw uncaught after
  // the assertions resolve and Vitest exits non-zero. Mirrors the pattern in
  // `__tests__/helpers/radix-pointer-shims.ts`.
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    if (!Element.prototype.getClientRects) {
      Element.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    // ProseMirror's `singleRect` calls `target.getClientRects()` where target
    // can be a Range — jsdom Range does not implement this. Stub returns an
    // empty list to short-circuit selection-rect calculations on autofocus.
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = vi.fn(
        () =>
          ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );
    }
  });

  // S198 §1.5 WP4: textarea swapped for ContentEditor (Tiptap). The editor
  // body now has role="textbox" and aria-labelledby pointing at the section
  // label ("Standard Answer" / "Advanced Answer"). Tiptap is dynamically
  // imported (`ssr: false`) so we use findByRole to await the chunk load.
  // The two read-mode tests below are structural (mount-shape) checks; the
  // editor-driven onChange path is covered by the un-skipped Wave 3 (WP6)
  // test further below using the @internal `onEditorReady` hook.
  it('renders editor textbox when editing answer_standard', async () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Edited standard answer',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    const editorBody = await screen.findByRole('textbox', {
      name: /standard answer/i,
    });
    expect(editorBody).toBeInTheDocument();
    // Tiptap renders editValue inside the contenteditable; the literal text
    // appears in the rendered DOM.
    expect(screen.getByText('Edited standard answer')).toBeInTheDocument();
  });

  it('renders editor textbox when editing answer_advanced', async () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_advanced',
      editValue: 'Edited advanced answer',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    const editorBody = await screen.findByRole('textbox', {
      name: /advanced answer/i,
    });
    expect(editorBody).toBeInTheDocument();
    expect(screen.getByText('Edited advanced answer')).toBeInTheDocument();
  });

  // S198 §1.5 WP6 (un-skipped from WP4): drives the Tiptap editor instance
  // directly via the `@internal onEditorReady` test hook on `ContentEditor`,
  // forwarded through `QAAnswerDisplay` → `QAInlineEditor` → `ContentEditor`.
  // Per memory `feedback_agent_browser_tiptap_typing`, simulated keystrokes
  // (`user.type()`) are unreliable in jsdom — calling
  // `editor.commands.insertContent()` directly is the canonical pattern.
  // The editor's `onUpdate` then fires with `e.getMarkdown()`, which
  // `ContentEditor` forwards as `onChange(markdown)` — wired here to the
  // parent's `inlineEdit.setEditValue`.
  it('calls setEditValue when editor content changes (Wave 3 / WP6)', async () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: '',
    });
    let capturedEditor: import('@tiptap/react').Editor | null = null;
    render(
      <QAAnswerDisplay
        {...makeProps({ canEdit: true, inlineEdit })}
        onEditorReady={(editor) => {
          capturedEditor = editor;
        }}
      />,
    );

    // Wait for the dynamically-imported editor to mount and the test hook
    // to capture the instance.
    await screen.findByRole('textbox', { name: /standard answer/i });
    await waitFor(() => {
      expect(capturedEditor).not.toBeNull();
    });

    // Drive the editor directly. `insertContent` triggers `onUpdate`, which
    // fires `onChange(getMarkdown())` upstream to `setEditValue`.
    capturedEditor!.commands.insertContent('typed text');

    await waitFor(() => {
      expect(inlineEdit.setEditValue).toHaveBeenCalled();
    });
    // Verify the markdown content was forwarded (not just a no-op call).
    const lastCall = (
      inlineEdit.setEditValue as ReturnType<typeof vi.fn>
    ).mock.calls.at(-1);
    expect(lastCall?.[0]).toContain('typed text');
  });

  it('shows "Why change?" input in inline editor', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    expect(screen.getByLabelText(/why change/i)).toBeInTheDocument();
  });

  it('shows per-field save hint in inline editor', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
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
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    // S198 §1.5 WP4: ContentEditor is dynamically imported; await it before
    // touching the change-reason input so the React subtree has settled.
    await screen.findByRole('textbox', { name: /standard answer/i });

    // Fill change reason via fireEvent.change — bypasses the multi-render
    // keystroke loop that loses characters when the dynamic-imported editor
    // re-renders mid-typing in jsdom.
    const reasonInput = screen.getByLabelText(/why change/i);
    fireEvent.change(reasonInput, {
      target: { value: 'Updated to 2026 policy' },
    });

    // Click Save
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      // S198 §1.5 WP4: saveEdit signature gained an optional 4th `extras` arg.
      // No regen-embedding setter in this fixture → 4th arg is undefined.
      expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
        'answer_standard',
        'Updated standard answer',
        'Updated to 2026 policy',
        undefined,
      );
    });
  });

  it('passes null change reason when reason is empty', async () => {
    const user = userEvent.setup();
    // S198 §1.5 WP4: editValue must be ≥ 80% of the baseline (the persisted
    // `item.answer_standard`, length 28) to clear the save-safety guard inside
    // `ContentEditor.handleSave` / the parent's pre-check. Original textarea
    // version had no guard, so any length worked.
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'This is the updated answer.',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    // Click Save without entering a reason
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // S198 §1.5 WP4: 4th `extras` arg is undefined when no regen toggle wired.
    expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
      'answer_standard',
      'This is the updated answer.',
      null,
      undefined,
    );
  });

  it('calls cancelEdit when Cancel button is clicked', async () => {
    const user = userEvent.setup();
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(inlineEdit.cancelEdit).toHaveBeenCalledOnce();
  });

  it('shows Saving state when isSaving is true', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Some text',
      isSaving: true,
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    const saveButton = screen.getByRole('button', { name: /saving/i });
    expect(saveButton).toBeDisabled();
  });

  it('does not render standard answer text while editing answer_standard', () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'Editing...',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
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
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);
    expect(
      screen.getByText('This is the advanced answer with more detail.'),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// AC8 — Save-safety guard (M1)
// ---------------------------------------------------------------------------
//
// Spec AC8: when the in-flight `editValue` length drops below 80% of the
// last-persisted baseline (`item.answer_standard?.length` or equivalent for
// advanced), the Save-button path MUST surface the canonical block toast and
// MUST NOT call `inlineEdit.saveEdit`. The Save-button guard lives in
// `QAInlineEditor.handleSaveClick` (qa-answer-display.tsx:142). The same
// guard runs inside `ContentEditor.handleSave` for the Cmd/Ctrl+S path.
//
// Reproduction conditions per field:
//   baseline = 50 → threshold = 50 × 0.8 = 40
//   editValue length 3 < 40 → guard fires
//
// Both fields are tested independently because each card owns its own
// `QAInlineEditor` instance with its own `baselineLength` prop derived
// from the corresponding persisted field value.
describe('QAAnswerDisplay — AC8 save-safety guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    if (!Element.prototype.getClientRects) {
      Element.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = vi.fn(
        () =>
          ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );
    }
  });

  it('blocks save and surfaces canonical toast when answer_standard shrinks ≥ 20%', async () => {
    const user = userEvent.setup();
    const item = makeItem({
      // Baseline = 50 chars → threshold = 40. editValue length 3 < 40.
      answer_standard: 'a'.repeat(50),
    });
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'aaa',
    });
    render(
      <QAAnswerDisplay {...makeProps({ item, canEdit: true, inlineEdit })} />,
    );

    await screen.findByRole('textbox', { name: /standard answer/i });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    // Canonical block message from `lib/editor/save-safety.ts`.
    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining('Save blocked'),
    );
    // No PATCH mutation fired.
    expect(inlineEdit.saveEdit).not.toHaveBeenCalled();
  });

  it('blocks save and surfaces canonical toast when answer_advanced shrinks ≥ 20%', async () => {
    const user = userEvent.setup();
    const item = makeItem({
      answer_advanced: 'b'.repeat(50),
    });
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_advanced',
      editValue: 'bbb',
    });
    render(
      <QAAnswerDisplay {...makeProps({ item, canEdit: true, inlineEdit })} />,
    );

    await screen.findByRole('textbox', { name: /advanced answer/i });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    expect(mockToast.error).toHaveBeenCalledWith(
      expect.stringContaining('Save blocked'),
    );
    expect(inlineEdit.saveEdit).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// AC9b — Re-generate embedding flag in PATCH body (M2)
// ---------------------------------------------------------------------------
//
// Spec AC9b: when the per-edit "Re-generate embedding" checkbox is ticked,
// the Save click forwards `extras: { regenerate_embedding: true }` as the
// 4th positional argument to `inlineEdit.saveEdit`. The hook then writes
// `regenerate_embedding: true` into the PATCH body. The hook-level wiring
// is exercised separately in `use-inline-field-edit.test.ts`; here we only
// verify the prop-to-callback contract on the component side.
describe('QAAnswerDisplay — AC9b regen-embedding flag forwarded', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    if (!Element.prototype.getClientRects) {
      Element.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = vi.fn(
        () =>
          ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );
    }
  });

  it('forwards regenerate_embedding:true in extras when checkbox is ticked', async () => {
    const user = userEvent.setup();
    // Baseline length 27 → threshold = 21.6. editValue length 27 ≥ 22 → guard
    // does not fire on the Save-button path.
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'This is the updated answer.',
      regenerateEmbedding: true,
      setRegenerateEmbedding: vi.fn(),
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    await screen.findByRole('textbox', { name: /standard answer/i });
    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
        'answer_standard',
        'This is the updated answer.',
        null,
        { regenerate_embedding: true },
      );
    });
  });
});

// ---------------------------------------------------------------------------
// AC13 — Cmd/Ctrl+S keyboard shortcut (M3)
// ---------------------------------------------------------------------------
//
// Spec AC13: pressing Cmd+S (or Ctrl+S) while editing a Q&A answer field
// MUST trigger exactly ONE PATCH mutation for the active field. The
// shortcut handler lives in `ContentEditor.handleKeyDown`
// (content-editor.tsx:165) which is registered on `document` so we can
// dispatch the event globally. The handler invokes `onSave(markdown)`
// which is the same callback the Save button calls — so success means a
// single `inlineEdit.saveEdit` call.
//
// Both fields are tested independently because each editor instance
// registers its own document listener; mounting the wrong field shouldn't
// cause the other field's editor to react.
describe('QAAnswerDisplay — AC13 Cmd/Ctrl+S triggers single PATCH', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
    if (!Element.prototype.getClientRects) {
      Element.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getClientRects) {
      Range.prototype.getClientRects = vi.fn(
        () => [] as unknown as DOMRectList,
      );
    }
    if (!Range.prototype.getBoundingClientRect) {
      Range.prototype.getBoundingClientRect = vi.fn(
        () =>
          ({
            x: 0,
            y: 0,
            width: 0,
            height: 0,
            top: 0,
            right: 0,
            bottom: 0,
            left: 0,
            toJSON: () => ({}),
          }) as DOMRect,
      );
    }
  });

  it('fires a single saveEdit for answer_standard on Cmd+S', async () => {
    // Baseline length 27 → threshold = 21.6. editValue length 27 clears the
    // guard inside `ContentEditor.handleSave`.
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_standard',
      editValue: 'This is the updated answer.',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    // Wait for the dynamically-imported editor to mount + register its
    // document keydown listener.
    await screen.findByRole('textbox', { name: /standard answer/i });

    // Dispatch directly on `document` because the handler is attached there
    // (content-editor.tsx:172). `metaKey` covers macOS; `ctrlKey` would also
    // match the same handler, but a single keydown is the AC13 contract.
    fireEvent.keyDown(document, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(inlineEdit.saveEdit).toHaveBeenCalledTimes(1);
    });
    expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
      'answer_standard',
      'This is the updated answer.',
      null,
      undefined,
    );
  });

  it('fires a single saveEdit for answer_advanced on Cmd+S', async () => {
    const inlineEdit = makeInlineEdit({
      editingField: 'answer_advanced',
      editValue: 'This is the updated advanced answer.',
    });
    render(<QAAnswerDisplay {...makeProps({ canEdit: true, inlineEdit })} />);

    await screen.findByRole('textbox', { name: /advanced answer/i });

    fireEvent.keyDown(document, { key: 's', metaKey: true });

    await waitFor(() => {
      expect(inlineEdit.saveEdit).toHaveBeenCalledTimes(1);
    });
    expect(inlineEdit.saveEdit).toHaveBeenCalledWith(
      'answer_advanced',
      'This is the updated advanced answer.',
      null,
      undefined,
    );
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
    expect(cards[0]).not.toHaveClass('border-l-[var(--status-warning)]');
    expect(cards[0]).not.toHaveClass('border-l-[var(--status-success)]');
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
    expect(cards[0]).not.toHaveClass('border-l-[var(--status-warning)]');
    expect(cards[0]).not.toHaveClass('border-l-[var(--status-success)]');
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
      answer_standard:
        'Key policies:\n\n- Quality management\n- Environmental management\n- Health and safety',
      answer_advanced: null,
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const listItems = document.querySelectorAll('li');
    expect(listItems.length).toBe(3);
    expect(listItems[0]).toHaveTextContent('Quality management');
  });

  it('renders table markdown in answers via remark-gfm', () => {
    const item = makeItem({
      answer_standard:
        '| Certification | Year |\n|---|---|\n| ISO 9001 | 2024 |\n| ISO 14001 | 2023 |',
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

    expect(
      screen.getByText('This is a plain text answer.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('This is a plain advanced answer.'),
    ).toBeInTheDocument();
  });

  it('preserves UK English text through ContentRenderer', () => {
    const item = makeItem({
      answer_standard:
        'Our organisation follows colour-coded procedures for behaviour management.',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    expect(
      screen.getByText(
        'Our organisation follows colour-coded procedures for behaviour management.',
      ),
    ).toBeInTheDocument();
  });

  // S198 §1.5 WP6 — AC3: read mode for both fields routes through
  // `QAPairRenderer` → `ContentRenderer` → react-markdown + remark-gfm.
  // These tests prove the heading-level markdown structure (`<h2>`) is
  // emitted alongside inline marks (`<strong>`), distinct from the existing
  // bold/list/table cases above.
  it('renders heading + inline bold markdown in standard answer (AC3)', () => {
    const item = makeItem({
      answer_standard: '## Heading\n\n**bold** text',
      answer_advanced: null,
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const h2 = document.querySelector('h2');
    expect(h2).toBeInTheDocument();
    expect(h2).toHaveTextContent('Heading');

    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('bold');
  });

  it('renders heading + inline bold markdown in advanced answer (AC3)', () => {
    const item = makeItem({
      answer_standard: null,
      answer_advanced: '## Heading\n\n**bold** text',
    });
    render(<QAAnswerDisplay {...makeProps({ item })} />);

    const h2 = document.querySelector('h2');
    expect(h2).toBeInTheDocument();
    expect(h2).toHaveTextContent('Heading');

    const strong = document.querySelector('strong');
    expect(strong).toBeInTheDocument();
    expect(strong).toHaveTextContent('bold');
  });
});

// ---------------------------------------------------------------------------
// Copy-button raw-markdown regression (§7.1)
// ---------------------------------------------------------------------------
//
// Spec §7.1 (line 1144): "Export / copy button: outputs raw markdown."
// The copy button calls `handleCopyAnswer(variant)` with the variant only —
// the parent (`item-detail-client.tsx`) is responsible for reading
// `item.answer_standard` / `item.answer_advanced` from state and writing
// the raw markdown string to the clipboard. This regression test guards
// that the variant arg is forwarded unchanged when the source content
// contains markdown syntax (i.e. the copy plumbing isn't accidentally
// re-routed through `ContentRenderer`'s rendered HTML).
describe('QAAnswerDisplay — copy button raw-markdown regression (§7.1)', () => {
  it('forwards "standard" variant unchanged when answer_standard contains markdown', () => {
    const handleCopyAnswer = vi.fn();
    const markdown = '**Bold** content with [link](http://example.com)';
    const item = makeItem({ answer_standard: markdown });
    render(<QAAnswerDisplay {...makeProps({ item, handleCopyAnswer })} />);

    const copyButtons = screen.getAllByRole('button', { name: /copy/i });
    fireEvent.click(copyButtons[0]);

    // Variant arg only — no auto-extracted HTML or rendered DOM string.
    expect(handleCopyAnswer).toHaveBeenCalledTimes(1);
    expect(handleCopyAnswer).toHaveBeenCalledWith('standard');
    // Confirm read-mode rendered the markdown (proves the source IS markdown,
    // not pre-rendered HTML in the prop), so the parent reading
    // `item.answer_standard` will get the raw markdown shown above.
    expect(document.querySelector('strong')).toHaveTextContent('Bold');
    expect(document.querySelector('a')).toHaveAttribute(
      'href',
      'http://example.com',
    );
  });
});
