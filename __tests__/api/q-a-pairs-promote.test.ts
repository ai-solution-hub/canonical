/**
 * API route tests for POST /api/q-a-pairs/promote — UC5 bid→Q&A promotion.
 *
 * ID-59 {59.14} (PC-5 / INV-5(UC5)). Asserts the Checker contract:
 *  - promoting a form response creates a `q_a_pairs` DRAFT;
 *  - the draft carries lineage to (a) the source response and (b) the question;
 *  - the draft is review-before-publish (publication_status = 'draft');
 *  - NO file write occurs (storage is never touched);
 *  - `arbitrate()` / `arbitrateMany()` are NOT called;
 *  - the source read uses `form_*` naming (form_responses / form_questions);
 *  - the authorised (RLS-scoped) client is used — no service-role escalation.
 *
 * ID-130 {130.15} (T-B21): promotion now ALSO records the originating form's
 * lineage on the corpus pair — `source_form_instance_id`, derived from the
 * originating `form_questions` row. The corpus stays corpus-level (no
 * partition); this is a provenance column.
 *
 * ID-145 {145.23}: `source_workspace_id` (both on `form_questions` and on
 * `q_a_pairs`) was DROPPED entirely (W1c) with no replacement — workspaces
 * are wholesale-deleted for procurement (W1e, {145.6}). The form-instance
 * anchor (`form_template_id` renamed `form_instance_id`,
 * `source_form_template_id` renamed `source_form_instance_id`) is now the
 * sole lineage carrier.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';
import { configureAuth } from '../helpers/mock-auth';
import { createTestRequest } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

// Spy on the arbitration module: `coerceIntent` keeps its real (pure)
// implementation, but `arbitrate` / `arbitrateMany` are wrapped so the test can
// assert they are NEVER called by the promotion path (UC5 is single-actor).
const arbitrateSpy = vi.fn();
const arbitrateManySpy = vi.fn();
vi.mock('@/lib/edit-intent/arbitrate', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/edit-intent/arbitrate')>();
  return {
    ...actual,
    arbitrate: (...args: Parameters<typeof actual.arbitrate>) => {
      arbitrateSpy(...args);
      return actual.arbitrate(...args);
    },
    arbitrateMany: (...args: Parameters<typeof actual.arbitrateMany>) => {
      arbitrateManySpy(...args);
      return actual.arbitrateMany(...args);
    },
  };
});

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/q-a-pairs/promote/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RESPONSE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const QUESTION_ID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const NEW_PAIR_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-1a2b3c4d5e6f';
const FORM_INSTANCE_ID = 'd1e2f3a4-b5c6-4d7e-8f9a-2b3c4d5e6f70';

function sourceResponseRow() {
  return {
    id: RESPONSE_ID,
    question_id: QUESTION_ID,
    response_text: 'We hold ISO 27001 certification, renewed annually.',
    response_text_advanced: 'Certificate ref ISMS-2026-014; auditor BSI.',
    form_questions: {
      id: QUESTION_ID,
      question_text: 'What information security certifications do you hold?',
      // {130.15}: the originating question carries the form altitude, which
      // flows onto the corpus pair as provenance. ID-145 {145.23}:
      // form_template_id renamed form_instance_id; workspace_id DROPPED
      // (no replacement).
      form_instance_id: FORM_INSTANCE_ID,
    },
  };
}

/**
 * Configure the two terminal `.single()` calls the route makes, in order:
 *  1. the auth role lookup (user_roles) — handled by configureAuth;
 *  2. the source form_responses read;
 *  3. the q_a_pairs insert returning the new draft row.
 */
function configurePromotionSuccess(client: MockSupabaseClient) {
  // (2) source read
  client._chain.single.mockResolvedValueOnce({
    data: sourceResponseRow(),
    error: null,
  });
  // (3) insert returning the draft
  client._chain.single.mockResolvedValueOnce({
    data: {
      id: NEW_PAIR_ID,
      question_text: sourceResponseRow().form_questions.question_text,
      answer_standard: sourceResponseRow().response_text,
      answer_advanced: sourceResponseRow().response_text_advanced,
      origin_kind: 'derived_from_form_response',
      publication_status: 'draft',
      edit_intent: 'cosmetic',
      source_form_response_id: RESPONSE_ID,
      source_question_id: QUESTION_ID,
      source_form_instance_id: FORM_INSTANCE_ID,
    },
    error: null,
  });
}

function promoteRequest(body: Record<string, unknown>) {
  return createTestRequest('/api/q-a-pairs/promote', { method: 'POST', body });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/q-a-pairs/promote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('promotes a form response to a draft q_a_pair with lineage to response + question', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    const res = await POST(
      promoteRequest({ source_form_response_id: RESPONSE_ID }),
    );
    expect(res.status).toBe(201);

    const json = await res.json();
    // Draft created, review-before-publish.
    expect(json.q_a_pair.publication_status).toBe('draft');
    expect(json.q_a_pair.id).toBe(NEW_PAIR_ID);
    // Lineage to BOTH the source response and the originating question.
    expect(json.lineage.source_form_response_id).toBe(RESPONSE_ID);
    expect(json.lineage.source_question_id).toBe(QUESTION_ID);

    // The insert payload carried the lineage columns + draft status.
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.source_form_response_id).toBe(RESPONSE_ID);
    expect(insertArg.source_question_id).toBe(QUESTION_ID);
    expect(insertArg.publication_status).toBe('draft');
    expect(insertArg.origin_kind).toBe('derived_from_form_response');
    expect(insertArg.question_text).toBe(
      sourceResponseRow().form_questions.question_text,
    );
    expect(insertArg.answer_standard).toBe(sourceResponseRow().response_text);
  });

  it('records the originating form lineage on the corpus pair (T-B21)', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    const res = await POST(
      promoteRequest({ source_form_response_id: RESPONSE_ID }),
    );
    expect(res.status).toBe(201);

    // The corpus pair records the originating form_instance_id, derived from
    // the originating question (the corpus stays corpus-level — this is
    // provenance, not a partition). ID-145 {145.23}: workspace lineage is
    // DROPPED entirely, no replacement.
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.source_form_instance_id).toBe(FORM_INSTANCE_ID);
    expect(insertArg).not.toHaveProperty('source_workspace_id');

    // The form lineage is also surfaced on the response contract.
    const json = await res.json();
    expect(json.lineage.source_form_instance_id).toBe(FORM_INSTANCE_ID);
  });

  it('promotes with NULL form lineage when the question is not yet form-keyed', async () => {
    configureAuth(mockSupabase).asEditor();
    // Source question pre-dates the form re-key: no form_instance_id.
    const row = sourceResponseRow();
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        ...row,
        form_questions: {
          id: row.form_questions.id,
          question_text: row.form_questions.question_text,
          form_instance_id: null,
        },
      },
      error: null,
    });
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: NEW_PAIR_ID, publication_status: 'draft' },
      error: null,
    });

    const res = await POST(
      promoteRequest({ source_form_response_id: RESPONSE_ID }),
    );
    expect(res.status).toBe(201);

    // Promotion still succeeds; the provenance column is null (corpus-level pair).
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.source_form_instance_id).toBeNull();
  });

  it('reads the source via form_* tables (not stale bid_*)', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    await POST(promoteRequest({ source_form_response_id: RESPONSE_ID }));

    const fromCalls = mockSupabase.from.mock.calls.map((c) => c[0]);
    expect(fromCalls).toContain('form_responses');
    expect(fromCalls).toContain('q_a_pairs');
    // No stale bid_* surface anywhere.
    expect(fromCalls.some((t: string) => t.startsWith('bid_'))).toBe(false);
    // The source-read select projects the renamed form_questions join. (The
    // first select call is the auth user_roles lookup; find the projection.)
    const selectArgs = mockSupabase._chain.select.mock.calls.map((c) => c[0]);
    const sourceSelect = selectArgs.find(
      (s: string) => typeof s === 'string' && s.includes('form_questions'),
    );
    expect(sourceSelect).toBeDefined();
    expect(sourceSelect).not.toContain('bid_questions');
  });

  it('does NOT invoke arbitration (arbitrate / arbitrateMany never called)', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    await POST(
      promoteRequest({
        source_form_response_id: RESPONSE_ID,
        edit_intent: 'data',
      }),
    );

    expect(arbitrateSpy).not.toHaveBeenCalled();
    expect(arbitrateManySpy).not.toHaveBeenCalled();
  });

  it('writes NO file — storage is never touched during promotion', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    await POST(promoteRequest({ source_form_response_id: RESPONSE_ID }));

    expect(mockSupabase.storage.from).not.toHaveBeenCalled();
  });

  it('derives the originating question from the response when not supplied', async () => {
    configureAuth(mockSupabase).asEditor();
    configurePromotionSuccess(mockSupabase);

    await POST(promoteRequest({ source_form_response_id: RESPONSE_ID }));

    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    // Not in the body — derived from source.question_id.
    expect(insertArg.source_question_id).toBe(QUESTION_ID);
  });

  it('rejects a viewer with 403 (admin/editor role guard)', async () => {
    configureAuth(mockSupabase).asViewer();

    const res = await POST(
      promoteRequest({ source_form_response_id: RESPONSE_ID }),
    );
    expect(res.status).toBe(403);
    // No write attempted.
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('returns 404 when the source response is not visible (RLS-scoped read)', async () => {
    configureAuth(mockSupabase).asEditor();
    // Source read misses (PGRST116 = no row → RLS-scoped not-found).
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const res = await POST(
      promoteRequest({ source_form_response_id: RESPONSE_ID }),
    );
    expect(res.status).toBe(404);
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('rejects a malformed body (missing source_form_response_id) with 400', async () => {
    configureAuth(mockSupabase).asEditor();

    const res = await POST(promoteRequest({}));
    expect(res.status).toBe(400);
  });
});
