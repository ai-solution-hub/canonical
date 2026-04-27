/**
 * §5.2 Phase 1g (T4) — enforce_archive_state_consistency trigger integration test.
 *
 * Verifies all four directions of the bidirectional trigger added by
 * `20260427141627_publication_status_indexes_and_trigger.sql`. Per spec
 * §6.6, the trigger keeps the invariant
 *   `publication_status='archived' ↔ archived_at IS NOT NULL`
 * synchronised across both columns regardless of which side an UPDATE
 * touches:
 *
 *   Direction 1: `publication_status='archived'` set → trigger sets
 *                `archived_at = NOW()` if it was NULL. (AC1.10)
 *   Direction 2: `publication_status` moves AWAY from `'archived'` →
 *                trigger clears `archived_at` to NULL. (Implicit AC.)
 *   Direction 3: `archived_at` set non-NULL by legacy path WITHOUT
 *                touching `publication_status` → trigger flips
 *                `publication_status` to `'archived'`. (AC1.11)
 *   Direction 4: `archived_at` cleared while
 *                `publication_status='archived'` → trigger emits NOTICE
 *                and leaves `publication_status='archived'` unchanged
 *                (defensive; better stale-hidden than stale-visible).
 *                (AC1.12)
 *
 * Plus AC6.4: direct service-role UPDATE bypassing the app layer still
 * goes through the trigger (the entire test suite is service-role and
 * implicitly covers AC6.4 by construction).
 *
 * Spec: docs/specs/publication-lifecycle-state-machine-spec.md §6.6.
 * Plan: docs/plans/§5.2-phase-1-2-2.5-plan.md T4.
 *
 * Prerequisites:
 *   - `.env` with NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 *   - Migration `20260427141627_publication_status_indexes_and_trigger.sql`
 *     applied (verified via `supabase migration list`).
 *
 * Run via: `bun run test:integration -- publication-status-trigger`
 *   (requires dangerouslyDisableSandbox: true — see CLAUDE.md
 *   feedback_test_runners_split).
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { serviceClient } from './helpers/service-client';

const TEST_PREFIX = `[PUB-STATUS-TRIGGER-${Date.now()}]`;

// Track every row this suite seeds so afterAll can scrub them even if
// individual tests fail. The trigger does NOT cascade through
// content_history; v1-history rows are emitted by a separate
// AFTER INSERT trigger and need separate cleanup.
const seededIds: string[] = [];

async function seedItem(label: string): Promise<string> {
  // The DEFAULT 'published' applied by T3 means we do not need to set
  // publication_status explicitly — leaving it omitted exercises the
  // DEFAULT path (AC1.3 cross-check).
  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${label}`,
      content: `Trigger test fixture: ${label}. Disposable.`,
      content_type: 'article',
    })
    .select('id, publication_status, archived_at')
    .single();

  if (error || !data) {
    throw new Error(
      `Seed item "${label}" failed: ${error?.message ?? 'no data'}`,
    );
  }

  // Sanity: every seeded row should land as 'published' by default and
  // archived_at NULL — the trigger only fires on UPDATE, so INSERT
  // produces a clean baseline regardless of what we test next.
  if (data.publication_status !== 'published' || data.archived_at !== null) {
    throw new Error(
      `Seed item "${label}" baseline drift: publication_status=${data.publication_status} archived_at=${data.archived_at}`,
    );
  }

  seededIds.push(data.id);
  return data.id;
}

beforeAll(async () => {
  // No-op pre-flight; per-test seed isolates fixtures so a failure in
  // one direction does not poison the others.
}, 5_000);

afterAll(async () => {
  if (seededIds.length === 0) return;

  // content_history rows are emitted by an AFTER INSERT trigger
  // (`trg_content_items_ensure_v1_history`). Delete those before the
  // parent rows so the FK to content_items does not block.
  await serviceClient
    .from('content_history')
    .delete()
    .in('content_item_id', seededIds);

  await serviceClient.from('content_items').delete().in('id', seededIds);
}, 30_000);

describe('enforce_archive_state_consistency trigger — Direction 1 (AC1.10)', () => {
  it('UPDATE setting publication_status=archived sets archived_at=NOW() when archived_at was NULL', async () => {
    const id = await seedItem('D1-archive-via-publication-status');

    const before = Date.now();
    const { error } = await serviceClient
      .from('content_items')
      .update({ publication_status: 'archived' })
      .eq('id', id);

    expect(error).toBeNull();

    const { data, error: readErr } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    expect(readErr).toBeNull();
    expect(data?.publication_status).toBe('archived');
    expect(data?.archived_at).not.toBeNull();
    // archived_at should fall within the request window (within ~10s of
    // the call). Pgvector regions can lag a little; allow generous bound.
    const archivedTs = new Date(data!.archived_at as string).getTime();
    expect(archivedTs).toBeGreaterThanOrEqual(before - 5_000);
    expect(archivedTs).toBeLessThanOrEqual(Date.now() + 5_000);
  });

  it('Direction 1 does NOT overwrite archived_at when caller supplies it explicitly', async () => {
    // If the caller writes both publication_status='archived' AND a specific
    // archived_at, the trigger should leave archived_at as-is (the IF
    // branch only fires when archived_at IS NULL).
    const id = await seedItem('D1-archive-with-explicit-timestamp');
    const explicitTs = '2025-01-15T12:00:00.000Z';

    const { error } = await serviceClient
      .from('content_items')
      .update({
        publication_status: 'archived',
        archived_at: explicitTs,
      })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('archived_at')
      .eq('id', id)
      .single();

    expect(new Date(data!.archived_at as string).toISOString()).toBe(
      explicitTs,
    );
  });
});

describe('enforce_archive_state_consistency trigger — Direction 2', () => {
  it('UPDATE moving publication_status AWAY from archived clears archived_at', async () => {
    // Seed → archive (Direction 1 implicitly tested) → un-archive →
    // assert archived_at went back to NULL.
    const id = await seedItem('D2-unarchive');

    // Step 1: archive (uses Direction 1 to set archived_at).
    {
      const { error } = await serviceClient
        .from('content_items')
        .update({ publication_status: 'archived' })
        .eq('id', id);
      expect(error).toBeNull();
    }

    // Step 2: move publication_status back to 'published'. Direction 2
    // should clear archived_at.
    {
      const { error } = await serviceClient
        .from('content_items')
        .update({ publication_status: 'published' })
        .eq('id', id);
      expect(error).toBeNull();
    }

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    expect(data?.publication_status).toBe('published');
    expect(data?.archived_at).toBeNull();
  });
});

describe('enforce_archive_state_consistency trigger — Direction 3 (AC1.11)', () => {
  it('UPDATE setting archived_at to NOW() without touching publication_status flips publication_status to archived', async () => {
    // This emulates the legacy archive routes
    // (app/api/items/[id]/archive/route.ts, etc.) that today write
    // archived_at directly. The trigger is the safety net per spec §6.6
    // until those write sites are rewired in Phase 5.
    const id = await seedItem('D3-legacy-archive-path');
    const explicitTs = '2026-04-27T15:00:00.000Z';

    const { error } = await serviceClient
      .from('content_items')
      .update({ archived_at: explicitTs })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    // Trigger must have flipped publication_status even though the
    // UPDATE only touched archived_at.
    expect(data?.publication_status).toBe('archived');
    expect(new Date(data!.archived_at as string).toISOString()).toBe(
      explicitTs,
    );
  });

  it('Direction 3 fires when archived_at changes from one non-NULL timestamp to another', async () => {
    // Edge case from the spec WHERE clause:
    //   (OLD.archived_at IS NULL OR OLD.archived_at IS DISTINCT FROM NEW.archived_at)
    // means a re-archive (already archived, but archived_at moves) should
    // still keep publication_status='archived'. We can't easily test the
    // counterfactual where publication_status was somehow not 'archived'
    // beforehand — but verify the obvious case: row already archived,
    // updating archived_at leaves the state stable.
    const id = await seedItem('D3-re-archive-timestamp-change');

    // Initial archive via Direction 1.
    await serviceClient
      .from('content_items')
      .update({ publication_status: 'archived' })
      .eq('id', id);

    // Re-archive with a different timestamp (legacy code that updates
    // the archive timestamp without touching publication_status).
    const newTs = '2026-04-27T16:30:00.000Z';
    const { error } = await serviceClient
      .from('content_items')
      .update({ archived_at: newTs })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    expect(data?.publication_status).toBe('archived');
    expect(new Date(data!.archived_at as string).toISOString()).toBe(newTs);
  });
});

describe('enforce_archive_state_consistency trigger — Direction 4 (AC1.12)', () => {
  it('UPDATE clearing archived_at while publication_status=archived leaves publication_status archived (defensive)', async () => {
    // This is the defensive fall-through: legacy un-archive paths that
    // null out archived_at without restoring publication_status must
    // NOT leave the row stale-visible. Spec §6.6 chooses stale-hidden —
    // leave publication_status='archived'.
    //
    // IMPLEMENTATION NOTE — interaction between Directions 1 and 4 in
    // BEFORE UPDATE order:
    //   Direction 1's predicate is
    //     NEW.publication_status='archived' AND NEW.archived_at IS NULL
    //   which exactly matches the input to Direction 4's scenario.
    //   Direction 1 runs FIRST, repopulates NEW.archived_at = NOW(), so
    //   by the time Direction 4's IF is evaluated NEW.archived_at is no
    //   longer NULL. Net effect: archived_at gets RE-POPULATED with a
    //   fresh NOW() AND publication_status stays 'archived'. The
    //   structural goal (no stale-visible rows) is preserved either way:
    //   the item remains hidden because publication_status='archived'.
    //
    // The NOTICE branch in Direction 4 is therefore unreachable for a
    // single-statement UPDATE (the only way to hit it would be a multi-
    // statement transaction that nulls archived_at then runs another
    // statement clearing it again — out of scope for this trigger).
    const id = await seedItem('D4-clear-archived-at-defensive');

    // Step 1: archive normally (Direction 1).
    await serviceClient
      .from('content_items')
      .update({ publication_status: 'archived' })
      .eq('id', id);

    // Step 2: clear archived_at WITHOUT touching publication_status.
    // Direction 1 re-fires (predicate matches), repopulating archived_at.
    const { error } = await serviceClient
      .from('content_items')
      .update({ archived_at: null })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    // Defensive invariant: still archived (caller MUST set
    // publication_status explicitly when un-archiving). archived_at is
    // repopulated by Direction 1, which is acceptable: the goal is
    // hidden, not a specific timestamp.
    expect(data?.publication_status).toBe('archived');
    expect(data?.archived_at).not.toBeNull();
  });

  it('Explicit caller fix: setting publication_status=published AND archived_at=null in the same UPDATE works', async () => {
    // The "correct" un-archive path: the caller updates both fields
    // atomically. Direction 2 fires (clears archived_at — already NULL)
    // and Direction 4 does NOT fire (NEW.publication_status is no
    // longer 'archived' so the IF predicate is false). Net result is
    // the row reaches 'published' with archived_at NULL.
    const id = await seedItem('D4-explicit-correct-unarchive');

    // Archive first.
    await serviceClient
      .from('content_items')
      .update({ publication_status: 'archived' })
      .eq('id', id);

    // Atomic correct un-archive.
    const { error } = await serviceClient
      .from('content_items')
      .update({
        publication_status: 'published',
        archived_at: null,
      })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    expect(data?.publication_status).toBe('published');
    expect(data?.archived_at).toBeNull();
  });
});

describe('enforce_archive_state_consistency trigger — invariant under combined writes', () => {
  it('Setting publication_status=archived AND archived_at=null in the same UPDATE produces archived row with NEW timestamp', async () => {
    // Direction 1 fires: NEW.publication_status='archived' AND
    // NEW.archived_at IS NULL (the caller explicitly nulled it) → trigger
    // sets archived_at = NOW(). Trigger wins over caller's NULL because
    // BEFORE UPDATE triggers run before the row is written.
    const id = await seedItem('combined-archive-with-null-archived-at');

    const before = Date.now();
    const { error } = await serviceClient
      .from('content_items')
      .update({
        publication_status: 'archived',
        archived_at: null,
      })
      .eq('id', id);

    expect(error).toBeNull();

    const { data } = await serviceClient
      .from('content_items')
      .select('publication_status, archived_at')
      .eq('id', id)
      .single();

    expect(data?.publication_status).toBe('archived');
    expect(data?.archived_at).not.toBeNull();
    const archivedTs = new Date(data!.archived_at as string).getTime();
    expect(archivedTs).toBeGreaterThanOrEqual(before - 5_000);
  });
});
