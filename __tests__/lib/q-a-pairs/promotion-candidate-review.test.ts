/**
 * lib/q-a-pairs/promotion-candidate-review.ts tests (ID-145 {145.30} — BI-38
 * amendment, DR-062, S470).
 *
 * Acceptance (testStrategy): a reviewer accepts/edits/rejects an individual
 * `awaiting_review` promotion candidate (an extraction linked to an
 * ALREADY-PUBLISHED pair whose carried fields differ — DR-026
 * propose-surfacing half, {138.17}).
 *
 * Scope gate: only an 'awaiting_review' candidate (linked + pair NOT draft)
 * is actionable here. A 'new' (unlinked) or 'self_healing' (linked +
 * still-draft pair) extraction id is rejected 409 — those are promoted
 * wholesale via the existing "Run promotion pass" batch
 * (promoteCorpusExtractions), which has no per-item judgement gap.
 *
 * Self-cleaning design: every action ends with the extraction's carried
 * fields EQUAL to the pair's (new) carried fields, so the RPC's branch-3 diff
 * predicate (20260707140000_id138_promotion_candidates_published_diff.sql)
 * naturally stops re-selecting the row — no new "dismissed" column needed.
 *
 * Mock discipline: shared createMockSupabaseTableDispatch() — never hand-roll
 * Supabase mocks. generateEmbedding stubbed via vi.hoisted() per
 * __tests__/CLAUDE.md hoisting discipline.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseTableDispatch } from '../../helpers/mock-supabase';

const { mockGenerateEmbedding } = vi.hoisted(() => ({
  mockGenerateEmbedding: vi.fn(),
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

const { mockLogBestEffortWarn } = vi.hoisted(() => ({
  mockLogBestEffortWarn: vi.fn(),
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: mockLogBestEffortWarn,
}));

import {
  acceptAwaitingReviewCandidate,
  editAwaitingReviewCandidate,
  rejectAwaitingReviewCandidate,
} from '@/lib/q-a-pairs/promotion-candidate-review';

const EXTRACTION_ID = '11111111-1111-4111-8111-111111111111';
const PAIR_ID = '22222222-2222-4222-8222-222222222222';

function extractionRow(over: Record<string, unknown> = {}) {
  return {
    id: EXTRACTION_ID,
    extracted_question_text: 'What is your H&S policy (re-walked)?',
    extracted_answer_text: 'We maintain a documented H&S policy (re-walked).',
    alternate_question_phrasings: ['H&S policy?'],
    promoted_to_pair_id: PAIR_ID,
    invalidated_at: null,
    ...over,
  };
}

function pairRow(over: Record<string, unknown> = {}) {
  return {
    id: PAIR_ID,
    question_text: 'What is your H&S policy?',
    answer_standard: 'We maintain a documented H&S policy.',
    alternate_question_phrasings: [],
    publication_status: 'published',
    ...over,
  };
}

/**
 * Build a dispatch mock wired for the read-then-write flow:
 *   q_a_extractions: read (.maybeSingle) THEN optional reconcile write (.maybeSingle)
 *   q_a_pairs: read (.maybeSingle) THEN optional carried write (.maybeSingle)
 *   record_embeddings: upsert (.maybeSingle)
 */
function build(opts: {
  extraction?: Record<string, unknown> | null;
  pair?: Record<string, unknown> | null;
  extractionWriteResult?: Record<string, unknown> | null;
  pairWriteResult?: Record<string, unknown> | null;
  pairWriteError?: { message: string; code: string } | null;
  extractionWriteError?: { message: string; code: string } | null;
}) {
  const dispatch = createMockSupabaseTableDispatch({
    q_a_extractions: {
      data: opts.extraction === undefined ? extractionRow() : opts.extraction,
      error: null,
    },
    q_a_pairs: {
      data: opts.pair === undefined ? pairRow() : opts.pair,
      error: null,
    },
    record_embeddings: { data: { id: 'emb-1' }, error: null },
  });

  const extractionChain = dispatch._chains.q_a_extractions;
  extractionChain.maybeSingle.mockResolvedValueOnce({
    data: opts.extraction === undefined ? extractionRow() : opts.extraction,
    error: null,
  });
  if (opts.extractionWriteResult !== undefined || opts.extractionWriteError) {
    extractionChain.maybeSingle.mockResolvedValueOnce({
      data: opts.extractionWriteResult ?? null,
      error: opts.extractionWriteError ?? null,
    });
  }

  const pairChain = dispatch._chains.q_a_pairs;
  pairChain.maybeSingle.mockResolvedValueOnce({
    data: opts.pair === undefined ? pairRow() : opts.pair,
    error: null,
  });
  if (opts.pairWriteResult !== undefined || opts.pairWriteError) {
    pairChain.maybeSingle.mockResolvedValueOnce({
      data: opts.pairWriteResult ?? null,
      error: opts.pairWriteError ?? null,
    });
  }

  return dispatch;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
});

describe('loadAwaitingReviewCandidate gate (shared by accept/edit/reject)', () => {
  it('returns not_found when the extraction does not exist', async () => {
    const client = build({ extraction: null });
    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_found');
  });

  it('rejects an invalidated extraction (not_awaiting_review)', async () => {
    const client = build({
      extraction: extractionRow({ invalidated_at: '2026-07-01T00:00:00Z' }),
    });
    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_awaiting_review');
  });

  it("rejects a 'new' (unlinked) candidate — promote via the batch run instead", async () => {
    const client = build({
      extraction: extractionRow({ promoted_to_pair_id: null }),
    });
    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_awaiting_review');
  });

  it("rejects a 'self_healing' candidate (linked pair still draft) — self-heals via the batch run", async () => {
    const client = build({
      pair: pairRow({ publication_status: 'draft' }),
    });
    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_awaiting_review');
  });

  it('fail-safes when the linked pair cannot be found', async () => {
    const client = build({ pair: null });
    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('not_awaiting_review');
  });
});

describe('acceptAwaitingReviewCandidate', () => {
  it("writes the extraction's carried fields onto the published pair", async () => {
    const client = build({
      pairWriteResult: pairRow({
        question_text: 'What is your H&S policy (re-walked)?',
        answer_standard: 'We maintain a documented H&S policy (re-walked).',
        alternate_question_phrasings: ['H&S policy?'],
      }),
    });

    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );

    expect(result.ok).toBe(true);
    const pairChain = client._chains.q_a_pairs;
    expect(pairChain.update).toHaveBeenCalledTimes(1);
    const payload = pairChain.update.mock.calls[0][0];
    expect(payload.question_text).toBe('What is your H&S policy (re-walked)?');
    expect(payload.answer_standard).toBe(
      'We maintain a documented H&S policy (re-walked).',
    );
    expect(payload.alternate_question_phrasings).toEqual(['H&S policy?']);
  });

  it('re-generates the embedding for the new question text and dual-writes record_embeddings', async () => {
    const client = build({ pairWriteResult: pairRow() });

    await acceptAwaitingReviewCandidate(client as never, EXTRACTION_ID);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(
      'What is your H&S policy (re-walked)?',
    );
    const embChain = client._chains.record_embeddings;
    expect(embChain.upsert).toHaveBeenCalledTimes(1);
    const upsertPayload = embChain.upsert.mock.calls[0][0];
    expect(upsertPayload.owner_kind).toBe('q_a_pair');
    expect(upsertPayload.owner_id).toBe(PAIR_ID);
  });

  it('does NOT reconcile the extraction row (the pair now equals it — self-cleaning)', async () => {
    const client = build({ pairWriteResult: pairRow() });

    await acceptAwaitingReviewCandidate(client as never, EXTRACTION_ID);

    const extractionChain = client._chains.q_a_extractions;
    expect(extractionChain.update).not.toHaveBeenCalled();
  });

  it('falls back to the pair’s existing answer when the extraction has no usable answer text', async () => {
    const client = build({
      extraction: extractionRow({ extracted_answer_text: '   ' }),
      pairWriteResult: pairRow(),
    });

    await acceptAwaitingReviewCandidate(client as never, EXTRACTION_ID);

    const payload = client._chains.q_a_pairs.update.mock.calls[0][0];
    expect(payload.answer_standard).toBe(
      'We maintain a documented H&S policy.',
    );
  });

  it('is best-effort on the embed step: a generateEmbedding failure does not fail the accept', async () => {
    mockGenerateEmbedding.mockRejectedValueOnce(new Error('embed boom'));
    const client = build({ pairWriteResult: pairRow() });

    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );

    expect(result.ok).toBe(true);
    expect(mockLogBestEffortWarn).toHaveBeenCalled();
    expect(client._chains.record_embeddings.upsert).not.toHaveBeenCalled();
  });

  it('returns write_failed when the pair UPDATE errors', async () => {
    const client = build({
      pairWriteResult: null,
      pairWriteError: { message: 'db boom', code: 'XXXXX' },
    });

    const result = await acceptAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('write_failed');
  });
});

describe('editAwaitingReviewCandidate', () => {
  const EDIT = {
    question_text: 'Do you hold a valid H&S policy document?',
    answer_standard: 'Yes — reviewed annually.',
    alternate_question_phrasings: ['H&S policy document?'],
  };

  it('writes the ADMIN-SUPPLIED fields onto the pair (not the raw extraction text)', async () => {
    const client = build({
      pairWriteResult: pairRow(EDIT),
      extractionWriteResult: extractionRow({
        extracted_question_text: EDIT.question_text,
        extracted_answer_text: EDIT.answer_standard,
        alternate_question_phrasings: EDIT.alternate_question_phrasings,
      }),
    });

    const result = await editAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
      EDIT,
    );

    expect(result.ok).toBe(true);
    const pairPayload = client._chains.q_a_pairs.update.mock.calls[0][0];
    expect(pairPayload.question_text).toBe(EDIT.question_text);
    expect(pairPayload.answer_standard).toBe(EDIT.answer_standard);
  });

  it('reconciles the extraction row to the SAME edited values (self-cleaning)', async () => {
    const client = build({
      pairWriteResult: pairRow(EDIT),
      extractionWriteResult: extractionRow({
        extracted_question_text: EDIT.question_text,
      }),
    });

    await editAwaitingReviewCandidate(client as never, EXTRACTION_ID, EDIT);

    const extractionPayload =
      client._chains.q_a_extractions.update.mock.calls[0][0];
    expect(extractionPayload.extracted_question_text).toBe(EDIT.question_text);
    expect(extractionPayload.extracted_answer_text).toBe(EDIT.answer_standard);
  });

  it('re-generates the embedding for the edited question text', async () => {
    const client = build({
      pairWriteResult: pairRow(EDIT),
      extractionWriteResult: extractionRow(),
    });

    await editAwaitingReviewCandidate(client as never, EXTRACTION_ID, EDIT);

    expect(mockGenerateEmbedding).toHaveBeenCalledWith(EDIT.question_text);
  });

  it('defaults alternate_question_phrasings to an empty array when omitted', async () => {
    const client = build({
      pairWriteResult: pairRow(),
      extractionWriteResult: extractionRow(),
    });

    await editAwaitingReviewCandidate(client as never, EXTRACTION_ID, {
      question_text: EDIT.question_text,
      answer_standard: EDIT.answer_standard,
    });

    const pairPayload = client._chains.q_a_pairs.update.mock.calls[0][0];
    expect(pairPayload.alternate_question_phrasings).toEqual([]);
  });
});

describe('rejectAwaitingReviewCandidate', () => {
  it('writes NOTHING to the pair — the reviewer judged the published text correct', async () => {
    const client = build({
      extractionWriteResult: extractionRow({
        extracted_question_text: 'What is your H&S policy?',
        extracted_answer_text: 'We maintain a documented H&S policy.',
      }),
    });

    const result = await rejectAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );

    expect(result.ok).toBe(true);
    expect(client._chains.q_a_pairs.update).not.toHaveBeenCalled();
  });

  it("reconciles the extraction's carried fields DOWN to the pair's current values", async () => {
    const client = build({
      extractionWriteResult: extractionRow({
        extracted_question_text: 'What is your H&S policy?',
        extracted_answer_text: 'We maintain a documented H&S policy.',
        alternate_question_phrasings: [],
      }),
    });

    await rejectAwaitingReviewCandidate(client as never, EXTRACTION_ID);

    const extractionPayload =
      client._chains.q_a_extractions.update.mock.calls[0][0];
    expect(extractionPayload.extracted_question_text).toBe(
      'What is your H&S policy?',
    );
    expect(extractionPayload.extracted_answer_text).toBe(
      'We maintain a documented H&S policy.',
    );
  });

  it('never calls generateEmbedding (the pair text is unchanged)', async () => {
    const client = build({ extractionWriteResult: extractionRow() });

    await rejectAwaitingReviewCandidate(client as never, EXTRACTION_ID);

    expect(mockGenerateEmbedding).not.toHaveBeenCalled();
  });

  it('returns write_failed when the extraction reconcile UPDATE errors', async () => {
    const client = build({
      extractionWriteResult: null,
      extractionWriteError: { message: 'db boom', code: 'XXXXX' },
    });

    const result = await rejectAwaitingReviewCandidate(
      client as never,
      EXTRACTION_ID,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('write_failed');
  });
});
