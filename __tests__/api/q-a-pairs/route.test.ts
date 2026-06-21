/**
 * API route tests for the UC6 user-direct Q&A write route
 * (`app/api/q-a-pairs/[id]/route.ts`, PATCH) — ID-59 {59.11} (PC-A4 / PC-4)
 * + {59.30} sidecar emit + first-edit materialisation (TECH R2; INV-12/13/7).
 *
 * Covers:
 *   - Auth gating: unauthenticated (401), viewer (403), editor/admin allowed.
 *   - Happy path: q_a_pairs UPDATE via tryQuery; response carries the updated
 *     row. The q_a_pair_history snapshot is the EXISTING trigger's job — the
 *     route performs NO app-side history insert (asserted: no `insert` on
 *     q_a_pair_history).
 *   - edit_intent stamp (single-actor + CRDT arbitrateMany merge path).
 *   - Validation: empty body → 400; unknown edit_intent coerced to 'cosmetic'.
 *   - {59.30} sidecar emit (INV-12 write-back, INV-13 materialise, INV-7 gate):
 *     · existing-sidecar `curated_explicit` pair → carried bytes written to the
 *       file AND the DB UPDATEd; force the DB leg to throw AFTER the file write
 *       → the file is RESTORED and one failure surfaces.
 *     · source-less `curated_explicit` pair → a sidecar is MINTED (file written
 *       + source_document_id set = sdUuid5(qaSidecarRelPath(id))).
 *     · `derived_from_form_response` pair → NO file write (INV-7 — not in set).
 *     · COCOINDEX_SOURCE_PATH unset → DB-only (save lands, no file write).
 *     · affected-row = 1 assertion on the UPDATE (0-row PATCH is a failure).
 *     · the DEFERRED-v1.1 comment is gone from the route source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The file leg is mocked so the carried bytes / restore can be asserted and
// failures forced deterministically (no temp dir needed for the route tests).
const fsMocks = vi.hoisted(() => ({
  writeFile: vi.fn(
    async (_path: string, _data: string): Promise<void> => undefined,
  ),
  readFile: vi.fn(async (_path: string): Promise<string> => ''),
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    default: { ...actual, ...fsMocks },
    writeFile: fsMocks.writeFile,
    readFile: fsMocks.readFile,
  };
});

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
const SOURCE_ROOT = '/tmp/cocoindex-source-root-test';

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
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PATCH /api/q-a-pairs/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fsMocks.writeFile.mockReset().mockResolvedValue(undefined);
    fsMocks.readFile.mockReset().mockResolvedValue('');
    delete process.env.COCOINDEX_SOURCE_PATH;
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
      // DB-only: no source_document_id mutation, no file write.
      expect(updatePayload.source_document_id).toBeUndefined();
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
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

  // ── {59.30} sidecar emit ─────────────────────────────────────────────────
  describe('{59.30} sidecar emit (INV-12 / INV-13 / INV-7)', () => {
    it('write-back (INV-12): an existing-sidecar curated_explicit pair writes the carried bytes AND UPDATEs the DB', async () => {
      process.env.COCOINDEX_SOURCE_PATH = SOURCE_ROOT;
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

      // File leg: carried bytes written to the resolved sidecar path.
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
      const [absPath, bytes] = fsMocks.writeFile.mock.calls[0];
      expect(absPath).toBe(`${SOURCE_ROOT}/__qa__/existing-sidecar.md`);
      // The full post-edit carried set (partial PATCH merged onto stored).
      const carried = parseCarriedSet(bytes);
      expect(carried.question_text).toBe('Original question?');
      expect(carried.answer_standard).toBe('Edited answer.');
      // Lifecycle never leaks into the file (INV-9).
      expect(bytes).not.toContain('edit_intent');
      expect(bytes).not.toContain('source_document_id');

      // DB leg: UPDATE ran; existing linkage is NOT re-written on write-back.
      expect(mockSupabase._chain.update).toHaveBeenCalledTimes(1);
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.answer_standard).toBe('Edited answer.');
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('write-back atomicity: a DB-leg failure AFTER the file write RESTORES the file and surfaces one failure', async () => {
      process.env.COCOINDEX_SOURCE_PATH = SOURCE_ROOT;
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: SOURCE_DOC_ID,
        }),
      );
      configureStoragePath('__qa__/existing-sidecar.md');
      // The prior on-disk bytes the compensating restore must put back.
      const PRIOR = '--- prior bytes ---';
      fsMocks.readFile.mockResolvedValue(PRIOR);
      // The DB UPDATE fails after the file write.
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
      // writeFile called twice: the edit, then the compensating restore.
      expect(fsMocks.writeFile).toHaveBeenCalledTimes(2);
      const restoreCall = fsMocks.writeFile.mock.calls[1];
      expect(restoreCall[1]).toBe(PRIOR);
    });

    it('materialise-on-first-edit (INV-13): a source-less curated_explicit pair MINTS a sidecar (file + source_document_id)', async () => {
      process.env.COCOINDEX_SOURCE_PATH = SOURCE_ROOT;
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
      const expectedAbsPath = `${SOURCE_ROOT}/${expectedRelPath}`;
      const expectedSdId = sdUuid5(expectedRelPath);

      expect(fsMocks.writeFile).toHaveBeenCalledTimes(1);
      const [absPath, bytes] = fsMocks.writeFile.mock.calls[0];
      expect(absPath).toBe(expectedAbsPath);
      const carried = parseCarriedSet(bytes);
      expect(carried.question_text).toBe('Authored question?');
      expect(carried.answer_standard).toBe('Now edited.');

      // DB leg sets the linkage so the pair is file-canonical from now on.
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBe(expectedSdId);
    });

    it('INV-7 gate: a derived_from_form_response pair does NOT mint a sidecar', async () => {
      process.env.COCOINDEX_SOURCE_PATH = SOURCE_ROOT;
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
      // Not in the INV-7 user-direct set → KH-DB-only, no file.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBeUndefined();
    });

    it('idle mode: COCOINDEX_SOURCE_PATH unset → DB-only even for a curated_explicit pair', async () => {
      // env intentionally unset (deleted in beforeEach).
      configureRole(mockSupabase, 'editor');
      configurePreRead(
        storedPair({
          origin_kind: 'curated_explicit',
          source_document_id: null,
        }),
      );
      configureUpdateReturns({ id: QA_UUID, edit_intent: 'data' });

      const res = await PATCH(
        makeRequest({ answer_standard: 'Edited.', edit_intent: 'data' }),
        makeContext(),
      );

      expect(res.status).toBe(200);
      // Idle → the save lands DB-only; no file mint, no linkage set.
      expect(fsMocks.writeFile).not.toHaveBeenCalled();
      const updatePayload = mockSupabase._chain.update.mock.calls[0][0];
      expect(updatePayload.source_document_id).toBeUndefined();
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
