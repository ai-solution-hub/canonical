#!/usr/bin/env bun
/**
 * Build-time fetch of per-client branding/config from public.tenant_config
 * (TECH §T-B, PI-11 / PI-2 / AC-E3).
 *
 * WHY: a client deploy keeps its branding document + assets in its OWN Supabase
 * project (public.tenant_config.config jsonb + the private `branding` Storage
 * bucket), NOT in tracked source. This script runs in BOTH `prebuild` and
 * `build:vercel`, BEFORE `generate:branding`, and hydrates the files that
 * codegen then globs:
 *   - lib/branding/clients/<id>.json  (the config document, written verbatim)
 *   - public/clients/<id>/<asset>     (each downloaded bucket object)
 * The existing codegen (scripts/generate-client-branding-map.ts), loader
 * (loadBranding) and contrast gate run UNCHANGED — this script only writes the
 * inputs they already consume.
 *
 * CREDENTIALS (TECH §T-B): reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 * DIRECTLY from process.env. It MUST NOT import lib/env-server.ts: that Zod
 * schema declares SUPABASE_SERVICE_ROLE_KEY required (min(1)) and would
 * hard-fail the platform/control `default` build, where the key is legitimately
 * absent — precisely the fail-closed no-op case (CASE 1).
 *
 * FAIL-CLOSED BOTH WAYS (PI-11):
 *   CASE 1 — control build (id === 'default' OR url/key absent): no-op, exit 0.
 *            The tracked default.json (and any tracked client file) is left
 *            untouched; loadBranding resolves 'default'; the build stays GREEN.
 *   CASE 2 — client build (id !== 'default' AND url AND key present): fetch the
 *            single tenant_config row + download branding/<id>/* via the
 *            service-role client. If there is no row / no branding document /
 *            any Storage or PostgREST error: THROW — the build FAILS loudly
 *            (S196 analogue: never silently ship a default-branded client
 *            deploy). On success: write <id>.json + assets, then exit 0.
 *
 * Spec: specs/id-95-per-client-topology/TECH.md §T-B.
 */
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  assertBrandAssetsExist,
  BrandingConfigSchema,
  validateBrandingContrast,
  type BrandingConfig,
} from '@/lib/client-config';

const DEFAULT_CLIENT_ID = 'default';
const TENANT_CONFIG_TABLE = 'tenant_config';
const BRANDING_BUCKET = 'branding';

/** Thrown to FAIL the build in CASE 2. Caught only by the CLI entry point. */
export class FetchClientBrandingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FetchClientBrandingError';
  }
}

/** Environment slice the fetch keys off — read directly from process.env. */
export interface FetchClientBrandingEnv {
  clientId: string | undefined;
  supabaseUrl: string | undefined;
  serviceRoleKey: string | undefined;
}

/** Filesystem writers — injected so tests assert without touching disk. */
export interface BrandingWriters {
  /** Write the validated branding document JSON to lib/branding/clients/<id>.json. */
  writeBrandingJson: (clientId: string, json: string) => Promise<void>;
  /** Write one downloaded asset to public/clients/<id>/<assetName>. */
  writeAsset: (
    clientId: string,
    assetName: string,
    bytes: Uint8Array,
  ) => Promise<void>;
}

/** Bounded-retry tuning for the Storage list/download calls (PI-11 fail-closed). */
export interface StorageRetryOptions {
  /** Total attempts including the first (default 3). */
  attempts: number;
  /** Base backoff in ms between attempts (default 250; linear). */
  backoffMs: number;
  /** Sleep seam — overridden in tests to avoid real waits. */
  sleep: (ms: number) => Promise<void>;
}

const DEFAULT_STORAGE_RETRY: StorageRetryOptions = {
  attempts: 3,
  backoffMs: 250,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Dependencies injected into the pure fetch core (testable seam). */
export interface FetchClientBrandingDeps {
  env: FetchClientBrandingEnv;
  /** Build a service-role Supabase client from url + key (real impl in main()). */
  createSupabaseClient: (url: string, key: string) => SupabaseClient;
  writers: BrandingWriters;
  /** Structured logger (defaults to console). */
  log?: (message: string) => void;
  /** Bounded retry for transient Storage failures (defaults to DEFAULT_STORAGE_RETRY). */
  storageRetry?: Partial<StorageRetryOptions>;
}

/**
 * Run a Supabase Storage call with a small bounded retry. A transient failure
 * surfaces EITHER as a rejected promise (e.g. a Gateway Timeout) OR as a
 * resolved `{ data, error }` carrying an error — retry on both. On exhaustion
 * the LAST result is returned UNCHANGED (or the last thrown error re-thrown):
 * the caller's existing error check then throws, so PI-11 fail-closed is
 * preserved — we never swallow a final failure into a silent no-op.
 */
async function withStorageRetry<
  T extends { error: { message: string } | null },
>(
  label: string,
  call: () => Promise<T>,
  options: StorageRetryOptions,
  log: (message: string) => void,
): Promise<T> {
  const attempts = Math.max(1, options.attempts);
  let lastResult: T | undefined;
  let lastThrown: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await call();
      if (!result.error) return result;
      lastResult = result;
      lastThrown = undefined;
    } catch (err) {
      lastThrown = err;
      lastResult = undefined;
    }
    if (attempt < attempts) {
      const reason =
        lastResult?.error?.message ??
        (lastThrown instanceof Error ? lastThrown.message : String(lastThrown));
      log(
        `[fetch-client-branding] transient Storage failure on ${label} (attempt ${attempt}/${attempts}): ${reason} — retrying.`,
      );
      await options.sleep(options.backoffMs * attempt);
    }
  }
  // Exhausted: re-throw the last thrown error, or return the last error-bearing
  // result so the caller's check throws (fail-closed — never a silent no-op).
  if (lastResult !== undefined) return lastResult;
  throw lastThrown;
}

export type FetchClientBrandingResult =
  | { status: 'noop'; reason: 'default-client' | 'missing-credentials' }
  | {
      status: 'written';
      clientId: string;
      assetCount: number;
      branding: BrandingConfig;
    };

/**
 * Core fetch logic. Pure over its injected deps — no direct process.env, no
 * direct disk, no direct network — so both fail-closed branches and the happy
 * path are unit-testable with a mocked Supabase client.
 */
export async function runClientBrandingFetch(
  deps: FetchClientBrandingDeps,
): Promise<FetchClientBrandingResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const retry: StorageRetryOptions = {
    ...DEFAULT_STORAGE_RETRY,
    ...deps.storageRetry,
  };
  const id = deps.env.clientId?.trim() || DEFAULT_CLIENT_ID;
  const url = deps.env.supabaseUrl?.trim();
  const key = deps.env.serviceRoleKey?.trim();

  // CASE 1 — control build: default client OR absent creds → no-op, exit 0.
  if (id === DEFAULT_CLIENT_ID) {
    log(
      `[fetch-client-branding] NEXT_PUBLIC_CLIENT_ID is "${DEFAULT_CLIENT_ID}" — no-op (default branding, build proceeds).`,
    );
    return { status: 'noop', reason: 'default-client' };
  }
  if (!url || !key) {
    log(
      `[fetch-client-branding] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY absent for client "${id}" — no-op (no credentials, build proceeds with tracked branding).`,
    );
    return { status: 'noop', reason: 'missing-credentials' };
  }

  // CASE 2 — client build: fetch the single tenant_config row via service role.
  const supabase = deps.createSupabaseClient(url, key);

  const { data: row, error: rowError } = await supabase
    .from(TENANT_CONFIG_TABLE)
    .select('config')
    .limit(1)
    .maybeSingle();

  if (rowError) {
    throw new FetchClientBrandingError(
      `Failed to read ${TENANT_CONFIG_TABLE} for client "${id}": ${rowError.message}. ` +
        `A "${id}" build must not silently fall back to default branding (S196 analogue).`,
    );
  }
  if (!row || row.config == null) {
    throw new FetchClientBrandingError(
      `No ${TENANT_CONFIG_TABLE} row for client "${id}" (or config is null). ` +
        `Seed the config document via scripts/reseed-tenant-instance.ts before building. ` +
        `Refusing to ship a default-branded "${id}" deploy (PI-11 fail-closed).`,
    );
  }

  // Validate the document against the SAME schema + contrast gate the loader
  // uses at build time, so a malformed config fails here rather than later.
  let branding: BrandingConfig;
  try {
    branding = BrandingConfigSchema.parse(row.config);
  } catch (err) {
    throw new FetchClientBrandingError(
      `${TENANT_CONFIG_TABLE}.config for client "${id}" failed BrandingConfigSchema validation: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const contrast = validateBrandingContrast(branding);
  if (contrast.errors.length > 0) {
    throw new FetchClientBrandingError(
      `Branding contrast validation FAILED for client "${id}":\n  - ${contrast.errors.join(
        '\n  - ',
      )}`,
    );
  }
  for (const warning of contrast.warnings) {
    log(`[fetch-client-branding] contrast warning (${id}): ${warning}`);
  }

  // Write the validated config document verbatim — the codegen glob + loader
  // pick it up unchanged on the next prebuild step.
  await deps.writers.writeBrandingJson(
    id,
    `${JSON.stringify(branding, null, 2)}\n`,
  );

  // Download the branding bucket assets under branding/<id>/* and write each to
  // public/clients/<id>/<asset>. A Storage error here is fatal (no silent skip).
  const bucket = supabase.storage.from(BRANDING_BUCKET);
  const { data: objects, error: listError } = await withStorageRetry(
    `list ${BRANDING_BUCKET}/${id}`,
    () => bucket.list(id),
    retry,
    log,
  );
  if (listError) {
    throw new FetchClientBrandingError(
      `Failed to list ${BRANDING_BUCKET}/${id} for client "${id}": ${listError.message}.`,
    );
  }

  let assetCount = 0;
  for (const object of objects ?? []) {
    if (!object.name) continue;
    const objectPath = `${id}/${object.name}`;
    const { data: blob, error: downloadError } = await withStorageRetry(
      `download ${BRANDING_BUCKET}/${objectPath}`,
      () => bucket.download(objectPath),
      retry,
      log,
    );
    if (downloadError || !blob) {
      throw new FetchClientBrandingError(
        `Failed to download ${BRANDING_BUCKET}/${objectPath} for client "${id}": ${
          downloadError?.message ?? 'no data returned'
        }.`,
      );
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    await deps.writers.writeAsset(id, object.name, bytes);
    assetCount += 1;
  }

  log(
    `[fetch-client-branding] wrote lib/branding/clients/${id}.json and ${assetCount} asset${
      assetCount === 1 ? '' : 's'
    } to public/clients/${id}/.`,
  );
  return { status: 'written', clientId: id, assetCount, branding };
}

// ---------------------------------------------------------------------------
// CLI entry point — real process.env, real Supabase client, real disk writers.
// ---------------------------------------------------------------------------

/** Disk-backed writers used by the CLI (kept out of the testable core). */
function diskWriters(): BrandingWriters {
  return {
    async writeBrandingJson(clientId, json) {
      const dir = join(process.cwd(), 'lib', 'branding', 'clients');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${clientId}.json`), json, 'utf-8');
    },
    async writeAsset(clientId, assetName, bytes) {
      const dir = join(process.cwd(), 'public', 'clients', clientId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, assetName), bytes);
    },
  };
}

async function main(): Promise<void> {
  const result = await runClientBrandingFetch({
    env: {
      clientId: process.env.NEXT_PUBLIC_CLIENT_ID,
      supabaseUrl: process.env.SUPABASE_URL,
      serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    },
    createSupabaseClient: (url, key) =>
      createScriptClient(url, key, { auth: { persistSession: false } }),
    writers: diskWriters(),
  });
  if (result.status === 'noop') {
    process.exit(0);
  }
  // status === 'written' — verify the referenced assets actually landed on disk
  // (fail-closed at BUILD time, AFTER download). Deliberately NOT in
  // loadBranding(): that also runs at `next start`, where a missing asset must
  // degrade to a 404 on that asset, never crash every route at module-eval.
  assertBrandAssetsExist(result.branding);
}

// Guard so importing the exported helpers (e.g. from Vitest) does not run the
// fetch side-effect — only direct CLI invocation does.
if (process.argv[1]?.includes('fetch-client-branding')) {
  main().catch((err) => {
    console.error('[fetch-client-branding] FAILED:', err);
    process.exit(1);
  });
}
