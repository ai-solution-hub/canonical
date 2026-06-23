/**
 * Unit tests for the dedup merge primitive
 * (`lib/q-a-pairs/dedup-merge.ts`, `mergeDedupPair`) — ID-120 {120.7} P-5.
 *
 * `mergeDedupPair` archives the NON-survivor of a curator-approved pair under
 * a CAS (`publication_status='published'`) and asserts affected-row = 1.
 *
 * Covers:
 *   - happy path: archive UPDATE carries publication_status='archived' AND
 *     superseded_by=<survivorId>, gated by the published CAS; affected-row=1
 *     → { ok: true }.
 *   - cross-workspace survivor: the survivor id is written verbatim as
 *     superseded_by regardless of which workspace it belongs to (INV-11).
 *   - CAS-0-row (loser no longer published) → { ok: false, cas_no_match };
 *     no thrown error, corpus-write attempted exactly once.
 *   - DB error on the UPDATE → { ok: false, db_error }.
 *   - self-merge guard: survivorId === nonSurvivorId → db_error, NO UPDATE.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseTable } from '../../helpers/mock-supabase';
import { mergeDedupPair } from '@/lib/q-a-pairs/dedup-merge';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

const SURVIVOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NON_SURVIVOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
// A survivor that belongs to a different workspace — superseded_by is written
// by VALUE with no workspace constraint (INV-11).
const CROSS_WS_SURVIVOR = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function clientFor(resolution: { data: unknown; error: unknown }) {
  const mock = createMockSupabaseTable(resolution as never);
  return {
    client: mock as unknown as SupabaseClient<Database>,
    chain: mock._chain,
  };
}

describe('mergeDedupPair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('archives the non-survivor with superseded_by under the published CAS (affected-row=1)', async () => {
    const { client, chain } = clientFor({
      data: [{ id: NON_SURVIVOR }],
      error: null,
    });

    const result = await mergeDedupPair(client, {
      survivorId: SURVIVOR,
      nonSurvivorId: NON_SURVIVOR,
    });

    expect(result).toEqual({ ok: true });

    // The UPDATE payload archives + stamps superseded_by together (INV-15).
    expect(chain.update).toHaveBeenCalledTimes(1);
    const payload = chain.update.mock.calls[0][0];
    expect(payload.publication_status).toBe('archived');
    expect(payload.superseded_by).toBe(SURVIVOR);

    // CAS: targets the non-survivor AND only a still-published row.
    expect(chain.eq).toHaveBeenCalledWith('id', NON_SURVIVOR);
    expect(chain.eq).toHaveBeenCalledWith('publication_status', 'published');
  });

  it('writes a cross-workspace survivor id verbatim as superseded_by (INV-11)', async () => {
    const { client, chain } = clientFor({
      data: [{ id: NON_SURVIVOR }],
      error: null,
    });

    const result = await mergeDedupPair(client, {
      survivorId: CROSS_WS_SURVIVOR,
      nonSurvivorId: NON_SURVIVOR,
    });

    expect(result).toEqual({ ok: true });
    const payload = chain.update.mock.calls[0][0];
    expect(payload.superseded_by).toBe(CROSS_WS_SURVIVOR);
  });

  it('returns cas_no_match when the CAS matches 0 rows (loser no longer published)', async () => {
    const { client, chain } = clientFor({ data: [], error: null });

    const result = await mergeDedupPair(client, {
      survivorId: SURVIVOR,
      nonSurvivorId: NON_SURVIVOR,
    });

    expect(result).toEqual({ ok: false, reason: 'cas_no_match' });
    // The corpus write was attempted exactly once — no retry, no throw.
    expect(chain.update).toHaveBeenCalledTimes(1);
  });

  it('returns db_error when the archive UPDATE errors', async () => {
    const { client } = clientFor({
      data: null,
      error: { message: 'boom', code: 'XXXXX' },
    });

    const result = await mergeDedupPair(client, {
      survivorId: SURVIVOR,
      nonSurvivorId: NON_SURVIVOR,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'db_error') {
      expect(result.message).toContain('boom');
    } else {
      throw new Error('expected db_error result');
    }
  });

  it('refuses a self-merge (survivor === non-survivor) without writing', async () => {
    const { client, chain } = clientFor({
      data: [{ id: NON_SURVIVOR }],
      error: null,
    });

    const result = await mergeDedupPair(client, {
      survivorId: SURVIVOR,
      nonSurvivorId: SURVIVOR,
    });

    expect(result.ok).toBe(false);
    expect(chain.update).not.toHaveBeenCalled();
  });
});
