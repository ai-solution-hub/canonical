#!/usr/bin/env bun
/**
 * Per-instance re-seed manifest writer (TECH §T-C, PI-20).
 *
 * WHY: signup_policy, tenant_config, and the private `branding` Storage bucket
 * objects are all per-instance DATA (PI-7/PI-10), never committed in a
 * migration. Any DB recut producing a fresh data state (ID-45 cutover, a
 * recut-to-new-project) wipes all three. PI-20 requires them re-applied
 * together as ONE idempotent manifest. This script is the REPLAY half of OQ-6:
 * the durable master (control plane / operator archive) is the system-of-record;
 * this script restores it into a fresh project.
 *
 * This is a DATA/config step, NOT DDL. It performs three idempotent operations
 * against ONE project (selected by the caller's service-role url + key):
 *   1. signup_policy row  — upsert allowed_domain ON CONFLICT (id).
 *   2. tenant_config row  — upsert config jsonb ON CONFLICT (id), bump updated_at.
 *   3. branding bucket     — ensure the private `branding` bucket exists
 *                            (create-if-absent), then upsert each asset to
 *                            branding/<id>/<file>. Buckets are config-as-data,
 *                            NEVER a migration (TECH §T-A(d)).
 *
 * Idempotent: re-running against an already-seeded project is a clean no-op-ish
 * upsert (no duplicate-row error, bucket-create skipped when present).
 *
 * NO client literal: the per-instance values (:domain, :config, :assets) come
 * from an out-of-band input (the durable master), never from tracked source —
 * same config-as-data property as the signup_policy out-of-band INSERT.
 *
 * CREDENTIALS: reads SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY directly from
 * process.env (service-role bypasses RLS). Does NOT import lib/env-server.ts.
 *
 * Spec: specs/id-95-per-client-topology/TECH.md §T-C.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SIGNUP_POLICY_TABLE = 'signup_policy';
const TENANT_CONFIG_TABLE = 'tenant_config';
const BRANDING_BUCKET = 'branding';

/** Thrown on any operation failure — the manifest fails loudly, never silent. */
export class ReseedTenantInstanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReseedTenantInstanceError';
  }
}

/** One branding asset to upload to branding/<clientId>/<name>. */
export interface BrandingAsset {
  name: string;
  bytes: Uint8Array;
  contentType?: string;
}

/** The per-instance input — sourced out-of-band from the durable master. */
export interface ReseedManifest {
  /** Client id — the Storage object prefix (branding/<clientId>/*). */
  clientId: string;
  /** Allowed sign-up email domain for signup_policy (PI-20 fail-closed gate). */
  allowedDomain: string;
  /** The whole BrandingConfigSchema-shaped client document for tenant_config. */
  config: Record<string, unknown>;
  /** Branding asset binaries for the bucket. */
  assets: BrandingAsset[];
}

export interface ReseedTenantInstanceDeps {
  supabase: SupabaseClient;
  manifest: ReseedManifest;
  log?: (message: string) => void;
}

export interface ReseedTenantInstanceResult {
  signupPolicyUpserted: boolean;
  tenantConfigUpserted: boolean;
  bucketCreated: boolean;
  assetsUploaded: number;
}

/**
 * Apply the three-part re-seed manifest idempotently against one project.
 * Pure over its injected Supabase client + manifest so the upserts and the
 * bucket-ensure are unit-testable without a live DB.
 */
export async function reseedTenantInstance(
  deps: ReseedTenantInstanceDeps,
): Promise<ReseedTenantInstanceResult> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const { supabase, manifest } = deps;
  const { clientId } = manifest;

  // 1. signup_policy — upsert the allowed sign-up domain (singleton id = true).
  const { error: signupError } = await supabase
    .from(SIGNUP_POLICY_TABLE)
    .upsert(
      { id: true, allowed_domain: manifest.allowedDomain },
      { onConflict: 'id' },
    );
  if (signupError) {
    throw new ReseedTenantInstanceError(
      `Failed to upsert ${SIGNUP_POLICY_TABLE}: ${signupError.message}.`,
    );
  }
  log(
    `[reseed-tenant-instance] upserted ${SIGNUP_POLICY_TABLE} allowed_domain.`,
  );

  // 2. tenant_config — upsert the config document (singleton id = true),
  //    bumping updated_at so a recut keeps an honest mtime.
  const { error: configError } = await supabase
    .from(TENANT_CONFIG_TABLE)
    .upsert(
      {
        id: true,
        config: manifest.config,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'id' },
    );
  if (configError) {
    throw new ReseedTenantInstanceError(
      `Failed to upsert ${TENANT_CONFIG_TABLE}: ${configError.message}.`,
    );
  }
  log(`[reseed-tenant-instance] upserted ${TENANT_CONFIG_TABLE} config.`);

  // 3. branding bucket — ensure the private bucket exists (create-if-absent),
  //    then upsert each asset to branding/<clientId>/<name>.
  const bucketCreated = await ensureBrandingBucket(supabase, log);

  let assetsUploaded = 0;
  const bucket = supabase.storage.from(BRANDING_BUCKET);
  for (const asset of manifest.assets) {
    const path = `${clientId}/${asset.name}`;
    const { error: uploadError } = await bucket.upload(path, asset.bytes, {
      upsert: true,
      contentType: asset.contentType,
    });
    if (uploadError) {
      throw new ReseedTenantInstanceError(
        `Failed to upload ${BRANDING_BUCKET}/${path}: ${uploadError.message}.`,
      );
    }
    assetsUploaded += 1;
  }
  log(
    `[reseed-tenant-instance] uploaded ${assetsUploaded} asset${
      assetsUploaded === 1 ? '' : 's'
    } to ${BRANDING_BUCKET}/${clientId}/.`,
  );

  return {
    signupPolicyUpserted: true,
    tenantConfigUpserted: true,
    bucketCreated,
    assetsUploaded,
  };
}

/**
 * Ensure the private `branding` bucket exists. getBucket → create-if-absent.
 * Idempotent: returns false when the bucket already exists (no error), true
 * when it had to be created. A genuine getBucket error (not a not-found) is
 * fatal.
 */
async function ensureBrandingBucket(
  supabase: SupabaseClient,
  log: (message: string) => void,
): Promise<boolean> {
  const { data: existing, error: getError } =
    await supabase.storage.getBucket(BRANDING_BUCKET);
  if (existing) {
    log(`[reseed-tenant-instance] ${BRANDING_BUCKET} bucket already exists.`);
    return false;
  }
  // getBucket on a missing bucket returns an error (Bucket not found); treat a
  // present-error-but-no-data as "absent" and create. Other roles never reach
  // here (service-role only).
  if (getError && !/not found/i.test(getError.message)) {
    throw new ReseedTenantInstanceError(
      `Failed to read ${BRANDING_BUCKET} bucket: ${getError.message}.`,
    );
  }
  const { error: createError } = await supabase.storage.createBucket(
    BRANDING_BUCKET,
    { public: false },
  );
  if (createError) {
    throw new ReseedTenantInstanceError(
      `Failed to create ${BRANDING_BUCKET} bucket: ${createError.message}.`,
    );
  }
  log(`[reseed-tenant-instance] created private ${BRANDING_BUCKET} bucket.`);
  return true;
}

// ---------------------------------------------------------------------------
// CLI entry point — real service-role client from process.env. The per-instance
// manifest values are loaded by the operator from the durable master; this CLI
// stub constructs the client and is the seam the operator wires the manifest
// loader into. It deliberately does NOT embed any client value.
// ---------------------------------------------------------------------------

export function createServiceRoleClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new ReseedTenantInstanceError(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set to run the re-seed manifest.',
    );
  }
  return createClient(url, key, { auth: { persistSession: false } });
}

// Guard so importing the exported helpers (e.g. from Vitest) does not run any
// side-effect — only direct CLI invocation does.
if (process.argv[1]?.includes('reseed-tenant-instance')) {
  console.error(
    '[reseed-tenant-instance] This script exposes reseedTenantInstance(deps); ' +
      'the operator supplies the per-instance manifest from the durable master ' +
      '(TECH §T-C / §T-E). No client values are embedded here.',
  );
  process.exit(1);
}
