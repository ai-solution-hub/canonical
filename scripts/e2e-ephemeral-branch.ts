#!/usr/bin/env bun
/**
 * scripts/e2e-ephemeral-branch.ts
 *
 * Ephemeral Supabase branch lifecycle for the E2E nightly lane (ID-128.10).
 *
 * WHY: {128.10}'s ratified design (owner S455, cost ~$2-10/mo incremental —
 * see `.user-scratch/s454-recovery/id-128.10-ephemeral-branch-cost-time.md`)
 * provisions a fresh Supabase branch PER nightly run — create → wait-ready →
 * seed → run the sharded suite → always() delete — so the nightly no longer
 * shares the mutable `integration-staging-e2e` staging project/concurrency
 * group with PR-blocking CI. See PLAN.md {128.10} (slice e) at
 * `specs/id-128-e2e-nightly-restructure/PLAN.md`.
 *
 * MECHANISM: direct `fetch()` against the Supabase Management API
 * (`https://api.supabase.com/v1/...`), Bearer `SUPABASE_ACCESS_TOKEN` — the
 * SAME pattern as `scripts/run-supabase-advisors.ts` / `set-data-api-exposure.ts`
 * (no supabase-js: the MCP branching tools are unavailable in CI runners, and
 * supabase-js has the documented Bun 204-hang gotcha). No CLI dependency
 * either: `supabase link`/`branches` commands carry LOCAL session state
 * (`.supabase/`) that does not survive across GitHub Actions jobs running on
 * fresh runners, which this lifecycle deliberately splits across
 * provision-branch / e2e-shard / teardown-branch jobs.
 *
 * KEY IMPLEMENTATION RISK (design target): a failed `always()` teardown or a
 * cancelled/crashed run leaks a billed branch indefinitely. Two independent
 * guards close this:
 *   1. `deleteBranch` runs on `always()` in the workflow (idempotent — a
 *      404 "already gone" is success, not failure, so teardown never itself
 *      fails a run that otherwise passed).
 *   2. `sweepStaleBranches` runs as the FIRST step of every nightly (before
 *      creating a new branch): lists all branches, deletes any matching the
 *      `e2e-nightly-` naming convention older than `maxAgeHours` (default 6h)
 *      REGARDLESS of why it survived. A leaked branch cannot outlive one
 *      sweep cycle + the next scheduled nightly.
 *
 * EPISTEMIC CAVEAT (read before touching the parsing helpers): the Supabase
 * Management API's branch-object JSON schema was not fully published in the
 * docs at implementation time, but has since been confirmed empirically
 * (live probes against the parent project zjqbrdctesqvouboziae, 2026-07-10 —
 * see the EMPIRICAL FINDING below): `id`/`project_ref`/`name`/`created_at`/
 * `status`/`preview_project_status` on the LIST endpoint
 * (`GET /v1/projects/{ref}/branches`); `db_host`/`db_port`/`db_user`/
 * `db_pass`/`status` (a DIFFERENT, project-health `status` — see below) on
 * the SINGLE-branch endpoint (`GET /v1/branches/{id}`). `normaliseBranchRecord`
 * / `normaliseApiKeys` remain deliberately DEFENSIVE (try plausible aliases,
 * fail loud with the actual top-level keys on a mismatch) as insurance
 * against the account/project boundary drifting again.
 *
 * EMPIRICAL FINDING (manual Management-API probe, 2026-07-10, branch
 * `doziocclnhpadoevfmwf` off parent zjqbrdctesqvouboziae — created, observed,
 * deleted within the same session; see {128.10} journal for the full trace):
 * a Management-API-created branch (no `git_branch` — no GitHub PR behind it)
 * DOES attempt to replay this repo's real migration files (Postgres logs
 * showed the exact code comment from `20260619120000_rls_initplan_wrap_qa.sql`
 * executing), so it is NOT a bare schema-less clone — but the replay is
 * UNRELIABLE: it silently SKIPPED `20260617130000_squash_baseline.sql`
 * (13.8k lines — the migration that creates `public.change_reports` and
 * everything else) and then failed the very next migration with `relation
 * "public.change_reports" does not exist`, ending in branch-list `status:
 * "MIGRATIONS_FAILED"` with effectively NO application schema present. This
 * happened well BEFORE any of `application_types`/`change_reports`/etc.
 * existed, so the value `waitForBranchReady` polls for (below) would have
 * spun for the FULL timeout on PGRST002 no matter how long the window — this
 * is the concrete root cause of the S460 live-proof failure (run
 * 29127594878, 12-min PGRST002). Two DISTINCT status signals matter and must
 * not be conflated:
 *   - `preview_project_status` (list endpoint) / `status` (single-branch
 *     endpoint) — the underlying Postgres COMPUTE's health. Reaches
 *     `ACTIVE_HEALTHY` in ~15s regardless of migration outcome — necessary
 *     but NOT sufficient for schema/seed readiness. `waitForBranchComputeHealthy`
 *     polls this.
 *   - `status` (list endpoint ONLY, e.g. `CREATING_PROJECT` /
 *     `MIGRATIONS_FAILED` / `FUNCTIONS_DEPLOYED`) — Supabase's OWN
 *     migration-replay pipeline's outcome. Given it is empirically unreliable
 *     for this project, this script does not gate on it at all — it is
 *     logged for visibility only. Instead `applyMigrationsAndSeed` takes over
 *     migration + seed application entirely via direct `psql` (see its
 *     doc-comment) rather than trusting Supabase's own replay.
 * The single-branch endpoint (`fetchBranchDbCreds`) response contains
 * `db_pass`/`jwt_secret` in PLAINTEXT — confirmed on both `main` and
 * `staging` — see the SECURITY note on that function.
 *
 * ROOT CAUSE + FIX (S461 live-proof failure, run 29147735431): `psql`
 * connecting to `fetchBranchDbCreds`'s `db_host`
 * (`db.<branch-ref>.supabase.co`, the DIRECT connection) failed with
 * `Network is unreachable` — that hostname resolves IPv6-ONLY (Supabase docs,
 * "Dedicated IPv4 Address for Ingress" —
 * https://supabase.com/docs/guides/platform/ipv4-address — "By default,
 * Supabase Postgres use IPv6 addresses"), and GitHub-hosted runners have NO
 * IPv6 connectivity (same doc's IPv6-incompatible-platforms list names
 * "GitHub Actions" explicitly). `applyMigrationsAndSeed` now connects via
 * Supavisor's SESSION-mode pooler instead (`fetchBranchPoolerConnection`,
 * `GET /v1/projects/{ref}/config/database/pooler` — Supabase docs, "Connect
 * to your database" —
 * https://supabase.com/docs/guides/database/connecting-to-postgres — session
 * mode is "Always uses an IPv4 address" on every plan tier, no add-on
 * required). Session mode, NOT transaction mode (port 6543): transaction
 * mode does not preserve session-level Postgres state across statements
 * (prepared statements, `SET`, advisory locks) within one pooled connection,
 * which a `psql -f <migration-file>` run implicitly relies on — Supabase's
 * own guidance names transaction mode for "serverless or edge functions"
 * traffic, not migrations. `fetchBranchPoolerConnection` reads
 * `db_host`/`db_port`/`db_user` for the `PRIMARY`+`session` entry STRAIGHT
 * from the Management API response rather than hand-building
 * `aws-0-<region>.pooler.supabase.com` from a region string — this repo does
 * not need to track Supabase's own region→pooler-host mapping (including any
 * future non-`aws-0-` shard) at all. `db_pass` still comes from
 * `fetchBranchDbCreds` (the pooler-config endpoint does not return a
 * password) — only the connection HOST/PORT/USER changed.
 *
 * ITERATION-4 FIX (live-proof failure, run 29148230316): the S461 fix above
 * assumed every branch exposes a `PRIMARY`/`session` pooler entry — false
 * for ephemeral BRANCH projects, whose `config/database/pooler` response
 * contains ONLY a `PRIMARY`/`transaction` entry. `fetchBranchPoolerConnection`
 * now prefers the session entry when present but FALLS BACK to the
 * transaction entry (host/port/user still read verbatim from the API
 * response), failing loud with the actual entries seen only when neither
 * exists. Using a transaction-mode pooler connection safely requires
 * `applyMigrationsAndSeed`'s `psql` invocation to add `--single-transaction`
 * — every migration file / `seed.sql` then runs as ONE transaction pinned to
 * ONE backend connection, which is the property transaction mode does not
 * otherwise guarantee across statements. Verified safe for this repo's full
 * migration/seed set: no live `CREATE INDEX CONCURRENTLY` (the two grep
 * matches in `20260619120100_index_unindexed_fks.sql` are comments
 * explicitly rejecting it), no `VACUUM`/`ALTER SYSTEM`/`CREATE|DROP
 * DATABASE|TABLESPACE`, and no explicit `BEGIN`/`COMMIT`/`ROLLBACK`.
 *
 * ITERATION-5 FIX (live-proof failure, run 29148591505): with the pooler fix
 * above, `provision-branch` now SUCCEEDS end-to-end, but the downstream
 * `build` job's env validation failed — `SUPABASE_SERVICE_ROLE_KEY` arrived
 * EMPTY. Root cause: GitHub Actions job outputs are DROPPED, not merely
 * unmasked, when their value has been `::add-mask::`-ed —
 * `##[warning] Skip output 'service-role-key' since it may contain secret.`
 * (undocumented at implementation time; empirically confirmed by this run's
 * log). `branch-ref`/`branch-url`/`publishable-key` are unmasked/non-secret
 * and cross the job boundary fine — only the masked `service-role-key`
 * output silently vanished. FIX: stop passing the service-role key via job
 * outputs at all. The new `keys-env` subcommand
 * (`emitBranchServiceRoleKeyToEnv`) lets each CONSUMING job (`build`,
 * `e2e-shard`) fetch its OWN copy straight from the Management API — using
 * the non-secret `branch-ref` job output + `SUPABASE_ACCESS_TOKEN_EXPERIMENTAL`
 * (both already available to every job) — and writes it to `$GITHUB_ENV`,
 * masked, entirely WITHIN that job. `$GITHUB_ENV` never crosses a job
 * boundary, so this sidesteps the job-output masking bug rather than working
 * around it. `provision-branch`'s OWN internal steps keep reading
 * `steps.keys.outputs.service-role-key` (a same-job STEP output, unaffected
 * by this bug) unchanged.
 *
 * `waitForBranchReady` deliberately does NOT poll an undocumented branch
 * `status` enum. Instead it polls the branch's own PostgREST endpoint for
 * `public.application_types` — the table `supabase/seed.sql` §2·0 seeds
 * exactly once. Per the EMPIRICAL FINDING above, this repo no longer relies
 * on Supabase's own automatic replay+seed to make that true — `wait-ready`
 * now runs AFTER `applyMigrationsAndSeed` has explicitly written it, so this
 * probe confirms (a) that explicit apply actually took effect and (b)
 * PostgREST's schema cache has picked it up, rather than gating on Supabase's
 * own pipeline. A non-empty read is the concrete signal this slice actually
 * depends on (per PLAN.md {128.10}: "application_types.id is
 * gen_random_uuid(), NOT stable across branches ... the branch MUST be
 * seeded with application_types or every workspace insert throws").
 *
 * RETRY: every Management API call (`mgmtFetch`, `deleteBranch`) retries a
 * bounded number of times with backoff on 429/5xx/network-error — but NEVER
 * on other 4xx (bad auth/body is not fixed by retrying). This matters most
 * for `deleteBranch` under `always()`: a single transient 503 during
 * teardown must not silently widen the orphan-branch guard's worst-case
 * lifetime from "one run" to "one sweep cycle" (see `fetchWithRetry`).
 *
 * USAGE (CLI, invoked from the workflow — see `.github/workflows/e2e-nightly.yml`):
 *   bun run scripts/e2e-ephemeral-branch.ts sweep [--max-age-hours=6] [--dry-run]
 *   bun run scripts/e2e-ephemeral-branch.ts create --run-id=<id>
 *   bun run scripts/e2e-ephemeral-branch.ts wait-compute-healthy --branch-ref=<ref>
 *   bun run scripts/e2e-ephemeral-branch.ts migrate --branch-id=<id> --branch-ref=<ref>
 *   bun run scripts/e2e-ephemeral-branch.ts wait-ready --branch-url=<url> --service-role-key=<key>
 *   bun run scripts/e2e-ephemeral-branch.ts keys --branch-ref=<ref>
 *   bun run scripts/e2e-ephemeral-branch.ts keys-env --branch-ref=<ref>
 *   bun run scripts/e2e-ephemeral-branch.ts delete --branch-ref=<ref>
 *
 * Required env vars: SUPABASE_ACCESS_TOKEN (Management API PAT), and for
 * sweep/create/wait-compute-healthy/keys/delete, PLATFORM_PROJECT_REF (this
 * repo's own Platform staging project — the branch PARENT). `migrate` needs
 * only SUPABASE_ACCESS_TOKEN (it fetches the branch's own DB creds AND its
 * Supavisor pooler connection info directly — see the ROOT CAUSE + FIX note
 * above for why both `--branch-id` and `--branch-ref` are required) and the
 * `psql` binary on PATH. `keys-env` (ITERATION-5 FIX above) likewise needs
 * only SUPABASE_ACCESS_TOKEN + `--branch-ref` — no PLATFORM_PROJECT_REF.
 * Secret-shaped CLI outputs (service-role-key via `keys`/`keys-env`, and
 * `migrate`'s in-process DB password) are emitted via GitHub Actions
 * `::add-mask::` BEFORE being written to `$GITHUB_OUTPUT` / `$GITHUB_ENV` or
 * used — never echoed in plain log lines.
 */

import { appendFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const MANAGEMENT_API = 'https://api.supabase.com';
const DEFAULT_BRANCH_PREFIX = 'e2e-nightly-';
const DEFAULT_MAX_AGE_HOURS = 6;
/** Retried: rate-limit + transient server errors. NOT retried: other 4xx
 * (bad auth/body — a retry cannot fix those). */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRY_ATTEMPTS = 3;
const DEFAULT_RETRY_BASE_DELAY_MS = 1000;
/** Seeded once by supabase/seed.sql §2·0, immediately after migrations — the
 * concrete branch-readiness signal (see file header). */
const READY_CHECK_TABLE = 'application_types';

export class EphemeralBranchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EphemeralBranchError';
  }
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Deterministic, sanitised branch name: `e2e-nightly-<runid>-<timestamp>`.
 * Bounded length + charset (lowercase-safe alphanumeric + hyphens) since the
 * exact Supabase branch-name constraints are not published; kept
 * conservative rather than relying on an unconfirmed upper bound.
 */
export function branchNameFor(runId: string, nowMs: number): string {
  const stamp = new Date(nowMs)
    .toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14); // YYYYMMDDHHMMSS
  const safeRunId = runId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 20);
  return `${DEFAULT_BRANCH_PREFIX}${safeRunId}-${stamp}`;
}

/** A branch's own REST/API base URL is `https://{project_ref}.supabase.co`. */
export function branchUrlFor(ref: string): string {
  return `https://${ref}.supabase.co`;
}

function extractString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}

export interface BranchSummary {
  id: string;
  ref: string;
  name: string;
  createdAt: string | null;
  /** Supabase's OWN migration-replay pipeline status (list endpoint only,
   * e.g. `CREATING_PROJECT` / `MIGRATIONS_FAILED` / `FUNCTIONS_DEPLOYED`) —
   * per the file-header EMPIRICAL FINDING this is logged for visibility only
   * and never gated on (empirically unreliable for this project). */
  status?: string;
  /** The underlying Postgres COMPUTE's health (list endpoint's
   * `preview_project_status`, mirrored by the single-branch endpoint's own
   * `status` field — two different API shapes, same underlying value).
   * `waitForBranchComputeHealthy` polls THIS field, not `status` above. */
  previewProjectStatus?: string;
}

/**
 * Normalise one raw Management API branch record. See the file-header
 * epistemic caveat — this tries several plausible field-name aliases and
 * fails loud (dumping the actual keys) rather than silently mis-reading.
 */
export function normaliseBranchRecord(raw: unknown): BranchSummary {
  if (!raw || typeof raw !== 'object') {
    throw new EphemeralBranchError(
      `Branch record is not an object: ${JSON.stringify(raw)}`,
    );
  }
  const obj = raw as Record<string, unknown>;
  const id = extractString(obj, ['id', 'branch_id']);
  const ref = extractString(obj, ['project_ref', 'ref', 'db_project_ref']);
  if (!id || !ref) {
    throw new EphemeralBranchError(
      `Branch record missing id/ref — got keys [${Object.keys(obj).join(', ')}]. ` +
        'The Supabase Management API branch schema may differ from what this ' +
        "script assumes; extend normaliseBranchRecord's alias list.",
    );
  }
  const name =
    extractString(obj, ['name', 'branch_name', 'git_branch']) ?? '(unnamed)';
  const createdAt = extractString(obj, ['created_at', 'inserted_at']) ?? null;
  const status = extractString(obj, ['status']);
  const previewProjectStatus = extractString(obj, ['preview_project_status']);
  return { id, ref, name, createdAt, status, previewProjectStatus };
}

export interface BranchApiKeys {
  publishableKey: string;
  serviceRoleKey: string;
}

/**
 * Normalise the `GET /v1/projects/{ref}/api-keys` response. Prefers the new
 * publishable/secret key pair; falls back to the legacy anon/service_role
 * pair (per the Supabase "Recommended API keys" migration guidance) —
 * whichever the target project (and its branches) is on.
 */
export function normaliseApiKeys(raw: unknown): BranchApiKeys {
  if (!Array.isArray(raw)) {
    throw new EphemeralBranchError(
      `GET .../api-keys did not return an array (got ${typeof raw}).`,
    );
  }
  const entries = raw as Record<string, unknown>[];
  const find = (types: string[]) =>
    entries.find((e) =>
      types.includes(String(e.type ?? e.name ?? '').toLowerCase()),
    );
  const pub = find(['publishable', 'anon']);
  const secret = find(['secret', 'service_role']);
  const publishableKey =
    pub && typeof pub.api_key === 'string' ? pub.api_key : undefined;
  const serviceRoleKey =
    secret && typeof secret.api_key === 'string' ? secret.api_key : undefined;
  if (!publishableKey || !serviceRoleKey) {
    throw new EphemeralBranchError(
      'Could not find a publishable+secret (or anon+service_role) key pair ' +
        `in the api-keys response — got entries: ${JSON.stringify(
          entries.map((e) => ({ type: e.type, name: e.name })),
        )}.`,
    );
  }
  return { publishableKey, serviceRoleKey };
}

// ── Management API plumbing ─────────────────────────────────────────────────

export interface ManagementApiDeps {
  token: string;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  /** Injectable for tests — defaults to a real `setTimeout`-based sleep. */
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Bounded retry + exponential backoff around a single fetch call. Retries
 * ONLY on 429/5xx HTTP statuses or a thrown network error (DNS/timeout/
 * connection reset) — a genuine 4xx (bad auth, malformed body) is returned
 * immediately since retrying cannot fix it. Exhausting all attempts on a
 * retryable HTTP status returns the last (failing) Response so the caller's
 * normal error-handling path fires with the real status; exhausting on a
 * thrown network error re-throws the last error.
 */
async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  f: typeof fetch,
  opts: {
    attempts?: number;
    baseDelayMs?: number;
    log?: (message: string) => void;
    sleepFn?: (ms: number) => Promise<void>;
  } = {},
): Promise<Response> {
  const attempts = opts.attempts ?? DEFAULT_RETRY_ATTEMPTS;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
  const log = opts.log ?? console.log;
  const sleep =
    opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastNetworkError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await f(url, init);
      if (res.ok || !RETRYABLE_STATUS.has(res.status)) {
        return res;
      }
      if (attempt === attempts) {
        return res; // exhausted — let the caller's normal !res.ok path throw
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      log(
        `[e2e-ephemeral-branch] ${url} returned HTTP ${res.status} ` +
          `(attempt ${attempt}/${attempts}) — retrying in ${delayMs}ms…`,
      );
      await sleep(delayMs);
    } catch (err) {
      lastNetworkError = err;
      if (attempt === attempts) {
        throw err;
      }
      const delayMs = baseDelayMs * 2 ** (attempt - 1);
      log(
        `[e2e-ephemeral-branch] network error calling ${url} (attempt ` +
          `${attempt}/${attempts}): ${
            err instanceof Error ? err.message : String(err)
          } — retrying in ${delayMs}ms…`,
      );
      await sleep(delayMs);
    }
  }
  // Unreachable (the loop always returns or throws by the final attempt),
  // but keeps the return type sound for TS.
  throw lastNetworkError instanceof Error
    ? lastNetworkError
    : new Error(String(lastNetworkError));
}

async function mgmtFetch(
  path: string,
  deps: ManagementApiDeps,
  init?: RequestInit,
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch;
  const res = await fetchWithRetry(
    `${MANAGEMENT_API}${path}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${deps.token}`,
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    },
    f,
    { log: deps.log, sleepFn: deps.sleepFn },
  );
  if (!res.ok) {
    throw new EphemeralBranchError(
      `${init?.method ?? 'GET'} ${path} failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/** `GET /v1/projects/{ref}/branches` — every branch of the platform project. */
export async function listBranches(
  platformProjectRef: string,
  deps: ManagementApiDeps,
): Promise<BranchSummary[]> {
  const raw = await mgmtFetch(
    `/v1/projects/${platformProjectRef}/branches`,
    deps,
  );
  if (!Array.isArray(raw)) {
    throw new EphemeralBranchError(
      `GET .../branches did not return an array (got ${typeof raw}).`,
    );
  }
  return raw.map(normaliseBranchRecord);
}

export interface SweepResult {
  deleted: BranchSummary[];
  kept: BranchSummary[];
}

/**
 * Orphan-sweep guard (ID-128.10 key implementation risk). Deletes every
 * branch matching the ephemeral naming convention whose age exceeds
 * `maxAgeHours`, regardless of WHY it survived (crashed run, cancelled
 * workflow, a bug in the always() teardown step). Non-matching branches
 * (e.g. the persistent `staging` branch) are never even considered.
 */
export async function sweepStaleBranches(
  opts: {
    platformProjectRef: string;
    prefix?: string;
    maxAgeHours?: number;
    nowMs?: number;
    dryRun?: boolean;
  } & ManagementApiDeps,
): Promise<SweepResult> {
  const log = opts.log ?? console.log;
  const prefix = opts.prefix ?? DEFAULT_BRANCH_PREFIX;
  const maxAgeMs = (opts.maxAgeHours ?? DEFAULT_MAX_AGE_HOURS) * 60 * 60 * 1000;
  const now = opts.nowMs ?? Date.now();

  const all = await listBranches(opts.platformProjectRef, opts);
  const candidates = all.filter((b) => b.name.startsWith(prefix));
  const deleted: BranchSummary[] = [];
  const kept: BranchSummary[] = [];

  for (const b of candidates) {
    // Fail TOWARD deletion, not away from it: a missing createdAt AND an
    // unparseable one (the field-name/format is unconfirmed — see the file
    // header epistemic caveat) both collapse to Infinity. `new Date(garbage)
    // .getTime()` is NaN, and `NaN > maxAgeMs` is false, which would
    // silently KEEP a branch this guard exists to delete — the opposite of
    // the orphan-teardown guard's intent.
    const parsedCreatedAt = b.createdAt ? new Date(b.createdAt).getTime() : NaN;
    const ageMs = Number.isFinite(parsedCreatedAt)
      ? now - parsedCreatedAt
      : Infinity;
    if (ageMs > maxAgeMs) {
      log(
        `[e2e-ephemeral-branch] sweep: "${b.name}" (${b.ref}) is ` +
          `${(ageMs / 3_600_000).toFixed(1)}h old — deleting.`,
      );
      if (!opts.dryRun) {
        await deleteBranch(b.ref, opts);
      }
      deleted.push(b);
    } else {
      kept.push(b);
    }
  }
  log(
    `[e2e-ephemeral-branch] sweep complete — deleted ${deleted.length}, kept ${kept.length}.`,
  );
  return { deleted, kept };
}

/** `POST /v1/projects/{ref}/branches` — create the nightly's ephemeral branch. */
export async function createEphemeralBranch(
  opts: {
    platformProjectRef: string;
    branchName: string;
  } & ManagementApiDeps,
): Promise<BranchSummary> {
  const log = opts.log ?? console.log;
  log(
    `[e2e-ephemeral-branch] creating branch "${opts.branchName}" off ${opts.platformProjectRef}…`,
  );
  const raw = await mgmtFetch(
    `/v1/projects/${opts.platformProjectRef}/branches`,
    opts,
    {
      method: 'POST',
      body: JSON.stringify({ branch_name: opts.branchName }),
    },
  );
  const branch = normaliseBranchRecord(raw);
  log(`[e2e-ephemeral-branch] created — id=${branch.id} ref=${branch.ref}.`);
  return branch;
}

/**
 * `DELETE /v1/branches/{branch_id_or_ref}`. Idempotent: a 404 (already gone)
 * is treated as success — the always() teardown step must never itself fail
 * a run that otherwise passed, and the sweep step must be safe to re-run
 * against a branch another sweep/teardown already deleted.
 */
export async function deleteBranch(
  branchIdOrRef: string,
  deps: ManagementApiDeps,
): Promise<void> {
  const log = deps.log ?? console.log;
  const f = deps.fetchImpl ?? fetch;
  const res = await fetchWithRetry(
    `${MANAGEMENT_API}/v1/branches/${branchIdOrRef}`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${deps.token}` },
    },
    f,
    { log, sleepFn: deps.sleepFn },
  );
  if (!res.ok && res.status !== 404) {
    throw new EphemeralBranchError(
      `DELETE /v1/branches/${branchIdOrRef} failed: HTTP ${res.status} ${await res.text()}`,
    );
  }
  log(
    `[e2e-ephemeral-branch] deleted branch ${branchIdOrRef} (status ${res.status}).`,
  );
}

/** `GET /v1/projects/{ref}/api-keys?reveal=true` for the BRANCH's own project ref. */
export async function fetchBranchApiKeys(
  opts: {
    branchProjectRef: string;
  } & ManagementApiDeps,
): Promise<BranchApiKeys> {
  const raw = await mgmtFetch(
    `/v1/projects/${opts.branchProjectRef}/api-keys?reveal=true`,
    opts,
  );
  return normaliseApiKeys(raw);
}

export interface WaitComputeHealthyOptions {
  /** The PARENT project ref — branches are only listed via the parent (see
   * the file-header EMPIRICAL FINDING: the branch's own ref refuses this
   * endpoint). */
  platformProjectRef: string;
  /** THIS branch's own project ref (the `ref` field `createEphemeralBranch`
   * returned), used to find it in the parent's branch list. */
  branchRef: string;
  timeoutMs?: number;
  intervalMs?: number;
  log?: (message: string) => void;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

const DEFAULT_COMPUTE_HEALTHY_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_COMPUTE_HEALTHY_INTERVAL_MS = 10_000;

/**
 * Poll the PARENT project's branch list for THIS branch's
 * `previewProjectStatus` until `ACTIVE_HEALTHY` — the underlying Postgres
 * compute is up and reachable. Per the file-header EMPIRICAL FINDING, this
 * is NOT proof of schema/seed readiness (it reaches `ACTIVE_HEALTHY` in ~15s
 * regardless of whether Supabase's own migration replay succeeds) — it is
 * only the precondition for the `psql` connection `applyMigrationsAndSeed`
 * makes next. Logs the branch's own (unreliable, informational-only)
 * `status` alongside for visibility, but never gates on it.
 */
export async function waitForBranchComputeHealthy(
  opts: WaitComputeHealthyOptions & ManagementApiDeps,
): Promise<void> {
  const log = opts.log ?? console.log;
  const now = opts.nowFn ?? Date.now;
  const sleep =
    opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? DEFAULT_COMPUTE_HEALTHY_TIMEOUT_MS;
  const intervalMs = opts.intervalMs ?? DEFAULT_COMPUTE_HEALTHY_INTERVAL_MS;
  const deadline = now() + timeoutMs;

  let lastSeen = 'no attempt made';
  while (now() < deadline) {
    const all = await listBranches(opts.platformProjectRef, opts);
    const mine = all.find((b) => b.ref === opts.branchRef);
    if (mine) {
      lastSeen = `previewProjectStatus=${mine.previewProjectStatus ?? '(absent)'} status=${mine.status ?? '(absent)'}`;
      if (mine.previewProjectStatus === 'ACTIVE_HEALTHY') {
        log(
          `[e2e-ephemeral-branch] branch compute healthy — ${lastSeen} ` +
            '(its own migration-replay status is informational only; ' +
            'this script applies migrations explicitly next).',
        );
        return;
      }
    } else {
      lastSeen = `branch ${opts.branchRef} not present in parent's branch list yet`;
    }
    log(
      `[e2e-ephemeral-branch] compute not healthy yet (${lastSeen}) — retrying in ${
        intervalMs / 1000
      }s…`,
    );
    await sleep(intervalMs);
  }
  throw new EphemeralBranchError(
    `Branch compute did not become healthy within ${timeoutMs / 60_000} minutes. Last seen: ${lastSeen}`,
  );
}

export interface BranchDbCreds {
  host: string;
  port: number;
  user: string;
  password: string;
}

/**
 * `GET /v1/branches/{branch_id}` — the SINGLE-branch endpoint (distinct from
 * `listBranches`'s `GET /v1/projects/{ref}/branches`). Returns this branch's
 * own live Postgres connection details.
 *
 * USAGE NOTE (post ROOT-CAUSE-+-FIX above): `applyMigrationsAndSeed` no
 * longer connects via THIS function's `host`/`port`/`user` — those describe
 * the DIRECT (IPv6-only) connection, unreachable from GitHub-hosted runners.
 * Only `password` (`db_pass`, not exposed anywhere else) is still sourced
 * from here; `host`/`port`/`user` for the actual `psql` connection come from
 * `fetchBranchPoolerConnection` below.
 *
 * SECURITY: the raw response body carries `db_pass` + `jwt_secret` in
 * PLAINTEXT (confirmed empirically against both the `main` and `staging`
 * branches, 2026-07-10). NEVER log the raw body — including on error: unlike
 * `mgmtFetch`'s generic error path, this deliberately withholds `res.text()`
 * from the thrown message, since an error body on this specific endpoint
 * could plausibly still carry those fields.
 */
export async function fetchBranchDbCreds(
  branchId: string,
  deps: ManagementApiDeps,
): Promise<BranchDbCreds> {
  const f = deps.fetchImpl ?? fetch;
  const res = await fetchWithRetry(
    `${MANAGEMENT_API}/v1/branches/${branchId}`,
    { headers: { Authorization: `Bearer ${deps.token}` } },
    f,
    { log: deps.log, sleepFn: deps.sleepFn },
  );
  if (!res.ok) {
    throw new EphemeralBranchError(
      `GET /v1/branches/${branchId} failed: HTTP ${res.status} (body withheld — may contain credentials).`,
    );
  }
  const raw = (await res.json()) as Record<string, unknown>;
  const host = extractString(raw, ['db_host']);
  const password = extractString(raw, ['db_pass']);
  const user = extractString(raw, ['db_user']) ?? 'postgres';
  const portRaw = raw['db_port'];
  const port =
    typeof portRaw === 'number'
      ? portRaw
      : typeof portRaw === 'string' && portRaw.length > 0
        ? Number(portRaw)
        : 5432;
  if (!host || !password) {
    throw new EphemeralBranchError(
      `GET /v1/branches/${branchId} response missing db_host/db_pass — got ` +
        `keys [${Object.keys(raw).join(', ')}] (values withheld).`,
    );
  }
  return { host, port, user, password };
}

export interface PoolerConnectionInfo {
  host: string;
  port: number;
  user: string;
}

/**
 * `GET /v1/projects/{ref}/config/database/pooler` — this BRANCH's own
 * project ref's Supavisor (shared pooler) connection info. See the
 * file-header ROOT CAUSE + FIX note: GitHub-hosted runners have no IPv6
 * connectivity, so `psql` cannot reach `fetchBranchDbCreds`'s direct
 * `db_host`. Supavisor's SESSION-mode pooler (NOT transaction mode — see the
 * same note for why session mode was originally preferred) is IPv4 on every
 * plan tier, no add-on required.
 *
 * ITERATION-4 FALLBACK (live run 29148230316): ephemeral BRANCH projects
 * have been observed to expose ONLY the `PRIMARY`/`transaction` pooler
 * entry — no `PRIMARY`/`session` entry at all. Prefers the session entry
 * when present; FALLS BACK to the transaction entry (host/port/user read
 * verbatim from the API response, same as the session path) rather than
 * failing loud, since a branch genuinely may not offer session mode.
 * `applyMigrationsAndSeed`'s `psql` invocation adds `--single-transaction`
 * so a transaction-mode pooler connection (which does not preserve session
 * state — prepared statements, `SET`, advisory locks — across statements)
 * is still safe: each migration file / `seed.sql` runs as ONE transaction on
 * ONE pinned backend connection, and this repo's full migration/seed set
 * contains no `CREATE INDEX CONCURRENTLY` / `VACUUM` / `ALTER SYSTEM` /
 * `CREATE|DROP DATABASE|TABLESPACE` / explicit `BEGIN`/`COMMIT`/`ROLLBACK`
 * (verified by grep — see the iteration-3 executor's PLAN.md {128.10}
 * journal) that would conflict with that constraint.
 *
 * Reads `db_host`/`db_port`/`db_user` straight from the API response for
 * whichever entry is chosen, rather than hand-building
 * `aws-0-<region>.pooler.supabase.com` from a region string — this tracks
 * whatever host Supabase's own infrastructure actually assigns (including
 * any future non-`aws-0-` shard) without this script needing to know the
 * mapping. Does NOT return a password — `fetchBranchDbCreds`'s `db_pass` is
 * still the only source for that. Fails loud, naming the actual entries
 * seen, only when NEITHER a session nor a transaction `PRIMARY` entry
 * exists.
 */
export async function fetchBranchPoolerConnection(
  branchProjectRef: string,
  deps: ManagementApiDeps,
): Promise<PoolerConnectionInfo> {
  const raw = await mgmtFetch(
    `/v1/projects/${branchProjectRef}/config/database/pooler`,
    deps,
  );
  if (!Array.isArray(raw)) {
    throw new EphemeralBranchError(
      'GET .../config/database/pooler did not return an array (got ' +
        `${typeof raw}).`,
    );
  }
  const entries = raw as Record<string, unknown>[];
  const sessionEntry = entries.find(
    (e) => e.database_type === 'PRIMARY' && e.pool_mode === 'session',
  );
  const transactionEntry = entries.find(
    (e) => e.database_type === 'PRIMARY' && e.pool_mode === 'transaction',
  );
  const chosenEntry = sessionEntry ?? transactionEntry;
  if (!chosenEntry) {
    throw new EphemeralBranchError(
      'Could not find a PRIMARY session-mode or transaction-mode Supavisor ' +
        'pooler entry in the config/database/pooler response — got ' +
        `entries: ${JSON.stringify(
          entries.map((e) => ({
            database_type: e.database_type,
            pool_mode: e.pool_mode,
          })),
        )}.`,
    );
  }
  const host = extractString(chosenEntry, ['db_host']);
  const user = extractString(chosenEntry, ['db_user']);
  const portRaw = chosenEntry['db_port'];
  const port =
    typeof portRaw === 'number'
      ? portRaw
      : typeof portRaw === 'string' && portRaw.length > 0
        ? Number(portRaw)
        : NaN;
  if (!host || !user || !Number.isFinite(port)) {
    throw new EphemeralBranchError(
      `Supavisor ${chosenEntry.pool_mode ?? '(unknown)'}-mode pooler entry ` +
        `missing db_host/db_user/db_port — got keys [${Object.keys(chosenEntry).join(', ')}].`,
    );
  }
  return { host, port, user };
}

export interface PsqlExecResult {
  ok: boolean;
  stderr: string;
}

/** Injectable so tests never shell out to a real `psql`. */
export type PsqlExecutor = (
  file: string,
  env: NodeJS.ProcessEnv,
) => PsqlExecResult;

function defaultPsqlExecutor(
  file: string,
  env: NodeJS.ProcessEnv,
): PsqlExecResult {
  try {
    // `--single-transaction` wraps the whole file in one BEGIN/COMMIT,
    // pinned to one backend connection — required now that the pooler
    // connection may be Supavisor TRANSACTION mode (see the
    // fetchBranchPoolerConnection doc comment's ITERATION-4 FALLBACK note),
    // which does not preserve session state across statements otherwise.
    execFileSync(
      'psql',
      ['-v', 'ON_ERROR_STOP=1', '-q', '--single-transaction', '-f', file],
      {
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    return { ok: true, stderr: '' };
  } catch (err) {
    const e = err as { stderr?: Buffer | string | null; message?: string };
    const stderr = e.stderr
      ? typeof e.stderr === 'string'
        ? e.stderr
        : e.stderr.toString('utf-8')
      : (e.message ?? String(err));
    return { ok: false, stderr };
  }
}

const DEFAULT_MIGRATIONS_DIR = 'supabase/migrations';
const DEFAULT_SEED_FILE = 'supabase/seed.sql';

function defaultListMigrationFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(dir, f));
}

export interface ApplyMigrationsOptions {
  dbCreds: BranchDbCreds;
  migrationsDir?: string;
  seedFile?: string;
  log?: (message: string) => void;
  psqlExec?: PsqlExecutor;
  listMigrationFiles?: (dir: string) => string[];
}

/**
 * Explicitly replay every `supabase/migrations/*.sql` file (filename order)
 * then `supabase/seed.sql` directly against the branch's own Postgres via
 * `psql` — bypassing Supabase's own branch-creation migration-replay
 * pipeline entirely.
 *
 * WHY: per the file-header EMPIRICAL FINDING, that automatic pipeline is NOT
 * reliable for this project — it silently skipped the squash-baseline
 * migration and failed the next one, leaving the branch with no application
 * schema at all. Rather than trying to detect/repair that specific
 * Supabase-owned failure mode, this function takes over entirely. `psql` is
 * used (not the `supabase` CLI) because it is stateless — no `supabase
 * link` session-state-doesn't-survive-fresh-runners issue (see the
 * top-of-file MECHANISM note). Every migration/seed.sql statement in this
 * repo already follows an idempotent pattern (`CREATE ... IF NOT EXISTS`,
 * `DROP ... IF EXISTS` + `CREATE`, `ON CONFLICT DO NOTHING` — see
 * `supabase/seed.sql`'s own contract §2), so replaying the FULL set
 * unconditionally is safe even if Supabase's own (per-file-transaction,
 * rolled-back-on-error) attempt already touched the branch.
 *
 * Fails LOUD (`ON_ERROR_STOP=1`, non-zero `psql` exit) on the first broken
 * statement in either a migration file or seed.sql, naming the exact file —
 * must never silently continue past a broken migration onto the next one.
 */
export async function applyMigrationsAndSeed(
  opts: ApplyMigrationsOptions,
): Promise<{ migrationsApplied: number }> {
  const log = opts.log ?? console.log;
  const exec = opts.psqlExec ?? defaultPsqlExecutor;
  const list = opts.listMigrationFiles ?? defaultListMigrationFiles;
  const migrationsDir = opts.migrationsDir ?? DEFAULT_MIGRATIONS_DIR;
  const seedFile = opts.seedFile ?? DEFAULT_SEED_FILE;
  const files = list(migrationsDir);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGHOST: opts.dbCreds.host,
    PGPORT: String(opts.dbCreds.port),
    PGUSER: opts.dbCreds.user,
    PGPASSWORD: opts.dbCreds.password,
    PGDATABASE: 'postgres',
    PGSSLMODE: 'require',
  };

  log(
    `[e2e-ephemeral-branch] explicitly applying ${files.length} migration ` +
      `file(s) from ${migrationsDir} (bypassing Supabase's own ` +
      'branch-creation replay — see file header EMPIRICAL FINDING)…',
  );
  for (const file of files) {
    log(`[e2e-ephemeral-branch] migrate: ${file}`);
    const result = exec(file, env);
    if (!result.ok) {
      throw new EphemeralBranchError(
        `Explicit migration apply FAILED on ${file}: ${result.stderr}`,
      );
    }
  }

  log(`[e2e-ephemeral-branch] loading seed data: ${seedFile}`);
  const seedResult = exec(seedFile, env);
  if (!seedResult.ok) {
    throw new EphemeralBranchError(
      `Explicit seed.sql apply FAILED: ${seedResult.stderr}`,
    );
  }
  log('[e2e-ephemeral-branch] migrations + seed.sql applied successfully.');
  return { migrationsApplied: files.length };
}

export interface WaitReadyOptions {
  branchUrl: string;
  serviceRoleKey: string;
  timeoutMs?: number;
  intervalMs?: number;
  fetchImpl?: typeof fetch;
  log?: (message: string) => void;
  nowFn?: () => number;
  sleepFn?: (ms: number) => Promise<void>;
}

/**
 * Poll the branch's PostgREST endpoint until `application_types` (seeded by
 * `supabase/seed.sql` §2·0) is readable — see the file-header rationale for
 * why this is the readiness signal instead of an undocumented branch-status
 * enum. Any non-2xx response, an empty result, or a network error is
 * treated as "not ready yet" and retried until `timeoutMs` elapses, at which
 * point it fails loud with the last observed error (never hangs silently).
 *
 * ROLE CHANGE (post {128.10} EMPIRICAL FINDING): this now runs AFTER
 * `applyMigrationsAndSeed` has explicitly written the schema/seed data
 * itself, so it confirms that write took effect + PostgREST's schema cache
 * picked it up — NOT Supabase's own (empirically unreliable) migration
 * replay. The default timeout is shrunk accordingly: the S460 failure mode
 * (12 minutes of PGRST002) was Supabase's replay NEVER finishing, not slow
 * PostgREST cache reload — a genuinely fresh schema-cache pickup is a matter
 * of seconds, so a much shorter window now fails fast and loud instead of
 * masking a real regression behind a long, hopeful spin.
 */
export async function waitForBranchReady(
  opts: WaitReadyOptions,
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console.log;
  const now = opts.nowFn ?? Date.now;
  const sleep =
    opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 3 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 10_000;
  const deadline = now() + timeoutMs;
  const url = `${opts.branchUrl.replace(/\/$/, '')}/rest/v1/${READY_CHECK_TABLE}?select=id&limit=1`;

  let lastError = 'no attempt made';
  while (now() < deadline) {
    try {
      const res = await f(url, {
        headers: {
          apikey: opts.serviceRoleKey,
          Authorization: `Bearer ${opts.serviceRoleKey}`,
        },
      });
      if (res.ok) {
        const body = (await res.json()) as unknown[];
        if (Array.isArray(body) && body.length > 0) {
          log(
            `[e2e-ephemeral-branch] branch ready — ${READY_CHECK_TABLE} readable with ${body.length} row(s).`,
          );
          return;
        }
        lastError = `${READY_CHECK_TABLE} query returned 0 rows (seed.sql may not have run yet)`;
      } else {
        lastError = `HTTP ${res.status}: ${await res.text()}`;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    log(
      `[e2e-ephemeral-branch] not ready yet (${lastError}) — retrying in ${
        intervalMs / 1000
      }s…`,
    );
    await sleep(intervalMs);
  }
  throw new EphemeralBranchError(
    `Branch did not become ready within ${timeoutMs / 60_000} minutes. Last error: ${lastError}`,
  );
}

// ── CLI entry point ─────────────────────────────────────────────────────────

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function requireArg(name: string): string {
  const v = parseArg(name);
  if (!v) {
    throw new EphemeralBranchError(`--${name}=<value> is required.`);
  }
  return v;
}

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    throw new EphemeralBranchError(`${name} env var is required.`);
  }
  return v;
}

/**
 * Write a GitHub Actions step output. Secret-shaped values MUST be masked
 * BEFORE this is called (`::add-mask::`) — this function does not mask on
 * your behalf, since non-secret outputs (branch ref/url) should stay legible
 * in the log for debugging.
 */
function writeOutput(name: string, value: string): void {
  const outFile = process.env.GITHUB_OUTPUT;
  if (!outFile) {
    console.log(
      `[e2e-ephemeral-branch] (no GITHUB_OUTPUT set) ${name}=${value}`,
    );
    return;
  }
  const delimiter = `ghadelim_${Math.random().toString(36).slice(2)}`;
  appendFileSync(outFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

function maskAndWriteOutput(name: string, value: string): void {
  // GitHub Actions masking is a log-processing directive, not a value
  // transform — printing it BEFORE the value ever reaches a log line is
  // what makes later accidental echoes redact correctly.
  console.log(`::add-mask::${value}`);
  writeOutput(name, value);
}

export interface WriteEnvVarOptions {
  /** Injectable — defaults to `node:fs`'s real `appendFileSync`. Tests supply
   * a spy instead of touching disk. */
  appendToFile?: (path: string, content: string) => void;
  /** Injectable — defaults to `console.log`, same as `writeOutput` /
   * `maskAndWriteOutput` above. */
  log?: (message: string) => void;
}

/**
 * {128.10} ITERATION-5 FIX: write `NAME=VALUE` to the GitHub Actions
 * `$GITHUB_ENV` file so every SUBSEQUENT step in the SAME job sees it as a
 * plain process env var — no `${{ steps.X.outputs.Y }}` interpolation (and
 * no `needs.*.outputs` cross-job reference) required downstream. Unlike
 * `needs.*.outputs`, `$GITHUB_ENV` never crosses a job boundary, so GitHub's
 * per-job masking of secret-shaped values can never be silently dropped by
 * it — see the file-header ITERATION-5 FIX note for the bug this sidesteps.
 * Secret-shaped values MUST be masked BEFORE this is called
 * (`maskAndWriteEnvVar` below) — mirrors `writeOutput`'s own contract.
 */
export function writeEnvVar(
  name: string,
  value: string,
  opts: WriteEnvVarOptions = {},
): void {
  const log = opts.log ?? console.log;
  const append = opts.appendToFile ?? appendFileSync;
  const envFile = process.env.GITHUB_ENV;
  if (!envFile) {
    log(`[e2e-ephemeral-branch] (no GITHUB_ENV set) ${name}=${value}`);
    return;
  }
  const delimiter = `ghaenvdelim_${Math.random().toString(36).slice(2)}`;
  append(envFile, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/**
 * Same masking discipline as `maskAndWriteOutput`: the `::add-mask::`
 * directive is printed (via `log`) BEFORE the value is written anywhere
 * else, so any later accidental echo of it is redacted correctly.
 */
export function maskAndWriteEnvVar(
  name: string,
  value: string,
  opts: WriteEnvVarOptions = {},
): void {
  const log = opts.log ?? console.log;
  log(`::add-mask::${value}`);
  writeEnvVar(name, value, opts);
}

export interface EmitServiceRoleKeyOptions {
  /** The branch's own project ref — the same non-secret value the workflow's
   * `branch-ref` job output already exposes. Validated here (not only in
   * the CLI wrapper below) so a direct/programmatic call still fails loud on
   * a missing/blank ref, matching this file's fail-loud convention. */
  branchProjectRef: string | undefined;
}

/**
 * `keys-env` subcommand core (see file-header ITERATION-5 FIX note): fetch
 * this branch's API keys via the SAME `fetchBranchApiKeys` /
 * `normaliseApiKeys` path the `keys` subcommand uses, and emit ONLY the
 * secret-shaped service-role key to `$GITHUB_ENV`, masked. Consuming jobs
 * (`build`, `e2e-shard`) call this THEMSELVES instead of reading
 * `needs.provision-branch.outputs.service-role-key`, because GitHub Actions
 * silently DROPS a job output whose value it has masked — the root cause of
 * the {128.10} live-proof `build`-job failure (run 29148591505). The
 * publishable key and branch-url are NOT secret-shaped and continue to flow
 * via ordinary job outputs, unaffected by that bug — this function
 * deliberately does not also emit them.
 */
export async function emitBranchServiceRoleKeyToEnv(
  opts: EmitServiceRoleKeyOptions & ManagementApiDeps & WriteEnvVarOptions,
): Promise<BranchApiKeys> {
  if (!opts.branchProjectRef) {
    throw new EphemeralBranchError(
      "--branch-ref=<ref> is required to fetch this branch's API keys.",
    );
  }
  const keys = await fetchBranchApiKeys({
    ...opts,
    branchProjectRef: opts.branchProjectRef,
  });
  maskAndWriteEnvVar('SUPABASE_SERVICE_ROLE_KEY', keys.serviceRoleKey, opts);
  return keys;
}

async function runSweep(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const platformProjectRef = requireEnv('PLATFORM_PROJECT_REF');
  const maxAgeHours = Number(
    parseArg('max-age-hours') ?? DEFAULT_MAX_AGE_HOURS,
  );
  const dryRun = process.argv.includes('--dry-run');
  await sweepStaleBranches({ platformProjectRef, maxAgeHours, dryRun, token });
}

async function runCreate(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const platformProjectRef = requireEnv('PLATFORM_PROJECT_REF');
  const runId = requireArg('run-id');
  const branchName = branchNameFor(runId, Date.now());
  const branch = await createEphemeralBranch({
    platformProjectRef,
    branchName,
    token,
  });
  writeOutput('branch-id', branch.id);
  writeOutput('branch-ref', branch.ref);
  writeOutput('branch-name', branch.name);
  writeOutput('branch-url', branchUrlFor(branch.ref));
}

async function runWaitComputeHealthy(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const platformProjectRef = requireEnv('PLATFORM_PROJECT_REF');
  const branchRef = requireArg('branch-ref');
  await waitForBranchComputeHealthy({ platformProjectRef, branchRef, token });
}

async function runMigrate(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const branchId = requireArg('branch-id');
  const branchRef = requireArg('branch-ref');
  const dbCreds = await fetchBranchDbCreds(branchId, { token });
  // Mask the password THE INSTANT it's in hand — before any further log
  // line (including this process's own) can echo it in plain text.
  console.log(`::add-mask::${dbCreds.password}`);
  // Runners have no IPv6 (see file-header ROOT CAUSE + FIX) — connect via
  // the Supavisor session pooler's API-provided host/port/user, not the
  // direct (IPv6-only) host/port/user fetchBranchDbCreds itself returned.
  const pooler = await fetchBranchPoolerConnection(branchRef, { token });
  await applyMigrationsAndSeed({
    dbCreds: {
      host: pooler.host,
      port: pooler.port,
      user: pooler.user,
      password: dbCreds.password,
    },
  });
}

async function runWaitReady(): Promise<void> {
  const branchUrl = requireArg('branch-url');
  const serviceRoleKey = requireEnv('BRANCH_SERVICE_ROLE_KEY');
  await waitForBranchReady({ branchUrl, serviceRoleKey });
}

async function runKeys(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const branchProjectRef = requireArg('branch-ref');
  const keys = await fetchBranchApiKeys({ branchProjectRef, token });
  writeOutput('publishable-key', keys.publishableKey);
  maskAndWriteOutput('service-role-key', keys.serviceRoleKey);
}

async function runKeysEnv(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const branchProjectRef = requireArg('branch-ref');
  await emitBranchServiceRoleKeyToEnv({ branchProjectRef, token });
}

async function runDelete(): Promise<void> {
  const token = requireEnv('SUPABASE_ACCESS_TOKEN');
  const branchRef = parseArg('branch-ref');
  if (!branchRef) {
    // provision-branch never got far enough to create anything — always()
    // teardown must be a clean no-op, not a failure.
    console.log(
      '[e2e-ephemeral-branch] delete: no --branch-ref supplied — nothing to clean up.',
    );
    return;
  }
  await deleteBranch(branchRef, { token });
}

async function main(): Promise<void> {
  const command = process.argv[2];
  switch (command) {
    case 'sweep':
      return runSweep();
    case 'create':
      return runCreate();
    case 'wait-compute-healthy':
      return runWaitComputeHealthy();
    case 'migrate':
      return runMigrate();
    case 'wait-ready':
      return runWaitReady();
    case 'keys':
      return runKeys();
    case 'keys-env':
      return runKeysEnv();
    case 'delete':
      return runDelete();
    default:
      throw new EphemeralBranchError(
        `Unknown command "${command}". Expected one of: sweep, create, wait-compute-healthy, migrate, wait-ready, keys, keys-env, delete.`,
      );
  }
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      '[e2e-ephemeral-branch] FAILED:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
