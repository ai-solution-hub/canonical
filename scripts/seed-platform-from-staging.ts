/**
 * Q2 SEED-DATA — staging "client" DB -> empty Platform DB canonical bootstrap.
 *
 * A THIN, direction-LOCKED wrapper over the existing {95.13} canonical-content
 * propagation worker (`scripts/propagate-canonical-content.ts`). It bootstraps
 * the empty Platform dev DB with the curated canonical baseline (taxonomy /
 * layer / application-type / form-type / form-requirement rows) sourced from the
 * only DB that currently holds curated canonical data — STAGING.
 *
 * It is the REVERSE direction of the worker's normal platform -> client fan-out:
 *   source = STAGING   (the client staging project)
 *   target = PLATFORM  (the canonical platform dev/CI project)
 *
 * WHY A WRAPPER AND NOT A RAW WORKER INVOCATION:
 *  - The DIRECTION is hard-locked here (source=staging, target=platform) so an
 *    operator running the seed cannot fat-finger source/target and accidentally
 *    write the staging client DB. The generic worker accepts arbitrary
 *    --source/--target; this wrapper does not.
 *  - It defaults to a SAFE dry-run: a live write requires an explicit `--apply`.
 *
 * WHAT IT DOES NOT DO (delegated entirely to the worker / contract — no logic
 * duplicated here):
 *  - The canonical-vs-client cut. That is the 7-table `PAYLOAD_CONTRACT`
 *    (`scripts/propagation/payload-contract.ts`), an ALLOW-LIST that excludes
 *    every client-provenance table by construction. The seed never carries
 *    client-private data into platform because those tables are simply not in
 *    the contract.
 *  - Per-table fetch / fkRemap / upsert / tombstone / version-ledger mechanics.
 *    Those are `propagateAllToTarget`. This wrapper imports it unchanged.
 *  - reference_items. The worker SKIP-LOUDs it (invariant 5: its NOT-NULL
 *    source_document_id FK points at the excluded client-provenance
 *    source_documents table). v1 seeds 6 of the 7 contract tables; the skip is
 *    intentional and unchanged here. reference_items lands when the platform
 *    gains its own ingestion pipeline (a separate ID-108 follow-up).
 *
 * SAFETY:
 *  - DRY-RUN BY DEFAULT. A live seed requires `--apply` AND --dry-run absent.
 *  - Fails LOUD if any required credential env is missing — never a partial run.
 *  - The worker never writes the source, so the seed cannot corrupt staging.
 *  - Idempotent: upsert-on-stableKey + tombstone-delete-absent converges on
 *    re-run; safe to re-seed after staging taxonomy edits.
 *
 * OPERATOR-GATED: the live run needs the staging + platform SERVICE-ROLE keys
 * (a session token cannot mint them). The seed reads them from env vars; it
 * never prints or logs the key values.
 *
 * Spec / design: Q2 seed-data design (staging->platform via {95.13} worker);
 * contract: scripts/propagation/payload-contract.ts.
 */
import {
  makeClient,
  propagateAllToTarget,
  type PropagationClient,
  type PropagationLogEvent,
  type TargetPropagationResult,
} from './propagate-canonical-content';

// ---------------------------------------------------------------------------
// Direction lock — the platform target ref is a fixed identity, not an operator
// input. The actual URL/key are read from env (below) so nothing secret is
// committed; the ref is the human-readable label for the platform project.
// ---------------------------------------------------------------------------

/** Platform project ref label used in logs / version-ledger provenance. */
export const PLATFORM_TARGET_REF = 'knowledge-hub-platform';

/** A resolved connection endpoint (url + service-role key). */
export interface SeedEndpoint {
  readonly url: string;
  readonly serviceRoleKey: string;
}

/** The fully-resolved, direction-locked seed configuration. */
export interface SeedConfig {
  /** Source = STAGING. The worker only ever READS this. */
  readonly source: SeedEndpoint;
  /** Target = PLATFORM. The worker upserts/tombstones here. */
  readonly target: SeedEndpoint & { readonly ref: string };
}

/**
 * Factory for a propagation client from a (url, key) pair. Defaults to the
 * worker's `makeClient`; injected in tests so no live connection is opened.
 */
export type SeedClientFactory = (
  url: string,
  serviceRoleKey: string,
) => PropagationClient;

export interface SeedArgs {
  /** True unless `--apply` is given AND `--dry-run` is absent. */
  readonly dryRun: boolean;
}

/**
 * Parse the wrapper's CLI flags. SAFE DEFAULT: dry-run unless an explicit
 * `--apply` is passed. `--dry-run` always wins over `--apply` so an ambiguous
 * invocation never performs a live write.
 */
export function parseSeedArgs(argv: readonly string[]): SeedArgs {
  const apply = argv.includes('--apply');
  const explicitDryRun = argv.includes('--dry-run');
  return { dryRun: explicitDryRun || !apply };
}

/** Loose env shape so callers (and tests) can pass partial envs. */
export type EnvLike = Record<string, string | undefined>;

function requireEnv(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Seed aborted: required credential env "${name}" is missing or empty. ` +
        'The staging->platform seed needs source (staging) AND target ' +
        '(platform) service-role connections; refusing to run a partial seed.',
    );
  }
  return value;
}

/**
 * Resolve the direction-LOCKED seed config from env vars. Fails LOUD if any of
 * the four required credential envs is missing.
 *
 * Source (STAGING, per .env.local):
 *  - NEXT_PUBLIC_SUPABASE_URL        — staging project URL
 *  - SUPABASE_SERVICE_ROLE_KEY       — staging service-role key
 *
 * Target (PLATFORM):
 *  - KH_PLATFORM_URL                 — platform project URL
 *  - KH_PLATFORM_SECRET_KEY          — platform service-role (secret) key
 *
 * The direction is fixed: source is always staging, target is always platform.
 * There is deliberately no flag to swap them.
 */
export function resolveSeedConfig(env: EnvLike): SeedConfig {
  return {
    source: {
      url: requireEnv(env, 'NEXT_PUBLIC_SUPABASE_URL'),
      serviceRoleKey: requireEnv(env, 'SUPABASE_SERVICE_ROLE_KEY'),
    },
    target: {
      ref: PLATFORM_TARGET_REF,
      url: requireEnv(env, 'KH_PLATFORM_URL'),
      serviceRoleKey: requireEnv(env, 'KH_PLATFORM_SECRET_KEY'),
    },
  };
}

export interface RunSeedInput {
  readonly config: SeedConfig;
  readonly dryRun: boolean;
  /** Client factory (injected in tests). Defaults to the worker's makeClient. */
  readonly clientFactory?: SeedClientFactory;
  /** Structured log sink (injected in tests). Defaults to console JSON lines. */
  readonly log?: (event: PropagationLogEvent) => void;
}

/**
 * Run the seed: build the direction-locked source + target clients, then
 * delegate the ENTIRE per-table propagation to the worker's
 * `propagateAllToTarget` over the full PAYLOAD_CONTRACT. No propagation logic is
 * implemented here.
 *
 * Client construction order is part of the lock: source (staging) is built
 * first, target (platform) second.
 */
export async function runSeed(
  input: RunSeedInput,
): Promise<TargetPropagationResult> {
  const factory = input.clientFactory ?? makeClient;
  const log = input.log ?? consoleLog;

  log({
    level: 'info',
    ref: input.config.target.ref,
    msg:
      `seed: staging -> platform (${input.config.target.ref})` +
      (input.dryRun ? ' [dry-run]' : ' [LIVE --apply]'),
  });

  // Lock order: source (staging) first, target (platform) second.
  const source = factory(
    input.config.source.url,
    input.config.source.serviceRoleKey,
  );
  const target = factory(
    input.config.target.url,
    input.config.target.serviceRoleKey,
  );

  return propagateAllToTarget(source, target, input.config.target.ref, {
    dryRun: input.dryRun,
    log,
  });
}

function consoleLog(event: PropagationLogEvent): void {
  const line = JSON.stringify(event);
  if (event.level === 'error') console.error(line);
  else if (event.level === 'warn') console.warn(line);
  else console.log(line);
}

// ---------------------------------------------------------------------------
// CLI bootstrap
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const config = resolveSeedConfig(process.env);
  const result = await runSeed({ config, dryRun: args.dryRun });

  if (!result.ok) {
    console.error(
      JSON.stringify({
        level: 'error',
        ref: result.ref,
        msg: `seed FAILED: ${result.error ?? 'unknown error'}`,
      }),
    );
    process.exitCode = 1;
    return;
  }

  const skipped = result.tables.filter((t) => t.skipped).map((t) => t.table);
  const planned = result.tables.filter((t) => !t.skipped).length;
  console.log(
    JSON.stringify({
      level: 'info',
      ref: result.ref,
      msg: args.dryRun
        ? `seed dry-run OK: ${planned} table(s) planned, skipped=[${skipped.join(',')}]`
        : `seed LIVE OK: ${planned} table(s) seeded, skipped=[${skipped.join(',')}]`,
    }),
  );
}

// Run only when invoked directly (never on import — tests import the functions).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('seed-platform-from-staging.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
