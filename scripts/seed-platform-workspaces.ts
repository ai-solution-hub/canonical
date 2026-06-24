#!/usr/bin/env bun
/**
 * ID-127.2 (BI-8) — seed the six canonical Platform workspaces.
 *
 * Inserts ONE `workspaces` row per baseline `application_type`
 * (`procurement`, `intelligence`, `sales_proposal`, `product_guide`,
 * `competitor_research`, `training_onboarding`) into a Platform Supabase DB.
 * Every row binds to its `application_type` by the stable cross-DB `key`
 * (NOT a uuid, which differs per DB) and is stamped with the pipeline
 * service-account `created_by` for provenance.
 *
 * **Target-parameterised (ID-127 S408 amendment).** The Platform topology is
 * now TWO DBs — prod (`zjqbrdctesqvouboziae`) and the persistent staging
 * branch (`rbwqewalexrzgxtvcqrh`). This script runs against EITHER via the
 * `--target=prod|staging` flag (or `SEED_PLATFORM_TARGET` env); each target
 * resolves its own URL + service-role key env pair. There is deliberately no
 * "both at once" mode — the operator runs the seed once per DB so a credential
 * fat-finger cannot cross DBs. The resolved URL is asserted to contain the
 * expected project ref for the chosen target before any write.
 *
 * **Prerequisite (verified — TECH BI-8):** the six `application_types` rows are
 * seeded into the Platform DB by `seed-platform-from-staging.ts`
 * (`application_types` is in `PAYLOAD_CONTRACT`). This script ASSERTS their
 * presence and FAILS LOUD if any is missing — it never creates an
 * `application_type` (that is canonical-baseline territory, not seed territory).
 *
 * **Idempotency:** `workspaces.name` carries no unique constraint, so re-seed
 * convergence is a lookup-by-name-then-insert (the seed-e2e-users pattern), not
 * an `upsert(onConflict)`. A re-run finds the existing row by its stable
 * `name` and leaves it untouched (no duplicate, no clobber of mutable columns).
 *
 * **Safety:** dry-run by default; a live write requires `--apply`. Fails loud
 * if any required credential env is missing — never a partial run. Reads/writes
 * go through `sb()` from `@/lib/supabase/safe`.
 *
 * Usage:
 *   bun run scripts/seed-platform-workspaces.ts --target=staging            # dry-run
 *   bun run scripts/seed-platform-workspaces.ts --target=prod --apply       # live
 *
 * Spec: specs/id-127-platform-pipeline/TECH.md §BI-8 + AMENDMENT-staging-prod-two-server.md.
 */
import { sb, type PostgrestLike } from '@/lib/supabase/safe';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';

// ── Constants ───────────────────────────────────────────────────────────────

/**
 * Pipeline service-account UUID — infrastructure, not a person. Stamped as
 * `created_by` for provenance. See
 * `supabase/migrations/20260406180000_create_pipeline_service_account.sql`.
 */
export const PIPELINE_SYSTEM_USER_ID = 'a0000000-0000-4000-8000-000000000001';

/**
 * The six baseline application_type keys (TECH BI-8). One Platform workspace is
 * seeded per key; `name` is the stable idempotency key. Order is the canonical
 * baseline order — the procurement workspace is the >=1 forms workspace the
 * BI-7 manifest references.
 */
export const PLATFORM_WORKSPACE_SEEDS: ReadonlyArray<{
  readonly applicationTypeKey: string;
  readonly name: string;
}> = [
  { applicationTypeKey: 'procurement', name: 'Platform — Procurement' },
  { applicationTypeKey: 'intelligence', name: 'Platform — Intelligence' },
  { applicationTypeKey: 'sales_proposal', name: 'Platform — Sales Proposals' },
  { applicationTypeKey: 'product_guide', name: 'Platform — Product Guide' },
  {
    applicationTypeKey: 'competitor_research',
    name: 'Platform — Competitor Research',
  },
  {
    applicationTypeKey: 'training_onboarding',
    name: 'Platform — Training & Onboarding',
  },
];

/**
 * The two Platform targets and the env-var pair + project-ref guard for each.
 * The ref guard asserts the resolved URL belongs to the intended DB so a
 * misconfigured env cannot silently write the wrong Platform DB.
 */
export const PLATFORM_TARGETS = {
  prod: {
    projectRef: 'zjqbrdctesqvouboziae',
    urlEnv: 'PLATFORM_PROD_URL',
    keyEnv: 'PLATFORM_PROD_SERVICE_ROLE_KEY',
  },
  staging: {
    projectRef: 'rbwqewalexrzgxtvcqrh',
    urlEnv: 'PLATFORM_STAGING_URL',
    keyEnv: 'PLATFORM_STAGING_SERVICE_ROLE_KEY',
  },
} as const;

export type PlatformTarget = keyof typeof PLATFORM_TARGETS;

// ── Types ───────────────────────────────────────────────────────────────────

/** Loose env shape so callers (and tests) can pass partial envs. */
export type EnvLike = Record<string, string | undefined>;

/**
 * A filter builder that is itself awaitable (resolves to a Postgrest response)
 * AND chainable via `.eq()` / `.in()` / `.maybeSingle()`. Mirrors the subset of
 * the Supabase builder the seed uses; resolving to `PostgrestLike<unknown>` lets
 * each `sb()` call narrow the row type at the call site while keeping the
 * interface small enough for a unit-test double to satisfy.
 */
export interface SeedFilterBuilder extends PostgrestLike<unknown> {
  eq: (column: string, value: unknown) => SeedFilterBuilder;
  in: (column: string, values: readonly unknown[]) => SeedFilterBuilder;
  maybeSingle: () => PostgrestLike<unknown>;
}

/** Minimal client surface the seed needs (the script client, narrowed for tests). */
export interface SeedDbClient {
  from(table: string): {
    select: (columns?: string) => SeedFilterBuilder;
    insert: (values: unknown) => {
      select: (columns?: string) => {
        single: () => PostgrestLike<unknown>;
      };
    };
  };
}

export interface SeedArgs {
  readonly target: PlatformTarget;
  /** True unless `--apply` is given. Dry-run never writes. */
  readonly dryRun: boolean;
}

export interface ResolvedTarget {
  readonly target: PlatformTarget;
  readonly url: string;
  readonly serviceRoleKey: string;
  readonly projectRef: string;
}

export type WorkspaceSeedAction = 'created' | 'already-exists' | 'would-create';

export interface WorkspaceSeedResult {
  readonly applicationTypeKey: string;
  readonly name: string;
  readonly id: string | null;
  readonly action: WorkspaceSeedAction;
}

// ── Arg + env resolution ────────────────────────────────────────────────────

/**
 * Parse the CLI flags. Target selection is REQUIRED (`--target=prod|staging`
 * or `SEED_PLATFORM_TARGET`); there is no default — the operator must name the
 * Platform DB explicitly. Dry-run is the SAFE default unless `--apply` is given.
 */
export function parseSeedArgs(
  argv: readonly string[],
  env: EnvLike = process.env,
): SeedArgs {
  const flag = argv.find((a) => a.startsWith('--target='));
  const rawTarget = flag
    ? flag.slice('--target='.length)
    : env.SEED_PLATFORM_TARGET;
  if (rawTarget !== 'prod' && rawTarget !== 'staging') {
    throw new Error(
      'Seed aborted: a Platform target is required. Pass --target=prod or ' +
        '--target=staging (or set SEED_PLATFORM_TARGET). Refusing to guess ' +
        'which Platform DB to write.',
    );
  }
  return { target: rawTarget, dryRun: !argv.includes('--apply') };
}

function requireEnv(env: EnvLike, name: string): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(
      `Seed aborted: required credential env "${name}" is missing or empty. ` +
        'Refusing to run a partial seed.',
    );
  }
  return value;
}

/**
 * Resolve the URL + service-role key for the chosen Platform target and assert
 * the URL belongs to the expected project ref. Fails loud if either env is
 * missing, or if the URL does not contain the expected ref (a misconfiguration
 * guard against writing the wrong Platform DB).
 */
export function resolveTarget(
  target: PlatformTarget,
  env: EnvLike,
): ResolvedTarget {
  const spec = PLATFORM_TARGETS[target];
  const url = requireEnv(env, spec.urlEnv);
  const serviceRoleKey = requireEnv(env, spec.keyEnv);
  if (!url.includes(spec.projectRef)) {
    throw new Error(
      `Seed aborted: ${spec.urlEnv} ("${url}") does not contain the expected ` +
        `${target} Platform project ref "${spec.projectRef}". Refusing to ` +
        'write — this guards against pointing the seed at the wrong DB.',
    );
  }
  return { target, url, serviceRoleKey, projectRef: spec.projectRef };
}

// ── Core seed logic (client-injected, testable) ─────────────────────────────

/**
 * Assert the six baseline `application_types` rows exist on the target DB and
 * return a `key -> id` map. FAILS LOUD if any key is missing — the seed never
 * creates an application_type (canonical-baseline territory).
 */
export async function assertApplicationTypes(
  client: SeedDbClient,
): Promise<Map<string, string>> {
  const keys = PLATFORM_WORKSPACE_SEEDS.map((s) => s.applicationTypeKey);
  const rows = await sb<Array<{ id: string; key: string }>>(
    client
      .from('application_types')
      .select('id, key')
      .in('key', keys) as PostgrestLike<Array<{ id: string; key: string }>>,
    'seed-platform-workspaces.application_types',
  );

  const byKey = new Map(rows.map((r) => [r.key, r.id]));
  const missing = keys.filter((k) => !byKey.has(k));
  if (missing.length > 0) {
    throw new Error(
      `Seed aborted: ${missing.length} baseline application_type(s) absent on ` +
        `the target DB: [${missing.join(', ')}]. The 6 application_types are a ` +
        'canonical-baseline prerequisite — run seed-platform-from-staging first. ' +
        'This seed asserts them, it does not create them.',
    );
  }
  return byKey;
}

/**
 * Look up a workspace by its stable `name`. Returns the id if present, else null.
 */
async function findWorkspaceByName(
  client: SeedDbClient,
  name: string,
): Promise<string | null> {
  const row = await sb<{ id: string } | null>(
    client
      .from('workspaces')
      .select('id')
      .eq('name', name)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-platform-workspaces.workspaces.byName',
  );
  return row?.id ?? null;
}

/**
 * Seed (or verify) the six Platform workspaces. Idempotent: an existing row
 * (matched by `name`) is left untouched; an absent row is inserted with its
 * `application_type_id` (resolved by stable key) and the pipeline `created_by`.
 *
 * @param client   Service-role Platform DB client (RLS-bypassing).
 * @param dryRun   When true, plans the inserts but performs no write.
 */
export async function seedWorkspaces(
  client: SeedDbClient,
  dryRun: boolean,
): Promise<WorkspaceSeedResult[]> {
  const typeIdByKey = await assertApplicationTypes(client);
  const results: WorkspaceSeedResult[] = [];

  for (const seed of PLATFORM_WORKSPACE_SEEDS) {
    const existingId = await findWorkspaceByName(client, seed.name);
    if (existingId) {
      results.push({
        applicationTypeKey: seed.applicationTypeKey,
        name: seed.name,
        id: existingId,
        action: 'already-exists',
      });
      continue;
    }

    if (dryRun) {
      results.push({
        applicationTypeKey: seed.applicationTypeKey,
        name: seed.name,
        id: null,
        action: 'would-create',
      });
      continue;
    }

    const applicationTypeId = typeIdByKey.get(seed.applicationTypeKey)!;
    const created = await sb<{ id: string }>(
      client
        .from('workspaces')
        .insert({
          name: seed.name,
          application_type_id: applicationTypeId,
          created_by: PIPELINE_SYSTEM_USER_ID,
        })
        .select('id')
        .single() as PostgrestLike<{ id: string }>,
      'seed-platform-workspaces.workspaces.insert',
    );
    results.push({
      applicationTypeKey: seed.applicationTypeKey,
      name: seed.name,
      id: created.id,
      action: 'created',
    });
  }

  return results;
}

// ── CLI bootstrap ───────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseSeedArgs(process.argv.slice(2));
  const resolved = resolveTarget(args.target, process.env);

  console.log(
    `🌱 Seeding Platform workspaces → ${resolved.target} ` +
      `(${resolved.projectRef})` +
      (args.dryRun ? ' [dry-run — no writes]' : ' [LIVE --apply]'),
  );

  const client = createScriptClient(resolved.url, resolved.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SeedDbClient;

  const results = await seedWorkspaces(client, args.dryRun);

  for (const r of results) {
    const icon =
      r.action === 'created' ? '✨' : r.action === 'would-create' ? '·' : '➖';
    console.log(`  ${icon} ${r.name.padEnd(34)} → ${r.action}`);
  }
  console.log(
    `✅ ${results.filter((r) => r.action === 'created').length} created, ` +
      `${results.filter((r) => r.action === 'already-exists').length} already present.`,
  );
}

// Run only when invoked directly (never on import — tests import the functions).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('seed-platform-workspaces.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
