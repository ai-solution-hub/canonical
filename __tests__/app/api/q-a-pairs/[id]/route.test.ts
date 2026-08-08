/**
 * API route tests for `app/api/q-a-pairs/[id]/route.ts` — both exported
 * handlers.
 *
 * PATCH — the UC6 user-direct Q&A write route, ID-59 {59.11} (PC-A4 / PC-4).
 * ID-127 {127.38} / DR-086a: the {59.30} sidecar emit + first-edit
 * materialisation legs are RETIRED. The route is KH-DB-ONLY again, so the
 * emit suite (write-back / materialise / INV-7 gate / bucket-idle-mode) is
 * gone and the contract it proved is replaced by the positive zero-Storage
 * assertion below: NO `origin_kind` — including the formerly in-scope
 * `curated_explicit` — reaches Storage on a PATCH.
 *
 * PATCH covers:
 *   - Auth gating: unauthenticated (401), viewer (403), editor/admin allowed.
 *   - Happy path: q_a_pairs UPDATE via tryQuery; response carries the updated
 *     row. The q_a_pair_history snapshot is the EXISTING trigger's job — the
 *     route performs NO app-side history insert (asserted: no `insert` on
 *     q_a_pair_history).
 *   - edit_intent stamp (single-actor + CRDT arbitrateMany merge path).
 *   - Validation: empty body → 400; unknown id → 404; unknown edit_intent
 *     coerced to 'cosmetic'.
 *   - Failure surfacing: UPDATE error → 500; affected-row = 1 assertion on the
 *     UPDATE (a 0-row PATCH is a failure, never a silent 200).
 *   - {127.38} KH-DB-only: a `curated_explicit` PATCH performs NO Storage
 *     read/PUT and never writes `source_document_id`.
 *
 * DELETE — the ID-135 {135.22} bulk-delete rehome. The pre-M6 `/library`
 * bulk-delete action DELETEd `/api/items/[id]` (removed by {131.17}); this is
 * its hard-delete sibling on this route, mirroring
 * `app/api/workspaces/[id]/route.ts`'s PATCH+DELETE convention. Hard delete is
 * DB-safe: every FK referencing `q_a_pairs.id` (q_a_pair_history,
 * q_a_pair_dedup_proposals, question_matches, citations, record_lifecycle) is
 * `ON DELETE CASCADE` or `ON DELETE SET NULL` (verified against the live
 * schema) — matching the pre-M6 hard-delete semantics of the old
 * `/api/items/[id]` DELETE (never a soft-archive).
 *
 * DELETE covers admin-only gating (401/403), the hard-delete happy path, 404
 * on 0 affected rows and 500 on a genuine DB failure.
 *
 * Mock discipline: shared `createMockSupabaseClient()` + `createTestRequest()`
 * (per `__tests__/CLAUDE.md`).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { configureAuth } from '@/__tests__/helpers/mock-auth';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';
import { CORPUS_BUCKET } from '@/lib/edit-intent/write-back';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH, DELETE } from '@/app/api/q-a-pairs/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QA_UUID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';
const ACTOR_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_DOC_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

/**
 * The shape of the storage bucket double `createMockSupabaseClient()` wires
 * `storage.from()` to resolve to. Declared locally (not imported from the
 * shared helper) because `MockSupabaseClient['storage']['from']`'s
 * `ReturnType<typeof vi.fn>` type is a bare, un-parameterised Mock — calling
 * it directly does not typecheck (TS2348); the cast below is the minimal
 * local fix, confined to this test file.
 */
interface MockStorageBucket {
  upload: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
}

/** The `corpus` Storage bucket double (`mockSupabase.storage.from(CORPUS_BUCKET)`). */
function bucket(): MockStorageBucket {
  const from = mockSupabase.storage.from as unknown as (
    bucketName: string,
  ) => MockStorageBucket;
  return from(CORPUS_BUCKET);
}

/**
 * The row the existence pre-read resolves to. {127.38}: the pre-read projects
 * `id` alone now that no sidecar decision hangs off it — a non-null row means
 * "the pair exists", nothing more.
 */
function storedPair(over: Record<string, unknown> = {}) {
  return { id: QA_UUID, ...over };
}

function makeContext() {
  return { params: createTestParams({ id: QA_UUID }) };
}

function makeRequest(body: unknown) {
  return createTestRequest(`/api/q-a-pairs/${QA_UUID}`, {
    method: 'PATCH',
    body,
  });
}

/** Configure the pre-read (.maybeSingle) to resolve a stored pair (or null). */
function configurePreRead(row: Record<string, unknown> | null) {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: row,
    error: null,
  });
}

/** The row the UPDATE...select().single() resolves to on the happy path. */
function configureUpdateReturns(row: Record<string, unknown>) {
  mockSupabase._chain.single.mockResolvedValueOnce({ data: row, error: null });
}

function resetMocks() {
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  // The writer-fence RPC (acquire + release) succeeds by default — tests
  // exercising fence-busy override with a scoped mockResolvedValueOnce.
  mockSupabase.rpc.mockResolvedValue({ data: true, error: null });
  // Storage defaults: an existing object with empty prior bytes (harmless
  // for tests that don't assert on the restore snapshot) + a successful PUT.
  bucket().download.mockResolvedValue({ data: new Blob(['']), error: null });
  bucket().upload.mockResolvedValue({
    data: { path: 'test-path' },
    error: null,
  });
}

// ---------------------------------------------------------------------------
// PATCH
// ---------------------------------------------------------------------------

describe('PATCH /api/q-a-pairs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.COCOINDEX_WORKER_URL;
    delete process.env.CRON_SECRET;
    resetMocks();
  });

  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);
      const res = await PATCH(
        makeRequest({ question_text: 'updated?' }),
        makeContext(),
      );
      expect(res.status).toBe(401);
    });

    it('returns 403 for viewer role', async () => {
      configureRole(mockSupabase, 'viewer');
      const res = await PATCH(
        makeRequest({ question_text: 'updated?' }),
        makeContext(),
      );
      expect(res.status).toBe(403);
    });
  });

  describe('validation', () => {
    it('returns 400 when no editable fields are supplied', async () => {
      configureRole(mockSupabase, 'editor');
      const res = await PATCH(makeRequest({}), makeContext());
      expect(res.status).toBe(400);
    });

    it('returns 404 when the pair does not exist', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(null);
      const res = await PATCH(
        makeRequest({ question_text: 'updated?' }),
        makeContext(),
      );
      expect(res.status).toBe(404);
    });
  });

  describe('happy path — UPDATE + trigger snapshot + stamp (DB-only)', () => {
    it('updates q_a_pairs via the editor role and stamps a single intent', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      configureUpdateReturns({
        id: QA_UUID,
        question_text: 'New question?',
        edit_intent: 'data',
      });

      const res = await PATCH(
        makeRequest({
          question_text: 'New question?',
          edit_intent: 'data',
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.q_a_pair.id).toBe(QA_UUID);
      expect(body.edit_intent).toBe('data');

      // The UPDATE targets q_a_pairs and carries the stamped edit_intent.
      expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
      expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('data');
      expect(updatePayload.question_text).toBe('New question?');
      // DB-only: no source_document_id mutation, no Storage PUT.
      expect(updatePayload.source_document_id).toBeUndefined();
      expect(bucket().upload).not.toHaveBeenCalled();
    });

    it('updates q_a_pairs via the admin role and stamps a single intent', async () => {
      configureRole(mockSupabase, 'admin');
      configurePreRead(storedPair());
      configureUpdateReturns({
        id: QA_UUID,
        question_text: 'Admin-edited question?',
        edit_intent: 'data',
      });

      const res = await PATCH(
        makeRequest({
          question_text: 'Admin-edited question?',
          edit_intent: 'data',
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.q_a_pair.id).toBe(QA_UUID);
      expect(body.edit_intent).toBe('data');
      expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('data');
    });

    it('performs NO app-side q_a_pair_history insert (trigger owns the snapshot)', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'cosmetic' });

      await PATCH(
        makeRequest({ answer_standard: 'Tweaked wording.' }),
        makeContext(),
      );

      expect(mockSupabase.from).not.toHaveBeenCalledWith('q_a_pair_history');
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });
  });

  describe('CRDT merge path — arbitrateMany over per-actor intents', () => {
    it('arbitrates two concurrent intents and stamps the merged result', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      // cosmetic + data ⇒ data (data wins arbitration).
      const res = await PATCH(
        makeRequest({
          answer_standard: 'Merged answer.',
          arbitration_inputs: [
            { actor: ACTOR_A, intent: 'cosmetic' },
            { actor: ACTOR_B, intent: 'data' },
          ],
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('data');
    });

    it('coerces an out-of-CV intent to cosmetic without rejecting the request', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'cosmetic' });

      const res = await PATCH(
        makeRequest({
          answer_standard: 'Wording only.',
          arbitration_inputs: [{ actor: ACTOR_A, intent: 'not-a-real-intent' }],
        }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.edit_intent).toBe('cosmetic');
    });
  });

  describe('failure surfacing', () => {
    it('returns 500 when the q_a_pairs UPDATE fails', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'boom', code: 'XXXXX' },
      });

      const res = await PATCH(
        makeRequest({ question_text: 'x?' }),
        makeContext(),
      );
      expect(res.status).toBe(500);
    });

    it('surfaces a failure when the UPDATE affects 0 rows (no silent no-op)', async () => {
      // tryQuery resolves ok with data:null (a 0-row UPDATE that did NOT error)
      // — the route must treat this as a failure, not a silent 200.
      configureRole(mockSupabase, 'editor');
      configurePreRead(storedPair());
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: null,
      });

      const res = await PATCH(
        makeRequest({ question_text: 'x?' }),
        makeContext(),
      );
      expect(res.status).toBe(500);
    });
  });

  // ── {127.38} KH-DB-only (DR-086a) ─────────────────────────────────────────
  describe('{127.38} KH-DB-only: no revision reaches Storage', () => {
    it('a curated_explicit pair with an existing sidecar linkage performs NO Storage read or PUT', async () => {
      // `curated_explicit` + a non-null source_document_id was the INV-12
      // write-back branch — the shape that used to rewrite a corpus object.
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: SOURCE_DOC_ID,
        }),
      );
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited answer.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      // The save landed on the DB alone: no snapshot download, no PUT, and no
      // source_documents storage_path resolution.
      expect(bucket().download).not.toHaveBeenCalled();
      expect(bucket().upload).not.toHaveBeenCalled();
      expect(mockSupabase.from).not.toHaveBeenCalledWith('source_documents');
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.answer_standard).toBe('Edited answer.');
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('a source-less curated_explicit pair MINTS nothing — no Storage PUT, no source_document_id stamped', async () => {
      // `curated_explicit` + a null source_document_id was the INV-13
      // MATERIALISE-ON-FIRST-EDIT branch — the only app path that ever minted
      // a Q&A sidecar object and stamped a derived linkage id. Both are gone.
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: null,
        }),
      );
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Now edited.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      expect(bucket().upload).not.toHaveBeenCalled();
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBeUndefined();
    });
  });
});

// ---------------------------------------------------------------------------
// DELETE
// ---------------------------------------------------------------------------

const DELETE_PAIR_ID = '77777777-7777-4777-8777-777777777777';

function callDelete() {
  return DELETE(
    createTestRequest(`/api/q-a-pairs/${DELETE_PAIR_ID}`, { method: 'DELETE' }),
    { params: Promise.resolve({ id: DELETE_PAIR_ID }) },
  );
}

/**
 * Queue the resolved value for the DELETE's own `.eq().select('id')` chain
 * read (array-returning, no `.single()`) — this route's final chain call has
 * no dedicated terminal mock (unlike `.single()`), so it resolves via the
 * chain's shared `then` (the same pattern
 * `citations-route.test.ts`'s `queueCitationsRows` uses). The auth role
 * lookup terminates via `.single()` (a separate mock queue via
 * `configureRole`), so this queued `then` resolution is consumed exactly
 * once, by this route's own query — never by the auth flow.
 */
function queueDeleteResult(
  client: MockSupabaseClient,
  result: { data: unknown; error: unknown },
) {
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve(result),
  );
}

describe('DELETE /api/q-a-pairs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects an unauthenticated caller', async () => {
    configureAuth(mockSupabase).asUnauthenticated();

    const res = await callDelete();

    expect(res.status).toBe(401);
  });

  it('rejects an editor-role caller (admin only)', async () => {
    configureAuth(mockSupabase).asEditor();

    const res = await callDelete();

    expect(res.status).toBe(403);
  });

  it('rejects a viewer-role caller (admin only)', async () => {
    configureAuth(mockSupabase).asViewer();

    const res = await callDelete();

    expect(res.status).toBe(403);
  });

  it('hard-deletes the pair for an admin caller and returns success', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, {
      data: [{ id: DELETE_PAIR_ID }],
      error: null,
    });

    const res = await callDelete();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockSupabase.from).toHaveBeenCalledWith('q_a_pairs');
    expect(mockSupabase._chain.delete).toHaveBeenCalled();
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', DELETE_PAIR_ID);
  });

  it('returns 404 when the pair does not exist (0 affected rows)', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, { data: [], error: null });

    const res = await callDelete();

    expect(res.status).toBe(404);
  });

  it('returns 500 on a genuine DB failure', async () => {
    configureAuth(mockSupabase).asAdmin();
    queueDeleteResult(mockSupabase, {
      data: null,
      error: { message: 'connection refused', code: 'PGRST500' },
    });

    const res = await callDelete();

    expect(res.status).toBe(500);
  });
});
