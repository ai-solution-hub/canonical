/**
 * Seed + cleanup helpers for the §1.7 + §1.9 admin-dedup E2E fixture.
 *
 * These helpers are shared between two callers:
 *   - `e2e/fixtures/admin-dedup-fixture.ts` — Playwright worker-scoped fixture
 *     wrapping the helpers for `--workers=N` test runs.
 *   - `scripts/seed-admin-dedup-fixtures.ts` — one-shot CLI for WP2 manual
 *     seed/cleanup sessions.
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §1, §3, §5.
 * Decisions §9.1–§9.6 of that doc are LOCKED contracts.
 *
 * Caller is responsible for supplying a service-role `SupabaseClient` —
 * helpers do NOT instantiate the client (testability via mock injection).
 */
import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  buildPair,
  cosineSimilarity,
} from '@/e2e/fixtures/admin-dedup-vectors';
import { buildPairId } from '@/lib/dedup/pair-id';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Run identifier persisted to `metadata.e2e_dedup_fixture_run_id` on every
 * seeded row. Cleanup queries pivot off this tag — never use a LIKE prefix
 * sweep alone (see design §5.1 belt-and-braces).
 */
export type RunId = string;

/** §1.7 + §1.9 fixture data returned by `seedAdminDedupFixtures`. */
export interface AdminDedupFixtureData {
  /** The run-id used to tag every seeded row. Cleanup pivots on this. */
  runId: RunId;
  /** §1.7 queue pairs, keyed by purpose (mutating actions + filter tests). */
  queue: {
    confirmDuplicate: { subjectId: string; canonicalId: string };
    confirmUnique: { subjectId: string; canonicalId: string };
    supersedeA: { subjectId: string; canonicalId: string };
    supersedeB: { subjectId: string; canonicalId: string };
    domainAFilter: { subjectId: string; canonicalId: string };
    domainBFilter: { subjectId: string; canonicalId: string };
  };
  /** §1.9 near-dup pairs, keyed by similarity tier + purpose. */
  nearDup: {
    highSimDomainX: { leftId: string; rightId: string; pairId: string };
    midSimDomainX: { leftId: string; rightId: string; pairId: string };
    lowSimDomainX: { leftId: string; rightId: string; pairId: string };
    highSimDomainY: { leftId: string; rightId: string; pairId: string };
    overlapWith17: { leftId: string; rightId: string; pairId: string };
    mergeTarget: { leftId: string; rightId: string; pairId: string };
    confirmUnique: { leftId: string; rightId: string; pairId: string };
  };
  /** All seeded `content_items.id`s — convenient for ad-hoc cleanup. */
  allIds: string[];
}

/** Cleanup result counts (per-table). */
export interface CleanupCounts {
  deletedContentItems: number;
  deletedHistoryRows: number;
  deletedChunks: number;
}

/** Optional seed-time overrides. */
export interface SeedOptions {
  /** UUID written to `created_by`/`updated_by`/`content_owner_id`. Falls back to a known admin UUID looked up from `user_roles` if omitted. */
  actorUserId?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Title prefix appended to every seeded row.  Belt-and-braces tag — even if
 * the metadata is malformed, the existing `e2e/global-teardown.ts` LIKE sweep
 * (`[E2E-...`) still catches fixture rows. See design §5.1.
 */
const TITLE_PREFIX_BASE = '[E2E-DEDUP-';

/** §1.9 "domain X" — the dominant primary_domain for the near-dup test set. */
const DOMAIN_X = 'Service Delivery';
/** §1.9 "domain Y" — secondary primary_domain for the cross-domain filter test. */
const DOMAIN_Y = 'Technical Capability';

/**
 * Cosine similarity targets per design §1.2. Target tolerance is ±0.005 in
 * `verifySeededPairs` (slightly looser than the perturbVector ±0.001
 * guarantee to cover float drift through pgvector).
 */
const SIM_HIGH = 0.97;
const SIM_MID = 0.9;
const SIM_LOW = 0.86;

/** Tolerance the verifier accepts before raising. Loose enough to absorb pgvector roundtrip. */
const SIM_TOLERANCE = 0.005;

// ---------------------------------------------------------------------------
// Helpers — internal
// ---------------------------------------------------------------------------

/** Convert a number array to the JSON string Supabase RPC vector params expect. */
function vec(v: number[]): string {
  return JSON.stringify(v);
}

/** Build the `metadata` JSONB object stamped on every seeded row. */
function metadataFor(runId: RunId, slot: string): Record<string, unknown> {
  return {
    e2e_dedup_fixture_run_id: runId,
    e2e_dedup_fixture_slot: slot,
  };
}

/**
 * Best-effort lookup of an admin UUID for `created_by`. Required because
 * the FK `content_items.created_by → auth.users` rejects unknown values.
 */
async function resolveActorUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id')
    .eq('role', 'admin')
    .limit(1)
    .single();

  if (error || !data?.user_id) {
    throw new Error(
      `seedAdminDedupFixtures: no admin user found in user_roles. ` +
        `Run \`bun run seed:e2e-users\` to provision test users. ` +
        `Underlying error: ${error?.message ?? 'no rows returned'}`,
    );
  }

  return data.user_id as string;
}

/**
 * Minimal `content_items` insert payload — omits `content_text_hash`
 * (GENERATED ALWAYS — see CLAUDE.md gotcha) and lets DB defaults fill
 * `dedup_status`, `publication_status`, `starred`, `citation_count`.
 */
interface QueueRowPayload {
  slot: string;
  title: string;
  content: string;
  primaryDomain: string;
  dedupStatus: 'clean' | 'suspected_duplicate';
}

interface NearDupRowPayload {
  slot: string;
  title: string;
  content: string;
  primaryDomain: string;
  dedupStatus: 'clean' | 'suspected_duplicate';
  embedding: number[];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates a default timestamp-based run-id per design §9.2.
 *
 * Format: `s213b-{base36(epoch)}-{6hex}` for CI / programmatic use, or
 * `<prefix>-{base36(epoch)}-{6hex}` if a prefix is supplied.
 *
 * The 6-hex suffix uses `crypto.randomBytes` for collision resistance under
 * concurrent CI workers (multiple workers may call within the same
 * millisecond).
 */
export function generateRunId(prefix?: string): RunId {
  const root = prefix && prefix.length > 0 ? prefix : 's213b';
  const ts = Date.now().toString(36);
  const rand = randomBytes(3).toString('hex');
  return `${root}-${ts}-${rand}`;
}

/**
 * Seed the full §1.7 + §1.9 fixture set.
 *
 * Idempotent on the same `runId`: pre-sweeps any existing rows tagged with
 * the same run-id before inserting fresh.
 *
 * Caller MUST pass a service-role client (RLS bypass).
 */
export async function seedAdminDedupFixtures(
  supabase: SupabaseClient,
  runId: RunId,
  options?: SeedOptions,
): Promise<AdminDedupFixtureData> {
  // 1. Pre-sweep: idempotent re-seed against the same runId.
  await cleanupAdminDedupFixtures(supabase, runId);

  // 2. Resolve the actor UUID (FK constraint on created_by).
  const actorUserId =
    options?.actorUserId ?? (await resolveActorUserId(supabase));

  // 3. Build §1.7 queue payloads — 6 pairs (12 rows). Each pair shares
  //    `content` so `content_text_hash` (GENERATED ALWAYS, md5 of
  //    normalised content) collides between the canonical and subject row.
  const queueDefs: Array<{
    key: keyof AdminDedupFixtureData['queue'];
    slot: string;
    primaryDomain: string;
    contentSeed: string;
  }> = [
    {
      key: 'confirmDuplicate',
      slot: 'queue-confirm-duplicate',
      primaryDomain: DOMAIN_X,
      contentSeed:
        'Confirm-duplicate fixture — admin will mark this subject as a duplicate.',
    },
    {
      key: 'confirmUnique',
      slot: 'queue-confirm-unique',
      primaryDomain: DOMAIN_X,
      contentSeed:
        'Confirm-unique fixture — admin will mark this subject as unique.',
    },
    {
      key: 'supersedeA',
      slot: 'queue-supersede-a',
      primaryDomain: DOMAIN_X,
      contentSeed:
        'Supersede-A fixture — admin will keep the canonical and supersede the subject.',
    },
    {
      key: 'supersedeB',
      slot: 'queue-supersede-b',
      primaryDomain: DOMAIN_X,
      contentSeed:
        'Supersede-B fixture — admin will keep the subject and supersede the canonical.',
    },
    {
      key: 'domainAFilter',
      slot: 'queue-domain-a-filter',
      primaryDomain: DOMAIN_X,
      contentSeed:
        'Domain-A filter fixture — used by the queue domain dropdown filter test.',
    },
    {
      key: 'domainBFilter',
      slot: 'queue-domain-b-filter',
      primaryDomain: DOMAIN_Y,
      contentSeed:
        'Domain-B filter fixture — used by the queue domain dropdown filter test.',
    },
  ];

  const queuePayloads: QueueRowPayload[] = [];
  for (const def of queueDefs) {
    // Both canonical and subject share `content` so md5(normalised) collides.
    const sharedContent = `${def.contentSeed} run=${runId}`;
    queuePayloads.push({
      slot: `${def.slot}-canonical`,
      title: `${TITLE_PREFIX_BASE}${runId}] ${def.slot} canonical`,
      content: sharedContent,
      primaryDomain: def.primaryDomain,
      dedupStatus: 'clean',
    });
    queuePayloads.push({
      slot: `${def.slot}-subject`,
      title: `${TITLE_PREFIX_BASE}${runId}] ${def.slot} subject`,
      content: sharedContent,
      primaryDomain: def.primaryDomain,
      dedupStatus: 'suspected_duplicate',
    });
  }

  // 4. Build §1.9 near-dup payloads — 7 pairs (14 rows). Embedding is
  //    written inline per decision §9.5.
  const nearDupDefs: Array<{
    key: keyof AdminDedupFixtureData['nearDup'];
    slot: string;
    primaryDomain: string;
    targetSimilarity: number;
    leftStatus: 'clean' | 'suspected_duplicate';
    rightStatus: 'clean' | 'suspected_duplicate';
    contentSeed: string;
  }> = [
    {
      key: 'highSimDomainX',
      slot: 'near-dup-high-sim-x',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_HIGH,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed:
        'Near-dup high-sim X — visible at default + slider extremes.',
    },
    {
      key: 'midSimDomainX',
      slot: 'near-dup-mid-sim-x',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_MID,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed: 'Near-dup mid-sim X — visible at 0.85, hidden at 0.95.',
    },
    {
      key: 'lowSimDomainX',
      slot: 'near-dup-low-sim-x',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_LOW,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed: 'Near-dup low-sim X — visible only at slider floor (0.85).',
    },
    {
      key: 'highSimDomainY',
      slot: 'near-dup-high-sim-y',
      primaryDomain: DOMAIN_Y,
      targetSimilarity: SIM_HIGH,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed:
        'Near-dup high-sim Y — domain filter must hide this when X is selected.',
    },
    {
      key: 'overlapWith17',
      slot: 'near-dup-overlap-17',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_HIGH,
      leftStatus: 'clean',
      rightStatus: 'suspected_duplicate',
      contentSeed:
        'Near-dup overlap with §1.7 — list must exclude pairs where either side is suspected_duplicate.',
    },
    {
      key: 'mergeTarget',
      slot: 'near-dup-merge-target',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_HIGH,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed: 'Near-dup merge target — admin will merge this pair.',
    },
    {
      key: 'confirmUnique',
      slot: 'near-dup-confirm-unique',
      primaryDomain: DOMAIN_X,
      targetSimilarity: SIM_HIGH,
      leftStatus: 'clean',
      rightStatus: 'clean',
      contentSeed:
        'Near-dup confirm-unique — admin will mark both sides as confirmed_unique.',
    },
  ];

  const nearDupPayloads: NearDupRowPayload[] = [];
  // Map from (def.key) -> embeddings tuple, so we can look up after insert.
  const nearDupEmbeddingsByKey = new Map<
    keyof AdminDedupFixtureData['nearDup'],
    { leftEmbedding: number[]; rightEmbedding: number[] }
  >();

  for (const def of nearDupDefs) {
    const pairKey = `${runId}-${def.key}`;
    const [leftEmbedding, rightEmbedding] = buildPair(
      pairKey,
      def.targetSimilarity,
    );
    nearDupEmbeddingsByKey.set(def.key, { leftEmbedding, rightEmbedding });

    nearDupPayloads.push({
      slot: `${def.slot}-left`,
      title: `${TITLE_PREFIX_BASE}${runId}] ${def.slot} left`,
      content: `${def.contentSeed} (left, run=${runId})`,
      primaryDomain: def.primaryDomain,
      dedupStatus: def.leftStatus,
      embedding: leftEmbedding,
    });
    nearDupPayloads.push({
      slot: `${def.slot}-right`,
      title: `${TITLE_PREFIX_BASE}${runId}] ${def.slot} right`,
      content: `${def.contentSeed} (right, run=${runId})`,
      primaryDomain: def.primaryDomain,
      dedupStatus: def.rightStatus,
      embedding: rightEmbedding,
    });
  }

  // 5. Insert §1.7 queue rows (no embedding needed for the queue listing).
  const queueRows = queuePayloads.map((p) => ({
    title: p.title,
    content: p.content,
    content_type: 'article',
    dedup_status: p.dedupStatus,
    primary_domain: p.primaryDomain,
    ingest_source: 'manual',
    created_by: actorUserId,
    updated_by: actorUserId,
    content_owner_id: actorUserId,
    metadata: metadataFor(runId, p.slot),
  }));

  const { data: queueInserted, error: queueErr } = await supabase
    .from('content_items')
    .insert(queueRows)
    .select('id, metadata');

  if (queueErr || !queueInserted) {
    throw new Error(
      `seedAdminDedupFixtures: §1.7 queue insert failed — ${queueErr?.message ?? 'no rows returned'}`,
    );
  }

  // 6. Insert §1.9 near-dup rows with inline embedding (decision §9.5).
  const nearDupRows = nearDupPayloads.map((p) => ({
    title: p.title,
    content: p.content,
    content_type: 'article',
    dedup_status: p.dedupStatus,
    primary_domain: p.primaryDomain,
    ingest_source: 'manual',
    created_by: actorUserId,
    updated_by: actorUserId,
    content_owner_id: actorUserId,
    metadata: metadataFor(runId, p.slot),
    embedding: vec(p.embedding),
  }));

  const { data: nearDupInserted, error: nearDupErr } = await supabase
    .from('content_items')
    .insert(nearDupRows)
    .select('id, metadata');

  if (nearDupErr || !nearDupInserted) {
    throw new Error(
      `seedAdminDedupFixtures: §1.9 near-dup insert failed — ${nearDupErr?.message ?? 'no rows returned'}`,
    );
  }

  // 7. Build the slot-keyed lookup off the returned rows. Insert order is
  //    NOT guaranteed by Postgres, so we resolve via metadata.slot.
  const idBySlot = new Map<string, string>();
  for (const row of [...queueInserted, ...nearDupInserted]) {
    const meta = row.metadata as Record<string, unknown> | null;
    const slot = meta?.['e2e_dedup_fixture_slot'];
    if (typeof slot === 'string' && row.id) {
      idBySlot.set(slot, row.id as string);
    }
  }

  // 8. Helper for the queue lookup — both canonical + subject by def.slot.
  function queuePair(slotBase: string): {
    subjectId: string;
    canonicalId: string;
  } {
    const canonicalId = idBySlot.get(`${slotBase}-canonical`);
    const subjectId = idBySlot.get(`${slotBase}-subject`);
    if (!canonicalId || !subjectId) {
      throw new Error(
        `seedAdminDedupFixtures: failed to resolve queue pair for slot "${slotBase}" — ` +
          `inserted rows missing expected metadata.slot tags`,
      );
    }
    return { canonicalId, subjectId };
  }

  // 9. Helper for near-dup lookup — both sides by def.slot, plus pair-id.
  function nearDupPair(slotBase: string): {
    leftId: string;
    rightId: string;
    pairId: string;
  } {
    const leftId = idBySlot.get(`${slotBase}-left`);
    const rightId = idBySlot.get(`${slotBase}-right`);
    if (!leftId || !rightId) {
      throw new Error(
        `seedAdminDedupFixtures: failed to resolve near-dup pair for slot "${slotBase}" — ` +
          `inserted rows missing expected metadata.slot tags`,
      );
    }
    return { leftId, rightId, pairId: buildPairId(leftId, rightId) };
  }

  const data: AdminDedupFixtureData = {
    runId,
    queue: {
      confirmDuplicate: queuePair('queue-confirm-duplicate'),
      confirmUnique: queuePair('queue-confirm-unique'),
      supersedeA: queuePair('queue-supersede-a'),
      supersedeB: queuePair('queue-supersede-b'),
      domainAFilter: queuePair('queue-domain-a-filter'),
      domainBFilter: queuePair('queue-domain-b-filter'),
    },
    nearDup: {
      highSimDomainX: nearDupPair('near-dup-high-sim-x'),
      midSimDomainX: nearDupPair('near-dup-mid-sim-x'),
      lowSimDomainX: nearDupPair('near-dup-low-sim-x'),
      highSimDomainY: nearDupPair('near-dup-high-sim-y'),
      overlapWith17: nearDupPair('near-dup-overlap-17'),
      mergeTarget: nearDupPair('near-dup-merge-target'),
      confirmUnique: nearDupPair('near-dup-confirm-unique'),
    },
    allIds: Array.from(idBySlot.values()),
  };

  return data;
}

/**
 * Resolve fixture rows tagged with the given runId.
 *
 * Returns IDs without deleting — used by both the actual delete path and the
 * dry-run preview in the CLI.
 */
async function resolveFixtureIds(
  supabase: SupabaseClient,
  runId: RunId,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select('id')
    .eq('metadata->>e2e_dedup_fixture_run_id', runId);

  if (error) {
    throw new Error(
      `cleanupAdminDedupFixtures: lookup failed for run-id "${runId}" — ${error.message}`,
    );
  }

  return (data ?? []).map((r) => r.id as string);
}

/**
 * Delete all rows tagged with the given runId. FK-safe order:
 *   1. Clear `superseded_by` self-FK (cleared by merge actions).
 *   2. Delete `content_chunks` (none seeded but defensive).
 *   3. Delete `content_history` (auto_v1_on_insert trigger writes these).
 *   4. Delete `content_items`.
 *
 * Idempotent — safe to call when no rows match.
 */
export async function cleanupAdminDedupFixtures(
  supabase: SupabaseClient,
  runId: RunId,
): Promise<CleanupCounts> {
  const ids = await resolveFixtureIds(supabase, runId);
  if (ids.length === 0) {
    return { deletedContentItems: 0, deletedHistoryRows: 0, deletedChunks: 0 };
  }

  // 1. Clear self-FK (merge actions populate superseded_by; clear before delete).
  const { error: updateErr } = await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);
  if (updateErr) {
    throw new Error(
      `cleanupAdminDedupFixtures: failed to clear superseded_by FK — ${updateErr.message}`,
    );
  }

  // 2. Delete content_chunks (defensive — none seeded).
  const { data: chunkRows, error: chunkErr } = await supabase
    .from('content_chunks')
    .delete()
    .in('content_item_id', ids)
    .select('id');
  if (chunkErr) {
    throw new Error(
      `cleanupAdminDedupFixtures: failed to delete content_chunks — ${chunkErr.message}`,
    );
  }
  const deletedChunks = (chunkRows ?? []).length;

  // 3. Delete content_history (auto_v1_on_insert + any action-handler writes).
  const { data: historyRows, error: historyErr } = await supabase
    .from('content_history')
    .delete()
    .in('content_item_id', ids)
    .select('id');
  if (historyErr) {
    throw new Error(
      `cleanupAdminDedupFixtures: failed to delete content_history — ${historyErr.message}`,
    );
  }
  const deletedHistoryRows = (historyRows ?? []).length;

  // 4. Delete content_items.
  const { data: itemRows, error: itemErr } = await supabase
    .from('content_items')
    .delete()
    .in('id', ids)
    .select('id');
  if (itemErr) {
    throw new Error(
      `cleanupAdminDedupFixtures: failed to delete content_items — ${itemErr.message}`,
    );
  }
  const deletedContentItems = (itemRows ?? []).length;

  return { deletedContentItems, deletedHistoryRows, deletedChunks };
}

/**
 * Delete ALL rows tagged with any e2e_dedup_fixture_run_id, regardless of run.
 *
 * Use only when manually flushing fixture data — CLI requires interactive
 * confirmation or `--yes`. FK-safe order matches `cleanupAdminDedupFixtures`.
 */
export async function cleanupAllAdminDedupFixtures(
  supabase: SupabaseClient,
): Promise<CleanupCounts> {
  // Filter: rows where metadata has the run-id key (any value).
  const { data, error } = await supabase
    .from('content_items')
    .select('id')
    .not('metadata->e2e_dedup_fixture_run_id', 'is', null);

  if (error) {
    throw new Error(
      `cleanupAllAdminDedupFixtures: lookup failed — ${error.message}`,
    );
  }

  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return { deletedContentItems: 0, deletedHistoryRows: 0, deletedChunks: 0 };
  }

  // Same FK-safe sequence as cleanupAdminDedupFixtures.
  const { error: updateErr } = await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);
  if (updateErr) {
    throw new Error(
      `cleanupAllAdminDedupFixtures: failed to clear superseded_by FK — ${updateErr.message}`,
    );
  }

  const { data: chunkRows, error: chunkErr } = await supabase
    .from('content_chunks')
    .delete()
    .in('content_item_id', ids)
    .select('id');
  if (chunkErr) {
    throw new Error(
      `cleanupAllAdminDedupFixtures: failed to delete content_chunks — ${chunkErr.message}`,
    );
  }

  const { data: historyRows, error: historyErr } = await supabase
    .from('content_history')
    .delete()
    .in('content_item_id', ids)
    .select('id');
  if (historyErr) {
    throw new Error(
      `cleanupAllAdminDedupFixtures: failed to delete content_history — ${historyErr.message}`,
    );
  }

  const { data: itemRows, error: itemErr } = await supabase
    .from('content_items')
    .delete()
    .in('id', ids)
    .select('id');
  if (itemErr) {
    throw new Error(
      `cleanupAllAdminDedupFixtures: failed to delete content_items — ${itemErr.message}`,
    );
  }

  return {
    deletedContentItems: (itemRows ?? []).length,
    deletedHistoryRows: (historyRows ?? []).length,
    deletedChunks: (chunkRows ?? []).length,
  };
}

/**
 * Time-window orphan sweep — deletes fixture rows older than `olderThanHours`
 * across all run-ids. Pre-`globalSetup` safety net for crashed-worker leaks
 * per design §5.4.
 *
 * Returns count of deleted content_items only — child-table counts are not
 * surfaced here (this is a cleanup audit log, not a count-correctness gate).
 */
export async function sweepOrphanFixtures(
  supabase: SupabaseClient,
  olderThanHours: number,
): Promise<{ deletedContentItems: number }> {
  if (!Number.isFinite(olderThanHours) || olderThanHours <= 0) {
    throw new Error(
      `sweepOrphanFixtures: olderThanHours must be > 0, got ${olderThanHours}`,
    );
  }

  const cutoff = new Date(
    Date.now() - olderThanHours * 60 * 60 * 1000,
  ).toISOString();

  const { data, error } = await supabase
    .from('content_items')
    .select('id')
    .not('metadata->e2e_dedup_fixture_run_id', 'is', null)
    .lt('created_at', cutoff);

  if (error) {
    throw new Error(`sweepOrphanFixtures: lookup failed — ${error.message}`);
  }

  const ids = (data ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return { deletedContentItems: 0 };
  }

  // FK-safe order — but we don't surface the child counts.
  await supabase
    .from('content_items')
    .update({ superseded_by: null })
    .in('id', ids);
  await supabase.from('content_chunks').delete().in('content_item_id', ids);
  await supabase.from('content_history').delete().in('content_item_id', ids);
  const { data: itemRows, error: itemErr } = await supabase
    .from('content_items')
    .delete()
    .in('id', ids)
    .select('id');

  if (itemErr) {
    throw new Error(
      `sweepOrphanFixtures: failed to delete content_items — ${itemErr.message}`,
    );
  }

  return { deletedContentItems: (itemRows ?? []).length };
}

/**
 * Smoke-check that seeded near-dup pairs surface at the expected similarities
 * via `find_duplicate_pairs(0.85, NULL, 200)`. Throws on mismatch with a diff
 * summary so `globalSetup` fails fast on vector-math drift or schema drift.
 *
 * Tolerance: ±SIM_TOLERANCE (0.005) — slightly looser than the ±0.001
 * `perturbVector` math to absorb pgvector roundtrip float drift.
 */
export async function verifySeededPairs(
  supabase: SupabaseClient,
  fixture: AdminDedupFixtureData,
): Promise<void> {
  const { data, error } = await supabase.rpc('find_duplicate_pairs', {
    similarity_threshold: 0.85,
    p_domain: undefined,
    limit_count: 200,
  });

  if (error) {
    throw new Error(
      `verifySeededPairs: RPC find_duplicate_pairs failed — ${error.message}`,
    );
  }

  const pairs = (data ?? []) as Array<{
    id1: string;
    id2: string;
    similarity: number;
  }>;

  // Expected: every nearDup pair where both sides are 'clean' should surface.
  // The overlapWith17 pair has one suspected_duplicate side, but
  // find_duplicate_pairs RPC itself does not filter by dedup_status —
  // that's the route's job. So we expect ALL 7 pairs to surface here.
  const expectedPairs: Array<{
    key: string;
    leftId: string;
    rightId: string;
    expectedSimilarity: number;
  }> = [
    {
      key: 'highSimDomainX',
      ...fixture.nearDup.highSimDomainX,
      expectedSimilarity: SIM_HIGH,
    },
    {
      key: 'midSimDomainX',
      ...fixture.nearDup.midSimDomainX,
      expectedSimilarity: SIM_MID,
    },
    {
      key: 'lowSimDomainX',
      ...fixture.nearDup.lowSimDomainX,
      expectedSimilarity: SIM_LOW,
    },
    {
      key: 'highSimDomainY',
      ...fixture.nearDup.highSimDomainY,
      expectedSimilarity: SIM_HIGH,
    },
    {
      key: 'overlapWith17',
      ...fixture.nearDup.overlapWith17,
      expectedSimilarity: SIM_HIGH,
    },
    {
      key: 'mergeTarget',
      ...fixture.nearDup.mergeTarget,
      expectedSimilarity: SIM_HIGH,
    },
    {
      key: 'confirmUnique',
      ...fixture.nearDup.confirmUnique,
      expectedSimilarity: SIM_HIGH,
    },
  ];

  // Build a lookup keyed by smaller-id::larger-id (matches RPC ordering).
  const seen = new Map<string, number>();
  for (const p of pairs) {
    const a = p.id1 < p.id2 ? p.id1 : p.id2;
    const b = p.id1 < p.id2 ? p.id2 : p.id1;
    seen.set(`${a}::${b}`, p.similarity);
  }

  const failures: string[] = [];
  for (const exp of expectedPairs) {
    const a = exp.leftId < exp.rightId ? exp.leftId : exp.rightId;
    const b = exp.leftId < exp.rightId ? exp.rightId : exp.leftId;
    const actual = seen.get(`${a}::${b}`);
    if (actual === undefined) {
      failures.push(
        `${exp.key}: pair (${a}, ${b}) NOT found in find_duplicate_pairs result ` +
          `(expected sim ≈ ${exp.expectedSimilarity})`,
      );
      continue;
    }
    if (Math.abs(actual - exp.expectedSimilarity) > SIM_TOLERANCE) {
      failures.push(
        `${exp.key}: pair (${a}, ${b}) similarity ${actual.toFixed(4)} ` +
          `differs from expected ${exp.expectedSimilarity} by more than ±${SIM_TOLERANCE}`,
      );
    }
  }

  // Sanity check: also verify the local cosine math matches what we asked for.
  // (Catches buildPair regressions before they hit the DB roundtrip.)
  for (const exp of expectedPairs) {
    const pairKey = `${fixture.runId}-${exp.key}`;
    const [left, right] = buildPair(pairKey, exp.expectedSimilarity);
    const local = cosineSimilarity(left, right);
    if (Math.abs(local - exp.expectedSimilarity) > SIM_TOLERANCE) {
      failures.push(
        `${exp.key}: local cosine ${local.toFixed(4)} differs from target ` +
          `${exp.expectedSimilarity} (buildPair regression?)`,
      );
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `verifySeededPairs: ${failures.length} failure(s):\n` +
        failures.map((f) => `  - ${f}`).join('\n'),
    );
  }
}
