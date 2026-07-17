/**
 * ItemQuestionsPanel — the Questions-tab surface (ID-145 {145.44}, BI-40).
 *
 * Behaviour under test: honest mixed per-question states (approved / drafted
 * / matched / empty, no all-or-nothing framing), the bulk Find-answers /
 * Draft-All actions, and the zero-candidate manual-answer affordance's TWO
 * acts (fix dispatch on the {145.44} Checker FAIL — BI-40's literal
 * contract): the PRIMARY, deterministic act (answer the question directly
 * via `POST /api/procurement/[id]/responses/manual`) and the OPTIONAL,
 * SEPARATE secondary act (also add the answer to the knowledge base via the
 * existing `POST /api/q-a-pairs/batch`).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { mockToast } = vi.hoisted(() => ({
  mockToast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('sonner', () => ({ toast: mockToast }));

import { ItemQuestionsPanel } from '@/components/procurement/item-questions-panel';
import type { ProcurementQuestion } from '@/types/procurement';

const { mockFetch } = vi.hoisted(() => ({ mockFetch: vi.fn() }));

function jsonResponse(data: unknown, ok = true, status = ok ? 201 : 400) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(data),
  });
}

let nextId = 1;
function makeQuestion(
  overrides: Partial<ProcurementQuestion> = {},
): ProcurementQuestion {
  const id = overrides.id ?? `q-${nextId++}`;
  return {
    id,
    workspace_id: 'form-1',
    section_name: null,
    section_sequence: 0,
    question_sequence: 0,
    question_text: `Question text for ${id}`,
    word_limit: null,
    evaluation_weight: null,
    confidence_posture: null,
    matched_record_ids: null,
    status: 'pending',
    has_variants: false,
    assigned_to: null,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('ItemQuestionsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the total question count', () => {
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[]}
        canEdit={false}
        totalQuestions={5}
      />,
    );
    expect(screen.getByTestId('item-questions-panel')).toHaveTextContent('5');
  });

  it('shows an honest empty state when there are no questions', () => {
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[]}
        canEdit={true}
        totalQuestions={0}
      />,
    );
    expect(screen.getByText('No questions yet.')).toBeInTheDocument();
  });

  // ---- Bulk actions ----

  it('shows "Find answers" only when there are unmatched questions, and calls the handler', async () => {
    const user = userEvent.setup();
    const onMatchQuestions = vi.fn();
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[makeQuestion()]}
        canEdit={true}
        totalQuestions={1}
        unmatchedCount={3}
        onMatchQuestions={onMatchQuestions}
      />,
    );
    const button = screen.getByRole('button', {
      name: /Find answers for 3 questions/,
    });
    await user.click(button);
    expect(onMatchQuestions).toHaveBeenCalledTimes(1);
  });

  it('hides "Find answers" when unmatchedCount is zero', () => {
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[makeQuestion()]}
        canEdit={true}
        totalQuestions={1}
        unmatchedCount={0}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Find answers/ }),
    ).not.toBeInTheDocument();
  });

  it('calls onDraftAll when Draft All is clicked, and disables it while drafting', async () => {
    const user = userEvent.setup();
    const onDraftAll = vi.fn();
    const { rerender } = render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[makeQuestion()]}
        canEdit={true}
        totalQuestions={1}
        onDraftAll={onDraftAll}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Draft All/ }));
    expect(onDraftAll).toHaveBeenCalledTimes(1);

    rerender(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[makeQuestion()]}
        canEdit={true}
        totalQuestions={1}
        onDraftAll={onDraftAll}
        draftingAll={true}
      />,
    );
    expect(screen.getByRole('button', { name: /Drafting/ })).toBeDisabled();
  });

  it('hides bulk actions for viewers', () => {
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[makeQuestion()]}
        canEdit={false}
        totalQuestions={1}
        unmatchedCount={1}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Find answers/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Draft All/ }),
    ).not.toBeInTheDocument();
  });

  // ---- Honest per-question states (BI-40) ----

  it('renders an approved question as Approved', () => {
    const question = makeQuestion({
      confidence_posture: 'strong_match',
      response: { id: 'r-1', review_status: 'approved', word_count: 40 },
    });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[question]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    expect(
      within(screen.getByTestId(`question-row-${question.id}`)).getByText(
        'Approved',
      ),
    ).toBeInTheDocument();
  });

  it('renders a drafted (not yet approved) question as Drafted', () => {
    const question = makeQuestion({
      confidence_posture: 'partial_match',
      response: { id: 'r-2', review_status: 'ai_drafted', word_count: 20 },
    });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[question]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    expect(
      within(screen.getByTestId(`question-row-${question.id}`)).getByText(
        'Drafted',
      ),
    ).toBeInTheDocument();
  });

  it('renders a matched (no response yet) question as Matched, with its confidence badge', () => {
    const question = makeQuestion({ confidence_posture: 'needs_sme' });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[question]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    const row = screen.getByTestId(`question-row-${question.id}`);
    expect(within(row).getByText('Matched')).toBeInTheDocument();
    expect(
      within(row).getByTitle(
        'Needs SME: No KB content. Route to subject matter expert.',
      ),
    ).toBeInTheDocument();
  });

  it('renders a zero-candidate question (no_content) as empty, honestly, alongside other states', () => {
    const approved = makeQuestion({
      confidence_posture: 'strong_match',
      response: { id: 'r-1', review_status: 'approved', word_count: 40 },
    });
    const empty = makeQuestion({ confidence_posture: 'no_content' });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[approved, empty]}
        canEdit={true}
        totalQuestions={2}
      />,
    );
    expect(
      within(screen.getByTestId(`question-row-${approved.id}`)).getByText(
        'Approved',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId(`question-row-${empty.id}`)).getByText(
        'No match found',
      ),
    ).toBeInTheDocument();
  });

  it('treats a never-matched question (null confidence_posture) as empty too', () => {
    const question = makeQuestion({ confidence_posture: null });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[question]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    expect(
      within(screen.getByTestId(`question-row-${question.id}`)).getByText(
        'No match found',
      ),
    ).toBeInTheDocument();
  });

  // ---- Zero-candidate manual-answer affordance ----

  it('offers the manual-answer affordance only for empty questions, and only when canEdit', () => {
    const empty = makeQuestion({ confidence_posture: 'no_content' });
    const { rerender } = render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    ).toBeInTheDocument();

    rerender(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={false}
        totalQuestions={1}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Answer this question directly' }),
    ).not.toBeInTheDocument();
  });

  it('does not offer the manual-answer affordance for a matched question', () => {
    const matched = makeQuestion({ confidence_posture: 'strong_match' });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[matched]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'Answer this question directly' }),
    ).not.toBeInTheDocument();
  });

  it('answers the question directly as the PRIMARY, deterministic act (no promotion requested)', async () => {
    const user = userEvent.setup();
    const onQuestionsChanged = vi.fn();
    const empty = makeQuestion({
      confidence_posture: 'no_content',
      question_text: 'What is your approach to safeguarding?',
    });
    mockFetch.mockReturnValueOnce(
      jsonResponse({
        id: 'resp-1',
        question_id: empty.id,
        response_text: 'We follow our safeguarding policy at all times.',
        review_status: 'draft',
        drafted_by: 'user-1',
      }),
    );

    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
        onQuestionsChanged={onQuestionsChanged}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    );
    const textarea = screen.getByLabelText(
      `Manual answer for: ${empty.question_text}`,
    );
    await user.type(
      textarea,
      'We follow our safeguarding policy at all times.',
    );
    // The promotion checkbox is left unchecked — corpus promotion is opt-in.
    await user.click(screen.getByRole('button', { name: /Save answer/ }));

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith('Answer saved.'),
    );
    // ONLY the primary answer-the-question call is made — no corpus write.
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      `/api/procurement/form-1/responses/manual`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          question_id: empty.id,
          response_text: 'We follow our safeguarding policy at all times.',
        }),
      }),
    );
    expect(onQuestionsChanged).toHaveBeenCalledTimes(1);
    // The form collapses back to the affordance button after a successful save.
    expect(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    ).toBeInTheDocument();
  });

  it('also promotes to the knowledge base as a SEPARATE, OPTIONAL act when the checkbox is checked', async () => {
    const user = userEvent.setup();
    const empty = makeQuestion({
      confidence_posture: 'no_content',
      question_text: 'What is your approach to safeguarding?',
    });
    mockFetch
      .mockReturnValueOnce(
        jsonResponse({
          id: 'resp-1',
          question_id: empty.id,
          response_text: 'We follow our safeguarding policy at all times.',
          review_status: 'draft',
          drafted_by: 'user-1',
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({
          created: 1,
          failed: 0,
          items: [
            { id: 'qa-1', title: empty.question_text, status: 'created' },
          ],
          pipeline_run_id: null,
          batch_id: 'batch-1',
        }),
      );

    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    );
    const textarea = screen.getByLabelText(
      `Manual answer for: ${empty.question_text}`,
    );
    await user.type(
      textarea,
      'We follow our safeguarding policy at all times.',
    );
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Also add this answer to your knowledge base',
      }),
    );
    await user.click(screen.getByRole('button', { name: /Save answer/ }));

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith(
        'Answer saved and added to your knowledge base.',
      ),
    );
    expect(mockFetch).toHaveBeenCalledTimes(2);
    // Call 1: the primary act (answer the question).
    expect(mockFetch).toHaveBeenNthCalledWith(
      1,
      `/api/procurement/form-1/responses/manual`,
      expect.objectContaining({ method: 'POST' }),
    );
    // Call 2: the secondary, optional act (corpus promotion) — only fires
    // because the checkbox was checked.
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      '/api/q-a-pairs/batch',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          items: [
            {
              question_text: empty.question_text,
              answer_standard:
                'We follow our safeguarding policy at all times.',
            },
          ],
        }),
      }),
    );
  });

  it('treats a promotion failure as non-blocking — the primary save still counts as a success', async () => {
    const user = userEvent.setup();
    const empty = makeQuestion({ confidence_posture: 'no_content' });
    mockFetch
      .mockReturnValueOnce(
        jsonResponse({
          id: 'resp-1',
          question_id: empty.id,
          response_text: 'An answer.',
          review_status: 'draft',
          drafted_by: 'user-1',
        }),
      )
      .mockReturnValueOnce(
        jsonResponse({ error: 'Failed to create Q&A draft' }, false, 500),
      );

    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    );
    const textarea = screen.getByLabelText(
      `Manual answer for: ${empty.question_text}`,
    );
    await user.type(textarea, 'An answer.');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Also add this answer to your knowledge base',
      }),
    );
    await user.click(screen.getByRole('button', { name: /Save answer/ }));

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith('Answer saved.'),
    );
    expect(mockToast.error).toHaveBeenCalledWith('Failed to create Q&A draft');
    // The primary act's success collapses the form regardless.
    expect(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    ).toBeInTheDocument();
  });

  it('rejects saving an empty manual answer without calling the backend', async () => {
    const user = userEvent.setup();
    const empty = makeQuestion({ confidence_posture: 'no_content' });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    );
    await user.click(screen.getByRole('button', { name: /Save answer/ }));
    expect(mockToast.error).toHaveBeenCalledWith(
      'Enter an answer before saving',
    );
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('surfaces a primary-save backend failure honestly and keeps the answer editable', async () => {
    const user = userEvent.setup();
    const empty = makeQuestion({ confidence_posture: 'no_content' });
    mockFetch.mockReturnValueOnce(
      jsonResponse(
        { error: 'This question already has a response' },
        false,
        409,
      ),
    );

    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[empty]}
        canEdit={true}
        totalQuestions={1}
      />,
    );
    await user.click(
      screen.getByRole('button', { name: 'Answer this question directly' }),
    );
    const textarea = screen.getByLabelText(
      `Manual answer for: ${empty.question_text}`,
    );
    await user.type(textarea, 'An answer that fails to save.');
    await user.click(screen.getByRole('button', { name: /Save answer/ }));

    await waitFor(() =>
      expect(mockToast.error).toHaveBeenCalledWith(
        'This question already has a response',
      ),
    );
    // Stays expanded — the user's text is not lost on failure, and no
    // promotion call was ever attempted (the primary act failed first).
    expect(
      screen.getByLabelText(`Manual answer for: ${empty.question_text}`),
    ).toHaveValue('An answer that fails to save.');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  // ---- Section grouping ----

  it('groups questions under their section heading', () => {
    const q1 = makeQuestion({ section_name: 'Technical', section_sequence: 0 });
    const q2 = makeQuestion({
      section_name: 'Commercial',
      section_sequence: 1,
    });
    render(
      <ItemQuestionsPanel
        procurementId="form-1"
        questions={[q2, q1]}
        canEdit={true}
        totalQuestions={2}
      />,
    );
    const headings = screen.getAllByRole('heading', { level: 3 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Technical',
      'Commercial',
    ]);
  });
});
