import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// Mock @sentry/nextjs BEFORE importing the helper so the spy captures
// every addBreadcrumb call (L4 verifier fix — previously untested).
vi.mock('@sentry/nextjs', () => ({
  addBreadcrumb: vi.fn(),
}));
import * as Sentry from '@sentry/nextjs';

import { setSupersession, SupersessionError } from '@/lib/supersession/set';

// ---------------------------------------------------------------------------
// Mock Supabase client — models .from(...).select(...).eq(...).maybeSingle()
// and .from(...).update(...).eq(...).select(...).single() chains used by
// setSupersession. Each from() call gets a fresh chain so different table
// calls don't interfere.
// ---------------------------------------------------------------------------

type MockResponse<T> = { data: T | null; error: { message: string } | null };

interface ChainMock {
  select: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
}

function makeChain(): ChainMock {
  const chain: ChainMock = {
    select: vi.fn(),
    update: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(),
    single: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.update.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  return chain;
}

interface MockClient {
  client: SupabaseClient<Database>;
  loadOldChain: ChainMock;
  loadNewChain: ChainMock;
  updateChain: ChainMock;
}

function makeMockClient(
  loadOld: MockResponse<Record<string, unknown>>,
  loadNew: MockResponse<Record<string, unknown>>,
  updateResult: MockResponse<Record<string, unknown>>,
): MockClient {
  const loadOldChain = makeChain();
  loadOldChain.maybeSingle.mockResolvedValue(loadOld);

  const loadNewChain = makeChain();
  loadNewChain.maybeSingle.mockResolvedValue(loadNew);

  const updateChain = makeChain();
  updateChain.single.mockResolvedValue(updateResult);

  // from() is called three times in order: load old, load new, update.
  // Match by call sequence.
  const from = vi
    .fn()
    .mockReturnValueOnce(loadOldChain)
    .mockReturnValueOnce(loadNewChain)
    .mockReturnValueOnce(updateChain);

  return {
    client: { from } as unknown as SupabaseClient<Database>,
    loadOldChain,
    loadNewChain,
    updateChain,
  };
}

const OLD_ID = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '22222222-2222-4222-8222-222222222222';
const ACTOR_ID = '33333333-3333-4333-8333-333333333333';

const oldRow = {
  id: OLD_ID,
  title: 'Old item title',
  superseded_by: null,
  dedup_status: 'suspected_duplicate',
};
const newRow = {
  id: NEW_ID,
  title: 'New item title',
  superseded_by: null,
  dedup_status: 'clean',
};
const updatedOldRow = {
  id: OLD_ID,
  title: 'Old item title',
  superseded_by: NEW_ID,
  dedup_status: 'superseded',
};

describe('setSupersession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updates old row and returns both snapshots on success', async () => {
    const { client, updateChain } = makeMockClient(
      { data: oldRow, error: null },
      { data: newRow, error: null },
      { data: updatedOldRow, error: null },
    );

    const result = await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    );

    expect(result.oldItem).toEqual(updatedOldRow);
    expect(result.newItem).toEqual(newRow);
    // S216 §5.2 Phase 5 — the UPDATE payload is now extended to include
    // archive side-effects on the OLD row (publication_status, archived_at,
    // archived_by, archive_reason, updated_by). The default archive_reason
    // is `Superseded by item ${newId}` when archiveReason is omitted.
    expect(updateChain.update).toHaveBeenCalledWith({
      superseded_by: NEW_ID,
      dedup_status: 'superseded',
      publication_status: 'archived',
      archived_at: expect.any(String),
      archived_by: ACTOR_ID,
      archive_reason: `Superseded by item ${NEW_ID}`,
      updated_by: ACTOR_ID,
    });
    // archived_at must be a parseable ISO 8601 timestamp.
    const updateCall = updateChain.update.mock.calls[0]?.[0] as {
      archived_at: string;
    };
    expect(Number.isFinite(Date.parse(updateCall.archived_at))).toBe(true);
    expect(updateChain.eq).toHaveBeenCalledWith('id', OLD_ID);
  });

  it('uses the provided archiveReason when supplied', async () => {
    const { client, updateChain } = makeMockClient(
      { data: oldRow, error: null },
      { data: newRow, error: null },
      { data: updatedOldRow, error: null },
    );

    const customReason = 'Confirmed near-duplicate via admin review';
    await setSupersession(
      {
        oldId: OLD_ID,
        newId: NEW_ID,
        actorUserId: ACTOR_ID,
        archiveReason: customReason,
      },
      client,
    );

    expect(updateChain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        archive_reason: customReason,
      }),
    );
  });

  it('emits a Sentry breadcrumb with actor + both titles on success', async () => {
    const { client } = makeMockClient(
      { data: oldRow, error: null },
      { data: newRow, error: null },
      { data: updatedOldRow, error: null },
    );

    await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    );

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'supersession.set',
        level: 'info',
        message: expect.stringContaining(OLD_ID),
        data: expect.objectContaining({
          oldId: OLD_ID,
          newId: NEW_ID,
          actorUserId: ACTOR_ID,
          oldTitle: oldRow.title,
          newTitle: newRow.title,
        }),
      }),
    );
  });

  it('does not emit a breadcrumb when validation fails', async () => {
    const { client } = makeMockClient(
      { data: null, error: null },
      { data: newRow, error: null },
      { data: null, error: null },
    );

    await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch(() => undefined);

    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });

  it('rejects self-supersession with SAME_ID without hitting the DB', async () => {
    const { client } = makeMockClient(
      { data: null, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    await expect(
      setSupersession(
        { oldId: OLD_ID, newId: OLD_ID, actorUserId: ACTOR_ID },
        client,
      ),
    ).rejects.toMatchObject({
      name: 'SupersessionError',
      code: 'SAME_ID',
    });

    expect(client.from).not.toHaveBeenCalled();
  });

  it('rejects with OLD_NOT_FOUND when oldId does not exist', async () => {
    const { client } = makeMockClient(
      { data: null, error: null },
      { data: newRow, error: null },
      { data: null, error: null },
    );

    const err = await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SupersessionError);
    expect((err as SupersessionError).code).toBe('OLD_NOT_FOUND');
  });

  it('rejects with NEW_NOT_FOUND when newId does not exist', async () => {
    const { client } = makeMockClient(
      { data: oldRow, error: null },
      { data: null, error: null },
      { data: null, error: null },
    );

    const err = await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SupersessionError);
    expect((err as SupersessionError).code).toBe('NEW_NOT_FOUND');
  });

  it('rejects with OLD_ALREADY_SUPERSEDED when old row already has a successor', async () => {
    const preSupersededOld = {
      ...oldRow,
      superseded_by: '99999999-9999-4999-8999-999999999999',
    };
    const { client } = makeMockClient(
      { data: preSupersededOld, error: null },
      { data: newRow, error: null },
      { data: null, error: null },
    );

    const err = await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SupersessionError);
    expect((err as SupersessionError).code).toBe('OLD_ALREADY_SUPERSEDED');
    expect((err as SupersessionError).context).toMatchObject({
      oldId: OLD_ID,
      existingSupersededBy: '99999999-9999-4999-8999-999999999999',
    });
  });

  it('rejects with NEW_ALREADY_SUPERSEDED when new row already has a successor (would form chain)', async () => {
    const preSupersededNew = {
      ...newRow,
      superseded_by: '88888888-8888-4888-8888-888888888888',
    };
    const { client } = makeMockClient(
      { data: oldRow, error: null },
      { data: preSupersededNew, error: null },
      { data: null, error: null },
    );

    const err = await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch((e) => e);

    expect(err).toBeInstanceOf(SupersessionError);
    expect((err as SupersessionError).code).toBe('NEW_ALREADY_SUPERSEDED');
  });

  it('propagates Supabase errors from the load queries', async () => {
    const { client } = makeMockClient(
      { data: null, error: { message: 'connection refused' } },
      { data: newRow, error: null },
      { data: null, error: null },
    );

    await expect(
      setSupersession(
        { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
        client,
      ),
    ).rejects.toMatchObject({
      name: 'SupabaseError',
    });
  });

  it('propagates Supabase errors from the update query', async () => {
    const { client } = makeMockClient(
      { data: oldRow, error: null },
      { data: newRow, error: null },
      { data: null, error: { message: 'write failed' } },
    );

    await expect(
      setSupersession(
        { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
        client,
      ),
    ).rejects.toMatchObject({
      name: 'SupabaseError',
    });
  });

  it('does not perform the UPDATE when any validation fails', async () => {
    const { client, updateChain } = makeMockClient(
      { data: null, error: null },
      { data: newRow, error: null },
      { data: null, error: null },
    );

    await setSupersession(
      { oldId: OLD_ID, newId: NEW_ID, actorUserId: ACTOR_ID },
      client,
    ).catch(() => undefined);

    // `updateChain` is only returned by the third .from() call; because the
    // validation fails earlier, we should never reach it.
    expect(updateChain.update).not.toHaveBeenCalled();
  });
});
