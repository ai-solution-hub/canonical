#!/usr/bin/env bun
/**
 * Corpus bucket provisioning, per client project (TECH §3.3 T3, R(a); DR-023).
 *
 * WHY: under the S441 corpus reframe the `corpus` bucket is the DEMOTED
 * (DR-025) kept-evidence store + gated-upload landing zone + optional
 * ingest-once archive — never the canonical layer. Each client's own Supabase
 * project needs exactly one private `corpus` bucket. Follows the
 * `ensureBrandingBucket` precedent verbatim
 * (`scripts/reseed-tenant-instance.ts:167-196`): getBucket → create-if-absent,
 * PRIVATE, idempotent. This script provisions the BUCKET only — it does not
 * write objects into it (that is the {138.12}/{138.13} write-back/upload
 * re-point).
 *
 * Object-key scheme (frozen, R(a) §2.1): callers that later write objects into
 * this bucket key each object as `source_documents.storage_path` verbatim —
 * documented here so every future writer targets the same scheme.
 *
 * Env-isolation guard (§2.6 / {127.20}): provisioning is scoped to the
 * project-ref the caller explicitly declares (`expectedProjectRef`). A
 * mismatch between the client's resolved URL and the declared ref refuses
 * BEFORE any storage call, so a script invoked against a misconfigured env
 * cannot silently create or write a cross-tenant bucket.
 *
 * Idempotent: re-running against an already-provisioned project is a clean
 * no-op (bucket-create skipped when present).
 *
 * CREDENTIALS: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY directly from
 * process.env (service-role bypasses RLS, same posture as
 * reseed-tenant-instance.ts). Does NOT import lib/env-server.ts.
 *
 * Spec: specs/id-138-corpus-durable-home/TECH.md §3.3 T3, §2.1 R(a), §2.6.
 */
import { type SupabaseClient } from '@supabase/supabase-js';

import { createScriptClient } from '@/scripts/lib/supabase-script-client';

/** The corpus bucket name — one per client Supabase project. */
export const CORPUS_BUCKET = 'corpus';

/** Thrown on any provisioning failure — fails loudly, never silent. */
export class ProvisionCorpusBucketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvisionCorpusBucketError';
  }
}

export interface ProvisionCorpusBucketDeps {
  supabase: SupabaseClient;
  /** Supabase URL the client targets — used to derive its project ref. */
  supabaseUrl: string;
  /** Project ref the caller declares as the intended target (env-isolation guard). */
  expectedProjectRef: string;
  log?: (message: string) => void;
}

export interface ProvisionCorpusBucketResult {
  projectRef: string;
  bucketCreated: boolean;
}

/** Project ref is the first label of the Supabase URL host (xxxx.supabase.co). */
export function projectRefFromUrl(url: string): string {
  try {
    return new URL(url).host.split('.')[0];
  } catch {
    return '(unparseable SUPABASE_URL)';
  }
}

/**
 * Provision the private `corpus` bucket on ONE client project, idempotently.
 * Refuses (before touching Storage) unless the client's resolved project ref
 * matches the caller-declared `expectedProjectRef` — the env-isolation guard
 * that stops a cross-tenant write from landing ({127.20}).
 */
export async function provisionCorpusBucket(
  deps: ProvisionCorpusBucketDeps,
): Promise<ProvisionCorpusBucketResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const { supabase, supabaseUrl, expectedProjectRef } = deps;

  const projectRef = projectRefFromUrl(supabaseUrl);
  if (projectRef !== expectedProjectRef) {
    throw new ProvisionCorpusBucketError(
      `Refusing to provision ${CORPUS_BUCKET}: SUPABASE_URL resolves to project ref ` +
        `"${projectRef}", expected "${expectedProjectRef}". Proceeding would risk a ` +
        `cross-tenant write (env-isolation guard, {127.20}).`,
    );
  }

  const bucketCreated = await ensureCorpusBucket(supabase, log);
  log(
    `[provision-corpus-bucket] ${CORPUS_BUCKET} bucket ready on project ${projectRef}.`,
  );
  return { projectRef, bucketCreated };
}

/**
 * Ensure the private `corpus` bucket exists. getBucket → create-if-absent.
 * Idempotent: returns false when the bucket already exists (no error), true
 * when it had to be created. A genuine getBucket error (not a not-found) is
 * fatal. Mirrors `ensureBrandingBucket`
 * (`scripts/reseed-tenant-instance.ts:167-196`).
 */
async function ensureCorpusBucket(
  supabase: SupabaseClient,
  log: (message: string) => void,
): Promise<boolean> {
  const { data: existing, error: getError } =
    await supabase.storage.getBucket(CORPUS_BUCKET);
  if (existing) {
    log(`[provision-corpus-bucket] ${CORPUS_BUCKET} bucket already exists.`);
    return false;
  }
  // getBucket on a missing bucket returns an error (Bucket not found); treat a
  // present-error-but-no-data as "absent" and create. Other errors are fatal.
  if (getError && !/not found/i.test(getError.message)) {
    throw new ProvisionCorpusBucketError(
      `Failed to read ${CORPUS_BUCKET} bucket: ${getError.message}.`,
    );
  }
  const { error: createError } = await supabase.storage.createBucket(
    CORPUS_BUCKET,
    { public: false },
  );
  if (createError) {
    throw new ProvisionCorpusBucketError(
      `Failed to create ${CORPUS_BUCKET} bucket: ${createError.message}.`,
    );
  }
  log(`[provision-corpus-bucket] created private ${CORPUS_BUCKET} bucket.`);
  return true;
}

// ---------------------------------------------------------------------------
// CLI entry point — real service-role client from process.env. PROJECT_REF is
// the operator's declared target (the env-isolation guard input), same free
// variable used by scripts/run-supabase-advisors.ts.
// ---------------------------------------------------------------------------

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new ProvisionCorpusBucketError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to provision the corpus bucket.',
    );
  }
  return createScriptClient(url, key, { auth: { persistSession: false } });
}

// Guard so importing the exported helpers (e.g. from Vitest) does not run any
// side-effect — only direct CLI invocation does.
if (process.argv[1]?.includes('provision-corpus-bucket')) {
  const url = process.env.SUPABASE_URL?.trim();
  const expectedProjectRef = process.env.PROJECT_REF?.trim();
  if (!url || !expectedProjectRef) {
    console.error(
      '[provision-corpus-bucket] SUPABASE_URL and PROJECT_REF must both be set — ' +
        'PROJECT_REF is the env-isolation guard confirming the intended target project.',
    );
    process.exit(1);
  }
  const supabase = createServiceRoleClient();
  provisionCorpusBucket({ supabase, supabaseUrl: url, expectedProjectRef })
    .then((result) => {
      console.log(
        `[provision-corpus-bucket] done — bucketCreated=${result.bucketCreated}, ` +
          `projectRef=${result.projectRef}.`,
      );
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[provision-corpus-bucket] ${message}`);
      process.exit(1);
    });
}
