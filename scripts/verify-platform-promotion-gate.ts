#!/usr/bin/env bun
/**
 * ID-134 {134.6} — Platform promotion-confidence release gate.
 *
 * A re-runnable, READ-ONLY release gate that proves a Platform DB (prod
 * `zjqbrdctesqvouboziae` or staging `rbwqewalexrzgxtvcqrh`) carries a coherent
 * `kh_canonical_pipeline` run. Selects the latest such run, extracts its
 * `op_id`, and asserts G1–G7 filtered by that `op_id`. Entity tier (E) is
 * INFORMATIONAL — reported, never gated (owner ruling S438: promoted to a
 * hard gate once id-133 populates the register).
 *
 * **Harness** mirrors `scripts/seed-platform-workspaces.ts`: same
 * `--target=prod|staging` resolution + project-ref guard (`resolveTarget`),
 * `sb()`/`tryQuery()` from `@/lib/supabase/safe` (direct import, no barrel).
 * Unlike the seed scripts, this gate **only reads** — there is no
 * `--apply`/dry-run distinction because no write path exists. `parseCorpusArgs`
 * (below) is relocated in-file from the retired `scripts/seed-synthetic-corpus.ts`
 * (ID-145.25 — that script's mint-and-rekey machinery hard-failed post-{145.6}
 * M3; this was its only live dependency).
 *
 * **Run-select (the foundation).** Latest row from
 * `pipeline_runs WHERE pipeline_name='kh_canonical_pipeline' AND op_id IS NOT
 * NULL`, ordered by `coalesce(completed_at, ended_at, created_at)` DESC — NOT
 * bare `status='completed'` in the WHERE clause, because governance crons
 * emit empty `completed` heartbeats for *other* pipeline_names; scoping by
 * `pipeline_name` + non-null `op_id` is the correct filter, and G1 itself then
 * asserts the selected row's status. PostgREST has no computed-expression
 * `ORDER BY`, so the coalesce is evaluated client-side over the candidate
 * rows (see `selectLatestRun`).
 *
 * **G4 (HEADLINE) embedding home — already-realised reality, not a forward
 * note.** ID-131 `{131.11}` has LANDED on Platform prod: the inline
 * `content_chunks.embedding` column was dropped by migration
 * `supabase/migrations/20260706120000_id131_drop_inline_vector_cols.sql`
 * (verified: `ALTER TABLE content_chunks DROP COLUMN IF EXISTS "embedding"`).
 * The embedding now lives in `record_embeddings(owner_kind='content_chunk',
 * owner_id=content_chunks.id, embedding)` — that table was created by
 * migration `20260628190001_id131_record_embeddings_store.sql` (the
 * `(owner_kind, owner_id, model)` idiom; NO `op_id` column on
 * `record_embeddings`). Because `record_embeddings` carries no `op_id`, G4
 * joins via THIS RUN's `content_chunks.op_id`-scoped ids — see
 * `checkChunkEmbeddings` below. (Correction note vs the {134.6} dispatch
 * brief: the brief attributed the inline-column DROP itself to migration
 * `20260628190001` — that migration only CREATES `record_embeddings`; the
 * actual `DROP COLUMN` landed in the later `20260706120000` migration. Both
 * are cited above for precision.)
 *
 * **G2 empirical note — the `stage_counts.embedding` rollup is NOT reliably
 * exhaustive.** Live-probed against a real terminal run: `result.stage_counts
 * = { chunking: 8, embedding: 7, ... }` while the actual
 * `content_chunks` × `record_embeddings` join showed **8/8** chunks embedded.
 * The rollup counter under-reports (a retry/upsert-count artefact — cocoindex
 * increments in-flight, not idempotently against final state). G2 therefore
 * derives its `chunking`/`embedding` coherence numbers from the SAME live
 * `content_chunks`/`record_embeddings` counts G4 computes (the brief's
 * documented fallback: "if stage counts are not reliably present ... fall
 * back to deriving chunking/embedding from the content_chunks +
 * record_embeddings counts") — only `source_walk` (a lower-bound check, safe
 * even if the counter over-reports) is read from the `stage_counts` JSONB.
 *
 * Exit codes: `0` all of G1–G7 PASS; `1` any of G1–G7 FAIL, or the target
 * cannot be resolved/queried (a connectivity/credential blocker — this script
 * never fabricates a green run).
 *
 * Usage:
 *   bun run scripts/verify-platform-promotion-gate.ts --target=prod
 *   bun run scripts/verify-platform-promotion-gate.ts --target=staging
 *
 * Spec: specs/id-134-promotion-confidence-e2e/TECH.md §4.2 (G1–G7 + E table),
 * §4.2 "M5 follow-up" note, §2.2 (corpus row-delta contract, N_CONTENT=5
 * derivation).
 */
import { sb, tryQuery } from '@/lib/supabase/safe';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  resolveTarget,
  parseSeedArgs,
  PLATFORM_TARGETS,
  type ResolvedTarget,
  type EnvLike,
  type PlatformTarget,
} from '@/scripts/seed-platform-workspaces';

// ── Corpus-shape constants (PROMOTION_TECH §2.2) ────────────────────────────

/**
 * Content-side `source_documents` count: `content/synthetic-methodology.md`,
 * `content/synthetic-capability-statement.pdf`, `content/synthetic-sector-intel.docx`,
 * `qa/synthetic-qa-pairs.md`, `edge/synthetic-sparse-edge.md` — 3 in `content/`
 * (md + PDF + DOCX) + 1 `qa/` + 1 `edge/` = 5. The edge file mints a
 * `source_documents` row even though it yields no chunk-bearing content
 * (graceful-degradation fork, §2.2). Forms binaries (if still present,
 * BL-392 pending) are EXCLUDED — they write `form_templates`, not
 * `source_documents`.
 */
export const N_CONTENT = 5;

/**
 * Feed/URL slice size: 2 gov.uk feed articles (owner ruling S438
 * OQ-134-FEED-URL-DETERMINISM — a fixed canonical gov.uk URL, fixture-served,
 * deterministic; no live fetch inside this gate). Each contributes one
 * `source_documents` row + one `reference_items` row.
 */
export const N_FEED = 2;

/**
 * Lower bound for G2's `stage_counts.source_walk` — the walked content-side
 * file count (`N_CONTENT`). A lower bound (not exact-equality) because
 * `source_walk` also counts any still-present forms binaries pre-BL-392
 * (§2.1/§9 risk 6) and any transient walk retries.
 */
export const N_WALK = 5;

const PIPELINE_NAME = 'kh_canonical_pipeline';

// ── Types ────────────────────────────────────────────────────────────────────

/** The gate's own DB client type — the real, typed script client. */
type GateDbClient = ReturnType<typeof createScriptClient>;

/** The `pipeline_runs` projection the run-select query needs. */
interface CandidateRunRow {
  id: string;
  op_id: string | null;
  status: string;
  completed_at: string | null;
  ended_at: string | null;
  created_at: string;
  result: unknown;
  progress: unknown;
}

export type GateId = 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'E';

/** A hard (G1–G7) gate result — `pass` gates the run's exit code. */
export interface HardGateResult {
  readonly id: GateId;
  readonly label: string;
  readonly pass: boolean;
  readonly informational?: false;
  readonly detail: string;
}

/**
 * An informational (E) gate result — never gates the run's exit code.
 * `pass: true` is a literal type here (not just a convention): an
 * informational gate that "fails" is a contradiction in terms, so the
 * discriminated union makes constructing `{ informational: true, pass:
 * false, ... }` a compile error instead of a runtime-only invariant
 * (BL-416 — was previously comment-documented only: "For `E`, always
 * `true` — informational gates never fail the run").
 */
export interface InformationalGateResult {
  readonly id: GateId;
  readonly label: string;
  readonly pass: true;
  readonly informational: true;
  readonly detail: string;
}

export type GateResult = HardGateResult | InformationalGateResult;

// ── Pure helpers (DB-free — unit-testable) ──────────────────────────────────

/**
 * `coalesce(completed_at, ended_at, created_at)` for one candidate row, as an
 * epoch-ms number (parsed, not string-compared — fractional-second digit
 * counts differ across rows and are not safely lexicographically comparable).
 */
export function coalesceRunTimestampMs(
  row: Pick<CandidateRunRow, 'completed_at' | 'ended_at' | 'created_at'>,
): number {
  const iso = row.completed_at ?? row.ended_at ?? row.created_at;
  return new Date(iso).getTime();
}

/**
 * Select the latest candidate run by `coalesce(completed_at, ended_at,
 * created_at)` DESC (PROMOTION_TECH §4.2 run-select). Returns `null` when no
 * candidate rows exist. Does NOT filter by `status` — that is G1's job; the
 * selected row may legitimately be non-terminal (e.g. a currently in-flight
 * run with a later start timestamp than the last completed run), and G1
 * reports that as a FAIL rather than silently skipping it.
 */
export function selectLatestRun(
  rows: readonly CandidateRunRow[],
): CandidateRunRow | null {
  if (rows.length === 0) return null;
  let best = rows[0]!;
  let bestMs = coalesceRunTimestampMs(best);
  for (const row of rows.slice(1)) {
    const ms = coalesceRunTimestampMs(row);
    if (ms > bestMs) {
      best = row;
      bestMs = ms;
    }
  }
  return best;
}

/**
 * Read `result.stage_counts` (falling back to `progress.stage_counts`) off a
 * selected run row. Returns `{}` when neither JSONB column carries the key —
 * callers treat individual counter lookups as `undefined` in that case.
 */
export function extractStageCounts(
  run: Pick<CandidateRunRow, 'result' | 'progress'>,
): Record<string, unknown> {
  const fromResult = (run.result as Record<string, unknown> | null)
    ?.stage_counts;
  if (fromResult && typeof fromResult === 'object') {
    return fromResult as Record<string, unknown>;
  }
  const fromProgress = (run.progress as Record<string, unknown> | null)
    ?.stage_counts;
  if (fromProgress && typeof fromProgress === 'object') {
    return fromProgress as Record<string, unknown>;
  }
  return {};
}

function queryErrorGate(
  id: GateId,
  label: string,
  message: string,
): GateResult {
  return { id, label, pass: false, detail: `query error: ${message}` };
}

function skippedGate(id: GateId, label: string): GateResult {
  return {
    id,
    label,
    pass: false,
    detail: 'skipped — no run selected (see G1)',
  };
}

const LABELS: Record<GateId, string> = {
  G1: "run-selected row is terminal status='completed'",
  G2: 'stage coherence (source_walk lower-bound; chunking>0; embedding==chunking)',
  G3: `source_documents(op_id=run) == ${N_CONTENT}+N_FEED`,
  G4: 'HEADLINE: content_chunks(op_id=run) > 0 AND every chunk embedded via record_embeddings',
  G5: 'q_a_extractions(op_id=run) >= 1, all source_document_id NOT NULL',
  G6: `reference_items(op_id=run) == N_FEED (${N_FEED}), all source_document_id NOT NULL`,
  G7: 'connected only to a Platform DSN (prod or staging)',
  E: 'entity tier (informational — never gates; promoted to hard gate post-id-133)',
};

export function evaluateG1(run: CandidateRunRow | null): GateResult {
  if (!run) {
    return {
      id: 'G1',
      label: LABELS.G1,
      pass: false,
      detail: `no ${PIPELINE_NAME} row with a non-null op_id was found`,
    };
  }
  const pass = run.status === 'completed';
  return {
    id: 'G1',
    label: LABELS.G1,
    pass,
    detail: pass
      ? `run ${run.id} (op_id=${run.op_id}) status=completed, completed_at=${run.completed_at}`
      : `run ${run.id} (op_id=${run.op_id}) status=${run.status} (expected 'completed')`,
  };
}

export function evaluateG2(
  sourceWalk: number | undefined,
  chunkCount: number,
  embeddedCount: number,
  queryError: string | null,
): GateResult {
  if (queryError) return queryErrorGate('G2', LABELS.G2, queryError);
  const sourceWalkPass = typeof sourceWalk === 'number' && sourceWalk >= N_WALK;
  const chunkingPass = chunkCount > 0;
  const embeddingPass = embeddedCount === chunkCount;
  return {
    id: 'G2',
    label: LABELS.G2,
    pass: sourceWalkPass && chunkingPass && embeddingPass,
    detail:
      `source_walk=${sourceWalk ?? 'absent'} (>= ${N_WALK}? ${sourceWalkPass}); ` +
      `chunking=${chunkCount} (>0? ${chunkingPass}); ` +
      `embedded=${embeddedCount} (==chunking? ${embeddingPass})`,
  };
}

export function evaluateG3(
  sdCount: number | null,
  queryError: string | null,
): GateResult {
  if (queryError) return queryErrorGate('G3', LABELS.G3, queryError);
  const expected = N_CONTENT + N_FEED;
  const pass = sdCount === expected;
  return {
    id: 'G3',
    label: LABELS.G3,
    pass,
    detail: `source_documents(op_id=run) = ${sdCount}, expected ${expected}`,
  };
}

export function evaluateG4(
  chunkCount: number,
  embeddedCount: number,
  missingIds: readonly string[],
  queryError: string | null,
): GateResult {
  if (queryError) return queryErrorGate('G4', LABELS.G4, queryError);
  const pass = chunkCount > 0 && embeddedCount === chunkCount;
  const missingPreview =
    missingIds.length > 5
      ? `${missingIds.slice(0, 5).join(', ')} (+${missingIds.length - 5} more)`
      : missingIds.join(', ');
  return {
    id: 'G4',
    label: LABELS.G4,
    pass,
    detail: pass
      ? `${embeddedCount}/${chunkCount} content_chunks embedded via record_embeddings`
      : `${embeddedCount}/${chunkCount} embedded; missing for: ${missingPreview || '(none — chunkCount is 0)'}`,
  };
}

export function evaluateG5(
  rows: ReadonlyArray<{ source_document_id: string | null }> | null,
  queryError: string | null,
): GateResult {
  if (queryError) return queryErrorGate('G5', LABELS.G5, queryError);
  const list = rows ?? [];
  const nullCount = list.filter((r) => r.source_document_id == null).length;
  const pass = list.length >= 1 && nullCount === 0;
  return {
    id: 'G5',
    label: LABELS.G5,
    pass,
    detail: `q_a_extractions(op_id=run) = ${list.length}, null source_document_id = ${nullCount}`,
  };
}

export function evaluateG6(
  rows: ReadonlyArray<{ source_document_id: string | null }> | null,
  queryError: string | null,
): GateResult {
  if (queryError) return queryErrorGate('G6', LABELS.G6, queryError);
  const list = rows ?? [];
  const nullCount = list.filter((r) => r.source_document_id == null).length;
  const pass = list.length === N_FEED && nullCount === 0;
  return {
    id: 'G6',
    label: LABELS.G6,
    pass,
    detail: `reference_items(op_id=run) = ${list.length}, expected ${N_FEED}, null source_document_id = ${nullCount}`,
  };
}

export function evaluateG7(resolved: ResolvedTarget): GateResult {
  const knownRefs: readonly string[] = [
    PLATFORM_TARGETS.prod.projectRef,
    PLATFORM_TARGETS.staging.projectRef,
  ];
  const pass =
    knownRefs.includes(resolved.projectRef) &&
    resolved.url.includes(resolved.projectRef);
  return {
    id: 'G7',
    label: LABELS.G7,
    pass,
    detail: `target=${resolved.target}, projectRef=${resolved.projectRef}`,
  };
}

export function formatGateTable(results: readonly GateResult[]): string {
  return results
    .map((r) => {
      const tag = r.informational ? 'INFO' : r.pass ? 'PASS' : 'FAIL';
      return `[${tag}] ${r.id} — ${r.label}\n       ${r.detail}`;
    })
    .join('\n');
}

// ── DB-backed helpers ────────────────────────────────────────────────────────

interface ChunkEmbeddingCheck {
  readonly chunkCount: number;
  readonly embeddedCount: number;
  readonly missingIds: readonly string[];
  readonly queryError: string | null;
}

/**
 * The G4 HEADLINE check, shared with G2 (see file-header note on why G2 does
 * NOT trust `stage_counts.embedding`). For every `content_chunks` row scoped
 * to this run's `op_id`, assert a `record_embeddings` row exists with
 * `owner_kind='content_chunk'`, `owner_id=cc.id`, and a non-null `embedding`.
 * `record_embeddings` carries no `op_id` — the join key is THIS RUN's chunk
 * ids, resolved first.
 */
async function checkChunkEmbeddings(
  client: GateDbClient,
  opId: string,
): Promise<ChunkEmbeddingCheck> {
  const chunkResult = await tryQuery<Array<{ id: string }>>(
    client.from('content_chunks').select('id').eq('op_id', opId),
    'gate.content_chunks.byOpId',
  );
  if (!chunkResult.ok) {
    return {
      chunkCount: 0,
      embeddedCount: 0,
      missingIds: [],
      queryError: chunkResult.error.message,
    };
  }
  const chunkIds = chunkResult.data.map((r) => r.id);
  if (chunkIds.length === 0) {
    return {
      chunkCount: 0,
      embeddedCount: 0,
      missingIds: [],
      queryError: null,
    };
  }

  const embResult = await tryQuery<
    Array<{ owner_id: string; embedding: unknown }>
  >(
    client
      .from('record_embeddings')
      .select('owner_id, embedding')
      .eq('owner_kind', 'content_chunk')
      .in('owner_id', chunkIds),
    'gate.record_embeddings.byOwnerIds',
  );
  if (!embResult.ok) {
    return {
      chunkCount: chunkIds.length,
      embeddedCount: 0,
      missingIds: chunkIds,
      queryError: embResult.error.message,
    };
  }

  const embeddedIds = new Set(
    embResult.data.filter((r) => r.embedding !== null).map((r) => r.owner_id),
  );
  const missingIds = chunkIds.filter((id) => !embeddedIds.has(id));
  return {
    chunkCount: chunkIds.length,
    embeddedCount: embeddedIds.size,
    missingIds,
    queryError: null,
  };
}

interface EntityInformational {
  readonly entityMentionsCount: number;
  readonly entityRelationshipsCount: number;
  readonly queryError: string | null;
}

/**
 * E (informational — never fails). `entity_mentions` carries `op_id`;
 * `entity_relationships` does NOT (RULING 2) — joined via
 * `source_document_id ∈ this-run's source_documents`.
 */
async function checkEntityInformational(
  client: GateDbClient,
  opId: string,
  sourceDocumentIds: readonly string[],
): Promise<EntityInformational> {
  const { count: emCount, error: emErr } = await client
    .from('entity_mentions')
    .select('*', { count: 'exact', head: true })
    .eq('op_id', opId);
  if (emErr) {
    return {
      entityMentionsCount: 0,
      entityRelationshipsCount: 0,
      queryError: emErr.message,
    };
  }

  if (sourceDocumentIds.length === 0) {
    return {
      entityMentionsCount: emCount ?? 0,
      entityRelationshipsCount: 0,
      queryError: null,
    };
  }

  const { count: erCount, error: erErr } = await client
    .from('entity_relationships')
    .select('*', { count: 'exact', head: true })
    .in('source_document_id', sourceDocumentIds);
  if (erErr) {
    return {
      entityMentionsCount: emCount ?? 0,
      entityRelationshipsCount: 0,
      queryError: erErr.message,
    };
  }

  return {
    entityMentionsCount: emCount ?? 0,
    entityRelationshipsCount: erCount ?? 0,
    queryError: null,
  };
}

// ── Arg parsing ──────────────────────────────────────────────────────────────
//
// Relocated verbatim from the retired `scripts/seed-synthetic-corpus.ts`
// (ID-145.25 — gitnexus_impact confirmed this gate's `main()` was the only
// live caller outside that file). Kept as its full original shape (not
// trimmed to the `target`-only field this gate reads) so the CLI flag surface
// (`--clean`, `--emit-manifest`, `--manifest-out=`) stays byte-identical if
// ever reintroduced; only `target` is consumed below.

export interface CorpusArgs {
  readonly target: PlatformTarget;
  /** True unless `--apply` is given. Dry-run never writes. */
  readonly dryRun: boolean;
  /** Delete all `Synthetic — %` workspaces + cascade their questions. */
  readonly clean: boolean;
  /** Resolve the forms-route workspace uuid and emit the root manifest. */
  readonly emitManifest: boolean;
  /** Optional path to write the manifest to (else printed to stdout). */
  readonly manifestOut: string | null;
}

/**
 * Parse the CLI flags. Target selection is REQUIRED (reuses the shared
 * `parseSeedArgs` guard — `--target=prod|staging` or `SEED_PLATFORM_TARGET`).
 * Dry-run is the SAFE default unless `--apply` is given. Adds `--clean`,
 * `--emit-manifest`, and `--manifest-out=<path>`.
 */
export function parseCorpusArgs(
  argv: readonly string[],
  env: EnvLike = process.env,
): CorpusArgs {
  const base = parseSeedArgs(argv, env);
  const manifestFlag = argv.find((a) => a.startsWith('--manifest-out='));
  return {
    target: base.target,
    dryRun: base.dryRun,
    clean: argv.includes('--clean'),
    emitManifest: argv.includes('--emit-manifest'),
    manifestOut: manifestFlag
      ? manifestFlag.slice('--manifest-out='.length)
      : null,
  };
}

// ── CLI bootstrap ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  let resolved: ResolvedTarget;
  try {
    const args = parseCorpusArgs(process.argv.slice(2));
    resolved = resolveTarget(args.target, process.env);
  } catch (err) {
    console.error(
      `BLOCKED — cannot resolve a Platform target: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    `\n🔍 Platform promotion-confidence gate → ${resolved.target} (${resolved.projectRef})\n`,
  );

  const client = createScriptClient(resolved.url, resolved.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let candidateRows: CandidateRunRow[];
  try {
    candidateRows = await sb<CandidateRunRow[]>(
      client
        .from('pipeline_runs')
        .select(
          'id, op_id, status, completed_at, ended_at, created_at, result, progress',
        )
        .eq('pipeline_name', PIPELINE_NAME)
        .not('op_id', 'is', null),
      'gate.pipeline_runs.candidates',
    );
  } catch (err) {
    console.error(
      `BLOCKED — could not query pipeline_runs: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    process.exitCode = 1;
    return;
  }

  const run = selectLatestRun(candidateRows);
  const results: GateResult[] = [evaluateG1(run)];

  if (!run || !run.op_id) {
    results.push(skippedGate('G2', LABELS.G2));
    results.push(skippedGate('G3', LABELS.G3));
    results.push(skippedGate('G4', LABELS.G4));
    results.push(skippedGate('G5', LABELS.G5));
    results.push(skippedGate('G6', LABELS.G6));
    results.push(evaluateG7(resolved));
    console.log(formatGateTable(results));
    console.log(`\n❌ Exit 1 — no ${PIPELINE_NAME} run to gate.`);
    process.exitCode = 1;
    return;
  }

  const opId = run.op_id;
  const stageCounts = extractStageCounts(run);
  const sourceWalk =
    typeof stageCounts.source_walk === 'number'
      ? stageCounts.source_walk
      : undefined;

  const [sdResult, qaResult, riResult, chunkCheck] = await Promise.all([
    tryQuery<Array<{ id: string }>>(
      client.from('source_documents').select('id').eq('op_id', opId),
      'gate.source_documents.byOpId',
    ),
    tryQuery<Array<{ id: string; source_document_id: string | null }>>(
      client
        .from('q_a_extractions')
        .select('id, source_document_id')
        .eq('op_id', opId),
      'gate.q_a_extractions.byOpId',
    ),
    tryQuery<Array<{ id: string; source_document_id: string | null }>>(
      client
        .from('reference_items')
        .select('id, source_document_id')
        .eq('op_id', opId),
      'gate.reference_items.byOpId',
    ),
    checkChunkEmbeddings(client, opId),
  ]);

  const sdIds = sdResult.ok ? sdResult.data.map((r) => r.id) : [];
  const sdCount = sdResult.ok ? sdResult.data.length : null;

  results.push(
    evaluateG3(sdCount, sdResult.ok ? null : sdResult.error.message),
  );
  results.push(
    evaluateG2(
      sourceWalk,
      chunkCheck.chunkCount,
      chunkCheck.embeddedCount,
      chunkCheck.queryError,
    ),
  );
  results.push(
    evaluateG4(
      chunkCheck.chunkCount,
      chunkCheck.embeddedCount,
      chunkCheck.missingIds,
      chunkCheck.queryError,
    ),
  );
  results.push(
    evaluateG5(
      qaResult.ok ? qaResult.data : null,
      qaResult.ok ? null : qaResult.error.message,
    ),
  );
  results.push(
    evaluateG6(
      riResult.ok ? riResult.data : null,
      riResult.ok ? null : riResult.error.message,
    ),
  );
  results.push(evaluateG7(resolved));

  const entityInfo = await checkEntityInformational(client, opId, sdIds);
  results.push({
    id: 'E',
    label: LABELS.E,
    pass: true,
    informational: true,
    detail: entityInfo.queryError
      ? `query error: ${entityInfo.queryError}`
      : `entity_mentions(op_id=run)=${entityInfo.entityMentionsCount}, ` +
        `entity_relationships(joined via source_document_id)=${entityInfo.entityRelationshipsCount}`,
  });

  console.log(formatGateTable(results));

  const hardGates = results.filter((r) => !r.informational);
  const failed = hardGates.filter((r) => !r.pass);
  console.log(
    failed.length === 0
      ? `\n✅ All gates PASS (G1–G7). Exit 0.`
      : `\n❌ ${failed.length} gate(s) FAILED: ${failed.map((r) => r.id).join(', ')}. Exit 1.`,
  );
  process.exitCode = failed.length === 0 ? 0 : 1;
}

// Run only when invoked directly (never on import — a colocated test imports
// the pure helpers above without triggering a live DB connection).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('verify-platform-promotion-gate.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
