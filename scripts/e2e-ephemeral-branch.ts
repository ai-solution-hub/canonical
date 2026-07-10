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
 * Management API's branch-object JSON schema (exact field names for id/ref/
 * created_at, and the api-keys response shape) is not fully published in the
 * docs at the time of writing, and this account's `list_branches` MCP tool
 * returned "insufficient privileges" against the Platform-staging project —
 * so none of this could be exercised against a live branch during
 * implementation. `normaliseBranchRecord` / `normaliseApiKeys` are
 * deliberately DEFENSIVE: they try several plausible field-name aliases and,
 * if none match, throw with the ACTUAL top-level keys of the response so the
 * first live run (the orchestrator's post-merge `workflow_dispatch` gate)
 * fails LOUD with an actionable diagnostic instead of silently mis-targeting
 * or hanging. If a live run surfaces a different field name, extend the
 * alias list in the relevant `extractString`/`find` call — do not rewrite
 * the fail-loud shape.
 *
 * `waitForBranchReady` deliberately does NOT poll an undocumented branch
 * `status` enum. Instead it polls the branch's own PostgREST endpoint for
 * `public.application_types` — the table `supabase/seed.sql` §2·0 seeds
 * exactly once, automatically, after all migrations replay on branch
 * creation (per Supabase's documented "Preview Branches are seeded ... The
 * database is only seeded once, when the preview branch is created"
 * behaviour, and per this repo's own seed.sql header: "This file runs ONCE
 * per branch creation, AFTER all migrations apply"). A non-empty read is the
 * concrete signal this slice actually depends on (per PLAN.md {128.10}:
 * "application_types.id is gen_random_uuid(), NOT stable across branches ...
 * the branch MUST be seeded with application_types or every workspace
 * insert throws") — so the readiness probe doubles as an empirical check of
 * that exact assumption, rather than trusting it silently.
 *
 * USAGE (CLI, invoked from the workflow — see `.github/workflows/e2e-nightly.yml`):
 *   bun run scripts/e2e-ephemeral-branch.ts sweep [--max-age-hours=6] [--dry-run]
 *   bun run scripts/e2e-ephemeral-branch.ts create --run-id=<id>
 *   bun run scripts/e2e-ephemeral-branch.ts wait-ready --branch-url=<url> --service-role-key=<key>
 *   bun run scripts/e2e-ephemeral-branch.ts keys --branch-ref=<ref>
 *   bun run scripts/e2e-ephemeral-branch.ts delete --branch-ref=<ref>
 *
 * Required env vars: SUPABASE_ACCESS_TOKEN (Management API PAT), and for
 * sweep/create/keys/delete, PLATFORM_PROJECT_REF (this repo's own Platform
 * staging project — the branch PARENT). Secret-shaped CLI outputs
 * (service-role-key) are emitted via GitHub Actions `::add-mask::` BEFORE
 * being written to `$GITHUB_OUTPUT` — never echoed in plain log lines.
 */

import { appendFileSync } from 'node:fs';

const MANAGEMENT_API = 'https://api.supabase.com';
const DEFAULT_BRANCH_PREFIX = 'e2e-nightly-';
const DEFAULT_MAX_AGE_HOURS = 6;
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
  status?: string;
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
  return { id, ref, name, createdAt, status };
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
}

async function mgmtFetch(
  path: string,
  deps: ManagementApiDeps,
  init?: RequestInit,
): Promise<unknown> {
  const f = deps.fetchImpl ?? fetch;
  const res = await f(`${MANAGEMENT_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${deps.token}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  });
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
    const ageMs = b.createdAt
      ? now - new Date(b.createdAt).getTime()
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
  const res = await f(`${MANAGEMENT_API}/v1/branches/${branchIdOrRef}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${deps.token}` },
  });
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
 * `supabase/seed.sql` §2·0, once, immediately after migrations replay) is
 * readable — see the file-header rationale for why this is the readiness
 * signal instead of an undocumented branch-status enum. Any non-2xx
 * response, an empty result, or a network error is treated as "not ready
 * yet" and retried until `timeoutMs` elapses, at which point it fails loud
 * with the last observed error (never hangs silently).
 */
export async function waitForBranchReady(
  opts: WaitReadyOptions,
): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console.log;
  const now = opts.nowFn ?? Date.now;
  const sleep =
    opts.sleepFn ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const timeoutMs = opts.timeoutMs ?? 12 * 60 * 1000;
  const intervalMs = opts.intervalMs ?? 15_000;
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
    case 'wait-ready':
      return runWaitReady();
    case 'keys':
      return runKeys();
    case 'delete':
      return runDelete();
    default:
      throw new EphemeralBranchError(
        `Unknown command "${command}". Expected one of: sweep, create, wait-ready, keys, delete.`,
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
