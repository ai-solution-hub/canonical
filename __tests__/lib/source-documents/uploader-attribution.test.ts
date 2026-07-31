/**
 * Tests for the `source_documents.uploaded_by` writer (id-407).
 *
 * `uploaded_by` was read by two search RPCs (projected under the alias
 * `sd.uploaded_by AS "created_by"`), `api.get_document_version_chain`, and
 * four TypeScript sites — and written by nothing, so every consumer resolved
 * the `'System'` / `'Unknown'` fallback. These tests pin the writer's
 * contract.
 *
 * What is asserted here is the VALUE that reaches the database and the
 * PREDICATE that guards it — not merely that a call was made. A regression
 * that wrote the wrong id, dropped the fill-once guard, or swallowed a DB
 * error would fail one of these.
 *
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { attributeUploader } from '@/lib/source-documents/uploader-attribution';
import { SupabaseError } from '@/lib/supabase/safe';

const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';
const ACTING_USER_ID = '33333333-3333-4333-8333-333333333333';

describe('attributeUploader', () => {
  let mockSupabase: MockSupabaseClient;

  function asClient(): Parameters<typeof attributeUploader>[0] {
    return mockSupabase as unknown as Parameters<typeof attributeUploader>[0];
  }

  /** Point the awaited chain at a given PostgREST result. */
  function resolveChainWith(result: {
    data: unknown;
    error: unknown;
    count?: number | null;
  }) {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ count: null, ...result }),
    );
  }

  beforeEach(() => {
    mockSupabase = createMockSupabaseClient();
    resolveChainWith({ data: [{ id: SOURCE_DOCUMENT_ID }], error: null });
  });

  it('writes the acting user id onto the named source_documents row', async () => {
    await attributeUploader(asClient(), SOURCE_DOCUMENT_ID, ACTING_USER_ID);

    expect(mockSupabase.from).toHaveBeenCalledWith('source_documents');
    // The written VALUE — not just "an update happened".
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      uploaded_by: ACTING_USER_ID,
    });
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'id',
      SOURCE_DOCUMENT_ID,
    );
  });

  it('can only ever fill an empty attribution, never overwrite one', async () => {
    await attributeUploader(asClient(), SOURCE_DOCUMENT_ID, ACTING_USER_ID);

    // The fill-once guard is the whole safety property: without this
    // predicate the UPDATE would rewrite an earlier admitter's credit.
    expect(mockSupabase._chain.is).toHaveBeenCalledWith('uploaded_by', null);
  });

  it('reports true when it filled the attribution', async () => {
    await expect(
      attributeUploader(asClient(), SOURCE_DOCUMENT_ID, ACTING_USER_ID),
    ).resolves.toBe(true);
  });

  it('reports false when the row already carried an uploader', async () => {
    // The fill-once predicate matched nothing — the row is already attributed.
    resolveChainWith({ data: [], error: null });

    await expect(
      attributeUploader(asClient(), SOURCE_DOCUMENT_ID, ACTING_USER_ID),
    ).resolves.toBe(false);
  });

  it('surfaces a database failure instead of silently leaving the row unattributed', async () => {
    resolveChainWith({
      data: null,
      error: { message: 'permission denied for table source_documents' },
    });

    // The error channel is READ: a write that fails must not look like a
    // write that succeeded. Silent degradation here is exactly the defect
    // id-407 exists to close.
    await expect(
      attributeUploader(asClient(), SOURCE_DOCUMENT_ID, ACTING_USER_ID),
    ).rejects.toBeInstanceOf(SupabaseError);
  });
});
