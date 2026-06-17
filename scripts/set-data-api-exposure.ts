#!/usr/bin/env bun
/**
 * scripts/set-data-api-exposure.ts
 *
 * Restrict a Supabase project's Data API (PostgREST) to the dedicated `api`
 * schema — PostgREST schema isolation (ID-115). Codifies the {115.13} manual
 * exposed-schemas flip into a repeatable, idempotent provisioning step so a
 * freshly-provisioned client project reaches the fail-closed `public`-unexposed
 * posture with NO manual dashboard click (client-app-deploy.md step 3b.5).
 *
 * Mechanism — Supabase Management API:
 *   PATCH https://api.supabase.com/v1/projects/<ref>/postgrest
 *   body  { db_schema: "api", db_extra_search_path: "public,extensions" }
 *   auth  Bearer SUPABASE_ACCESS_TOKEN
 *
 * The `api` schema (security_invoker views + INVOKER RPC entrypoints) is created
 * by the canonical migration set, so run `supabase db push` FIRST (deploy step
 * 3b) — narrowing exposure to `api` before its objects exist would 404 every
 * read. `public` stays in db_extra_search_path so the security_invoker views
 * resolve their base tables. config.toml `[api] schemas=["api"]` already covers
 * Supabase preview BRANCHES; this script covers standalone managed projects,
 * where config.toml is not applied on db push.
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. Pass --apply to write. Without it, prints the planned
 *     change (current db_schema → "api") and exits 0.
 *   - Idempotent: if already isolated to "api", prints and exits 0 (no PATCH).
 *   - Prints the resolved project ref before any write so the operator confirms
 *     the target (staging vs prod vs platform — the .temp/project-ref drift
 *     class flagged in CLAUDE.md).
 *   - Fail-loud: any non-2xx Management API response throws (exit 1); a PATCH
 *     that does not land "api" throws.
 *   - No client literal — the ref is an opaque project id (denylist-safe).
 *
 * REVERSAL (instant): re-expose by PATCHing db_schema back to
 *   "public,graphql_public,api".
 *
 * USAGE:
 *   SUPABASE_ACCESS_TOKEN=<tok> bun run scripts/set-data-api-exposure.ts --ref=<ref>           # dry-run
 *   SUPABASE_ACCESS_TOKEN=<tok> bun run scripts/set-data-api-exposure.ts --ref=<ref> --apply   # write
 *   # ref may instead be derived from SUPABASE_URL (xxxx.supabase.co):
 *   SUPABASE_URL=<url> SUPABASE_ACCESS_TOKEN=<tok> bun run scripts/set-data-api-exposure.ts --apply
 */

const MANAGEMENT_API = 'https://api.supabase.com';
/** The single exposed Data API schema after PostgREST isolation (ID-115). */
const ISOLATED_SCHEMA = 'api';
/** security_invoker views resolve `public.*` base tables via the search path. */
const FALLBACK_SEARCH_PATH = 'public,extensions';

export class DataApiExposureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataApiExposureError';
  }
}

export interface PostgrestConfig {
  db_schema: string;
  db_extra_search_path: string;
  max_rows: number;
}

export interface SetExposureOptions {
  ref: string;
  token: string;
  apply: boolean;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable for tests; defaults to console.log. */
  log?: (msg: string) => void;
}

export interface SetExposureResult {
  changed: boolean;
  before: string;
  after: string;
}

async function getPostgrestConfig(
  ref: string,
  token: string,
  f: typeof fetch,
): Promise<PostgrestConfig> {
  const res = await f(`${MANAGEMENT_API}/v1/projects/${ref}/postgrest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new DataApiExposureError(
      `GET /postgrest failed for ${ref}: HTTP ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as PostgrestConfig;
}

/**
 * Idempotently narrow a project's Data API exposed schemas to `api` only.
 * Returns whether a write happened plus the before/after db_schema values.
 */
export async function setDataApiExposure(
  opts: SetExposureOptions,
): Promise<SetExposureResult> {
  const f = opts.fetchImpl ?? fetch;
  const log = opts.log ?? console.log;

  const current = await getPostgrestConfig(opts.ref, opts.token, f);
  const before = current.db_schema;
  log(`[set-data-api-exposure] project ref      : ${opts.ref}`);
  log(`[set-data-api-exposure] current db_schema : ${before}`);

  if (before.trim() === ISOLATED_SCHEMA) {
    log(
      `[set-data-api-exposure] already isolated to "${ISOLATED_SCHEMA}" — no change.`,
    );
    return { changed: false, before, after: before };
  }

  // Keep `public` in the search path (security_invoker views need it) — only
  // substitute the default when the current value has somehow dropped it.
  const searchPath = current.db_extra_search_path?.includes('public')
    ? current.db_extra_search_path
    : FALLBACK_SEARCH_PATH;

  log(
    `[set-data-api-exposure] target db_schema  : ${ISOLATED_SCHEMA} (extra_search_path: ${searchPath})`,
  );

  if (!opts.apply) {
    log(
      `\n[set-data-api-exposure] DRY-RUN — no write. Re-run with --apply to isolate ${opts.ref}.`,
    );
    return { changed: false, before, after: ISOLATED_SCHEMA };
  }

  const res = await f(`${MANAGEMENT_API}/v1/projects/${opts.ref}/postgrest`, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${opts.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      db_schema: ISOLATED_SCHEMA,
      db_extra_search_path: searchPath,
    }),
  });
  if (!res.ok) {
    throw new DataApiExposureError(
      `PATCH /postgrest failed for ${opts.ref}: HTTP ${res.status} ${await res.text()}`,
    );
  }
  const updated = (await res.json()) as PostgrestConfig;
  if (updated.db_schema.trim() !== ISOLATED_SCHEMA) {
    throw new DataApiExposureError(
      `PATCH applied but db_schema is "${updated.db_schema}", expected "${ISOLATED_SCHEMA}".`,
    );
  }
  log(
    `[set-data-api-exposure] APPLIED — db_schema is now "${updated.db_schema}".`,
  );
  return { changed: true, before, after: updated.db_schema };
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
}

function refFromUrl(url: string): string | undefined {
  try {
    return new URL(url).host.split('.')[0];
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const token = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (!token) {
    throw new DataApiExposureError(
      'SUPABASE_ACCESS_TOKEN is required (Supabase Management API token).',
    );
  }
  const ref =
    parseArg('ref') ??
    (process.env.SUPABASE_URL
      ? refFromUrl(process.env.SUPABASE_URL.trim())
      : undefined);
  if (!ref) {
    throw new DataApiExposureError(
      'No project ref. Pass --ref=<ref> or set SUPABASE_URL.',
    );
  }
  const apply = process.argv.includes('--apply');
  await setDataApiExposure({ ref, token, apply });
}

if (import.meta.main) {
  main().catch((err) => {
    console.error(
      '[set-data-api-exposure] FAILED:',
      err instanceof Error ? err.message : err,
    );
    process.exit(1);
  });
}
