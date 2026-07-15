/**
 * ID-145 {145.17} — R7 retrieval wiring (BI-34/35). {145.29} (S470 owner
 * ratification) — PERSIST the question embedding under
 * record_embeddings.owner_kind='form_question' rather than
 * compute-on-recompute only. Unit tests for the shared
 * `recomputeQuestionMatches` / `recomputeQuestionMatchesBatch` helper over
 * the `question_match_recompute` RPC.
 *
 * Behaviour under test (test-philosophy.md — real behaviour, not
 * implementation): the RPC is called with the derived scope tags and a
 * stringified embedding; a missing form_type skips the call entirely;
 * failures (RPC error, or a thrown embedding/profile error) are swallowed
 * — the helper never throws, matching the extract route's existing
 * best-effort pattern. {145.29}: the SAME embedding value used for the RPC
 * call is best-effort upserted into record_embeddings
 * (owner_kind='form_question', owner_id=formQuestionId) — a persistence
 * failure must not block the RPC call or throw.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGenerateEmbedding, mockGetOrganisationProfile } = vi.hoisted(
  () => ({
    mockGenerateEmbedding: vi.fn(),
    mockGetOrganisationProfile: vi.fn(),
  }),
);

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/organisation-profile', () => ({
  getOrganisationProfile: mockGetOrganisationProfile,
}));

vi.spyOn(console, 'warn').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

import {
  recomputeQuestionMatches,
  recomputeQuestionMatchesBatch,
} from '@/lib/domains/procurement/question-match-recompute';

const FORM_QUESTION_ID = '00000000-0000-4000-8000-000000000001';

/**
 * `upsertResult` lets a test simulate a failed record_embeddings write
 * (`{ data: null, error: {...} }`) without affecting the RPC mock — the two
 * writes are independent per {145.29}'s best-effort contract.
 */
function makeSupabaseStub(
  rpcImpl?: (...args: unknown[]) => unknown,
  upsertResult?: { data?: unknown; error?: unknown },
) {
  const maybeSingle = vi.fn(() =>
    Promise.resolve(upsertResult ?? { data: { id: 'row-1' }, error: null }),
  );
  const select = vi.fn(() => ({ maybeSingle }));
  const upsert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ upsert }));

  return {
    rpc: vi.fn(rpcImpl ?? (() => Promise.resolve({ data: 2, error: null }))),
    from,
  } as unknown as Parameters<typeof recomputeQuestionMatches>[0];
}

/** Reach into the mocked `.from('record_embeddings').upsert(...)` chain. */
function getUpsertMock(supabase: ReturnType<typeof makeSupabaseStub>) {
  const from = (supabase as unknown as { from: ReturnType<typeof vi.fn> }).from;
  return from.mock.results[0]?.value.upsert as ReturnType<typeof vi.fn>;
}

describe('recomputeQuestionMatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
    mockGetOrganisationProfile.mockResolvedValue({
      sectors: ['construction'],
    });
  });

  it('calls question_match_recompute with the derived scope tag (form_type + sectors) and stringified embedding', async () => {
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatches(supabase, {
      formQuestionId: FORM_QUESTION_ID,
      questionText: 'Describe your approach to GDPR compliance.',
      formType: 'itt',
    });

    expect(supabase.rpc).toHaveBeenCalledWith('question_match_recompute', {
      p_form_question_id: FORM_QUESTION_ID,
      p_query: 'Describe your approach to GDPR compliance.',
      p_query_embedding: JSON.stringify([0.1, 0.2, 0.3]),
      p_question_kind: 'itt',
      p_scope_tag: ['itt', 'construction'],
      p_anti_scope_tag: [],
      p_limit: 20,
    });
  });

  it('deduplicates scope tags when a sector value collides with the form_type', async () => {
    mockGetOrganisationProfile.mockResolvedValue({
      sectors: ['itt', 'defence'],
    });
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatches(supabase, {
      formQuestionId: FORM_QUESTION_ID,
      questionText: 'Q',
      formType: 'itt',
    });

    const call = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.p_scope_tag).toEqual(['itt', 'defence']);
  });

  it('skips the RPC call entirely when the form has no form_type', async () => {
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatches(supabase, {
      formQuestionId: FORM_QUESTION_ID,
      questionText: 'Q',
      formType: null,
    });

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('does not throw when the RPC returns an error (best-effort)', async () => {
    const supabase = makeSupabaseStub(() =>
      Promise.resolve({ data: null, error: { message: 'boom', code: 'X' } }),
    );

    await expect(
      recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Q',
        formType: 'itt',
      }),
    ).resolves.toBeUndefined();
  });

  it('does not throw when embedding generation itself throws (best-effort)', async () => {
    mockGenerateEmbedding.mockRejectedValue(
      new Error('OPENAI_API_KEY environment variable is not set'),
    );
    const supabase = makeSupabaseStub();

    await expect(
      recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Q',
        formType: 'itt',
      }),
    ).resolves.toBeUndefined();

    // No RPC call should have been attempted once embedding generation failed.
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('does not throw when the organisation-profile lookup throws (best-effort)', async () => {
    mockGetOrganisationProfile.mockRejectedValue(new Error('db down'));
    const supabase = makeSupabaseStub();

    await expect(
      recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Q',
        formType: 'itt',
      }),
    ).resolves.toBeUndefined();
  });

  it('falls back to just the form_type when the organisation has no profile', async () => {
    mockGetOrganisationProfile.mockResolvedValue(null);
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatches(supabase, {
      formQuestionId: FORM_QUESTION_ID,
      questionText: 'Q',
      formType: 'psq',
    });

    const call = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(call.p_scope_tag).toEqual(['psq']);
  });

  // {145.29} — S470 ratification: PERSIST, not compute-on-recompute.
  describe('record_embeddings persistence ({145.29})', () => {
    it('upserts the same embedding used for the RPC call into record_embeddings under owner_kind=form_question', async () => {
      const supabase = makeSupabaseStub();

      await recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Describe your approach to GDPR compliance.',
        formType: 'itt',
      });

      expect(supabase.from).toHaveBeenCalledWith('record_embeddings');
      const upsert = getUpsertMock(supabase);
      expect(upsert).toHaveBeenCalledWith(
        {
          owner_kind: 'form_question',
          owner_id: FORM_QUESTION_ID,
          model: 'text-embedding-3-large',
          embedding: JSON.stringify([0.1, 0.2, 0.3]),
        },
        { onConflict: 'owner_kind,owner_id,model' },
      );

      // Same value fed to the RPC — no double-embedding (single generateEmbedding call).
      const rpcCall = (supabase.rpc as ReturnType<typeof vi.fn>).mock
        .calls[0][1];
      expect(rpcCall.p_query_embedding).toBe(JSON.stringify([0.1, 0.2, 0.3]));
      expect(mockGenerateEmbedding).toHaveBeenCalledTimes(1);
    });

    it('does not throw and still performs the RPC call when the record_embeddings upsert fails (best-effort)', async () => {
      const supabase = makeSupabaseStub(undefined, {
        data: null,
        error: { message: 'constraint violation', code: 'XX000' },
      });

      await expect(
        recomputeQuestionMatches(supabase, {
          formQuestionId: FORM_QUESTION_ID,
          questionText: 'Q',
          formType: 'itt',
        }),
      ).resolves.toBeUndefined();

      expect(supabase.rpc).toHaveBeenCalledTimes(1);
    });

    it('does not attempt the record_embeddings upsert when the form has no form_type', async () => {
      const supabase = makeSupabaseStub();

      await recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Q',
        formType: null,
      });

      expect(supabase.from).not.toHaveBeenCalled();
    });

    it('does not attempt the record_embeddings upsert when embedding generation throws', async () => {
      mockGenerateEmbedding.mockRejectedValue(new Error('rate limited'));
      const supabase = makeSupabaseStub();

      await recomputeQuestionMatches(supabase, {
        formQuestionId: FORM_QUESTION_ID,
        questionText: 'Q',
        formType: 'itt',
      });

      expect(supabase.from).not.toHaveBeenCalled();
    });
  });
});

describe('recomputeQuestionMatchesBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateEmbedding.mockResolvedValue([0.1]);
    mockGetOrganisationProfile.mockResolvedValue(null);
  });

  it('calls the RPC once per question', async () => {
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatchesBatch(
      supabase,
      [
        { id: 'q1', questionText: 'Question one?' },
        { id: 'q2', questionText: 'Question two?' },
        { id: 'q3', questionText: 'Question three?' },
      ],
      'itt',
    );

    expect(supabase.rpc).toHaveBeenCalledTimes(3);
  });

  it('processes questions in bounded batches of 5 without dropping any', async () => {
    const supabase = makeSupabaseStub();
    const questions = Array.from({ length: 12 }, (_, i) => ({
      id: `q${i}`,
      questionText: `Question ${i}?`,
    }));

    await recomputeQuestionMatchesBatch(supabase, questions, 'itt');

    expect(supabase.rpc).toHaveBeenCalledTimes(12);
  });

  it('skips every question when the form has no form_type', async () => {
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatchesBatch(
      supabase,
      [{ id: 'q1', questionText: 'Question?' }],
      null,
    );

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // {145.29} — extract-post-insert is one of the 3 call sites the S470
  // persistence ratification covers; the batch wrapper fans out to the
  // same per-question recomputeQuestionMatches, so each question gets its
  // own record_embeddings upsert.
  it('upserts a record_embeddings row for every question in the batch', async () => {
    const supabase = makeSupabaseStub();

    await recomputeQuestionMatchesBatch(
      supabase,
      [
        { id: 'q1', questionText: 'Question one?' },
        { id: 'q2', questionText: 'Question two?' },
      ],
      'itt',
    );

    expect(supabase.from).toHaveBeenCalledTimes(2);
    expect(supabase.from).toHaveBeenCalledWith('record_embeddings');
  });
});
