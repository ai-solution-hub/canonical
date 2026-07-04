/**
 * API route tests for the UC6 user-direct Q&A write route
 * (`app/api/q-a-pairs/[id]/route.ts`, PATCH) — ID-59 {59.11} (PC-A4 / PC-4)
 * + {59.30} sidecar emit + first-edit materialisation (TECH R2; INV-12/13/7).
 * {138.12} T4 — the sidecar file leg re-points onto the `corpus` Storage
 * bucket (TECH §3.3 T4, folded into T1).
 *
 * Covers:
 *   - Auth gating: unauthenticated (401), viewer (403), editor/admin allowed.
 *   - Happy path: q_a_pairs UPDATE via tryQuery; response carries the updated
 *     row. The q_a_pair_history snapshot is the EXISTING trigger's job — the
 *     route performs NO app-side history insert (asserted: no `insert` on
 *     q_a_pair_history).
 *   - edit_intent stamp (single-actor + CRDT arbitrateMany merge path).
 *   - Validation: empty body → 400; unknown edit_intent coerced to 'cosmetic'.
 *   - {59.30}/{138.12} sidecar emit (INV-12 write-back, INV-13 materialise,
 *     INV-7 gate):
 *     · existing-sidecar `curated_explicit` pair → carried bytes PUT to the
 *       `corpus` bucket object AND the DB UPDATEd; force the DB leg to throw
 *       AFTER the PUT → the object is RESTORED and one failure surfaces.
 *     · source-less `curated_explicit` pair → a sidecar is MINTED (object PUT
 *       + source_document_id set = sdUuid5(qaSidecarRelPath(id))).
 *     · `derived_from_form_response` pair → NO Storage PUT (INV-7 — not in set).
 *     · the `corpus` bucket not provisioned in this project (Storage-leg
 *       idle-mode equivalent) → DB-only (save lands, no Storage PUT, no
 *       linkage set on the materialise path).
 *     · affected-row = 1 assertion on the UPDATE (0-row PATCH is a failure).
 *     · the DEFERRED-v1.1 comment is gone from the route source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';
import {
  sdUuid5,
  qaSidecarRelPath,
  parseCarriedSet,
} from '@/lib/q-a-pairs/sidecar-path';
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
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { PATCH } from '@/app/api/q-a-pairs/[id]/route';

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

/** A stored pair the pre-read resolves to. Defaults to the DB-only baseline. */
function storedPair(over: Record<string, unknown> = {}) {
  return {
    origin_kind: 'derived_from_form_response',
    source_document_id: null,
    question_text: 'Stored question?',
    answer_standard: 'Stored answer.',
    answer_advanced: null,
    alternate_question_phrasings: [],
    scope_tag: null,
    anti_scope_tag: null,
    ...over,
  };
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

/** Configure the storage_path resolution (.maybeSingle) for write-back. */
function configureStoragePath(storage_path: string | null) {
  mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
    data: { storage_path },
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
// Tests
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

  // ── {59.30}/{138.12} sidecar emit ─────────────────────────────────────────
  describe('{59.30}/{138.12} sidecar emit (INV-12 / INV-13 / INV-7)', () => {
    it('write-back (INV-12): an existing-sidecar curated_explicit pair PUTs the carried bytes AND UPDATEs the DB', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: SOURCE_DOC_ID,
          question_text: 'Original question?',
          answer_standard: 'Original answer.',
        }),
      );
      configureStoragePath('__qa__/existing-sidecar.md');
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited answer.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);

      // Storage leg: carried bytes PUT to the resolved sidecar object key.
      expect(bucket().upload).toHaveBeenCalledTimes(1);
      const [objectKey, bytes] = bucket().upload.mock.calls[0];
      expect(objectKey).toBe('__qa__/existing-sidecar.md');
      // The full post-edit carried set (partial PATCH merged onto stored).
      const carried = parseCarriedSet(bytes);
      expect(carried.question_text).toBe('Original question?');
      expect(carried.answer_standard).toBe('Edited answer.');
      // Lifecycle never leaks into the object (INV-9).
      expect(bytes).not.toContain('edit_intent');
      expect(bytes).not.toContain('source_document_id');

      // DB leg: UPDATE ran; existing linkage is NOT re-written on write-back.
      expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.answer_standard).toBe('Edited answer.');
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('write-back atomicity: a DB-leg failure AFTER the PUT RESTORES the object and surfaces one failure', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: SOURCE_DOC_ID,
        }),
      );
      configureStoragePath('__qa__/existing-sidecar.md');
      // The prior bytes the compensating restore must PUT back.
      const PRIOR = '--- prior bytes ---';
      bucket().download.mockResolvedValueOnce({
        data: new Blob([PRIOR]),
        error: null,
      });
      // The DB UPDATE fails after the PUT.
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'db boom', code: 'XXXXX' },
      });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited answer.' }),
        makeContext(),
      );

      // One failure surfaced.
      expect(res.status).toBe(500);
      // upload called twice: the edit, then the compensating restore.
      expect(bucket().upload).toHaveBeenCalledTimes(2);
      const restoreCall = bucket().upload.mock.calls[1];
      expect(restoreCall[1]).toBe(PRIOR);
    });

    it('materialise-on-first-edit (INV-13): a source-less curated_explicit pair MINTS a sidecar (Storage PUT + source_document_id)', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: null,
          question_text: 'Authored question?',
          answer_standard: 'Authored answer.',
        }),
      );
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Now edited.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);

      // Path + linkage are keyed on the PAIR PK (consistency with {59.29}).
      const expectedRelPath = qaSidecarRelPath(QA_UUID);
      const expectedSdId = sdUuid5(expectedRelPath);

      // MATERIALISE mints via writeNewCorpusObject — no download/snapshot,
      // a plain fenced PUT (no prior object to restore).
      expect(bucket().download).not.toHaveBeenCalled();
      expect(bucket().upload).toHaveBeenCalledTimes(1);
      const [objectKey, bytes] = bucket().upload.mock.calls[0];
      expect(objectKey).toBe(expectedRelPath);
      const carried = parseCarriedSet(bytes);
      expect(carried.question_text).toBe('Authored question?');
      expect(carried.answer_standard).toBe('Now edited.');

      // DB leg sets the linkage so the pair is file-canonical from now on.
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBe(expectedSdId);
    });

    it('INV-7 gate: a derived_from_form_response pair does NOT mint a sidecar', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'derived_from_form_response',
          source_document_id: null,
        }),
      );
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      // Not in the INV-7 user-direct set → KH-DB-only, no Storage PUT.
      expect(bucket().upload).not.toHaveBeenCalled();
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('{138.12} Storage-leg idle-mode equivalent (materialise branch): corpus bucket not provisioned → DB-only, no linkage set', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: null,
        }),
      );
      // The MATERIALISE mint's PUT fails with the bucket-not-found signature.
      bucket().upload.mockResolvedValueOnce({
        data: null,
        error: { message: 'Bucket not found' },
      });
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      // Bucket unconfigured → the save lands DB-only; the linkage is NEVER
      // set to a sidecar that was never actually written (no dangling ref).
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('{138.12} Storage-leg idle-mode equivalent (write-back branch): corpus bucket not provisioned → DB-only, existing linkage untouched', async () => {
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: SOURCE_DOC_ID,
        }),
      );
      configureStoragePath('__qa__/existing-sidecar.md');
      // The write-back snapshot download fails with bucket-not-found.
      bucket().download.mockResolvedValueOnce({
        data: null,
        error: { message: 'Bucket not found' },
      });
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited answer.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      expect(bucket().upload).not.toHaveBeenCalled();
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.answer_standard).toBe('Edited answer.');
    });
  });
});

// ---------------------------------------------------------------------------
// Source-level guard: the DEFERRED-v1.1 deferral is reversed.
// ---------------------------------------------------------------------------
describe('{59.30} route source no longer defers the file write', () => {
  it('the DEFERRED-v1.1 "no file write" comment is gone', () => {
    const src = readFileSync(
      join(process.cwd(), 'app/api/q-a-pairs/[id]/route.ts'),
      'utf8',
    );
    expect(src).not.toContain('DEFERRED-v1.1');
    expect(src).not.toMatch(/there is no file\s+write here, by design/);
  });
});
