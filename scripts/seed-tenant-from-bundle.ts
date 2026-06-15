#!/usr/bin/env bun
/**
 * CLI runner for the per-instance re-seed manifest (the operator seam that
 * scripts/reseed-tenant-instance.ts deliberately leaves unwired — TECH §T-C /
 * §T-E, OQ-6 replay half; advances {95.14}).
 *
 * WHAT: assembles a ReseedManifest from the tracked client branding bundle and
 * applies it (signup_policy + tenant_config + branding bucket/assets) against
 * the project selected by process.env SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
 * This is the pre-untrack bridge: the "durable master" is the tracked
 * lib/branding/clients/<id>.json + public/clients/<id>/* bundle. Post-untrack
 * ({68.22}) the master moves to the external operator archive — same manifest
 * shape, different source (the proper {95.14} restore path).
 *
 * (Filename deliberately avoids the substring "reseed-tenant-instance" so the
 * imported module's CLI side-effect guard does not fire on import.)
 *
 * NO CLIENT LITERAL: the client id is DISCOVERED by globbing
 * lib/branding/clients/*.json minus default.json (exactly one expected), so no
 * client name enters this file or the invoking command (denylist-safe).
 *
 * SAFETY:
 *   - DRY-RUN BY DEFAULT. Pass --apply to write. Without it, prints the plan
 *     (target project ref, client id, asset list, signup domain) and exits 0.
 *   - signup_policy.allowed_domain is PRESERVED: read from the target first and
 *     re-applied verbatim (idempotent). Override only with --allowed-domain.
 *   - Prints the resolved project ref before any write so the operator can
 *     confirm the target (staging vs prod vs platform).
 *
 * USAGE:
 *   # staging (creds from .env.local):
 *   bun run scripts/seed-tenant-from-bundle.ts            # dry-run
 *   bun run scripts/seed-tenant-from-bundle.ts --apply    # write
 *
 *   # prod (operator supplies creds inline — never stored):
 *   SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> \
 *     bun run scripts/seed-tenant-from-bundle.ts --apply
 */
import { readFile, readdir } from 'fs/promises';
import { basename, extname, join } from 'path';
import {
  createServiceRoleClient,
  reseedTenantInstance,
  ReseedTenantInstanceError,
  type BrandingAsset,
  type ReseedManifest,
} from './reseed-tenant-instance';

const CLIENTS_DIR = join(process.cwd(), 'lib', 'branding', 'clients');
const PUBLIC_CLIENTS_DIR = join(process.cwd(), 'public', 'clients');
const DEFAULT_CLIENT_ID = 'default';
const SIGNUP_POLICY_TABLE = 'signup_policy';

const CONTENT_TYPES: Record<string, string> = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
};

/** Discover the single non-default client id from the tracked branding bundle. */
async function discoverClientId(): Promise<string> {
  const entries = await readdir(CLIENTS_DIR);
  const clientIds = entries
    .filter((f) => f.endsWith('.json'))
    .map((f) => basename(f, '.json'))
    .filter((id) => id !== DEFAULT_CLIENT_ID);
  if (clientIds.length === 0) {
    throw new ReseedTenantInstanceError(
      `No non-default client config found in ${CLIENTS_DIR}. Nothing to seed.`,
    );
  }
  if (clientIds.length > 1) {
    throw new ReseedTenantInstanceError(
      `Expected exactly one non-default client config in ${CLIENTS_DIR}, found ${clientIds.length}: ${clientIds.join(
        ', ',
      )}. Disambiguation not yet supported — seed one project at a time.`,
    );
  }
  return clientIds[0];
}

/** Load lib/branding/clients/<id>.json as the tenant_config document. */
async function loadConfig(clientId: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(CLIENTS_DIR, `${clientId}.json`), 'utf-8');
  const config = JSON.parse(raw) as Record<string, unknown>;
  if (config.clientId !== clientId) {
    throw new ReseedTenantInstanceError(
      `Config clientId "${String(
        config.clientId,
      )}" does not match file stem "${clientId}".`,
    );
  }
  return config;
}

/** Load every asset under public/clients/<id>/ for the branding bucket. */
async function loadAssets(clientId: string): Promise<BrandingAsset[]> {
  const dir = join(PUBLIC_CLIENTS_DIR, clientId);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    throw new ReseedTenantInstanceError(
      `Asset directory ${dir} not found — cannot seed branding assets.`,
    );
  }
  const assets: BrandingAsset[] = [];
  for (const name of entries) {
    const bytes = new Uint8Array(await readFile(join(dir, name)));
    assets.push({
      name,
      bytes,
      contentType: CONTENT_TYPES[extname(name).toLowerCase()],
    });
  }
  if (assets.length === 0) {
    throw new ReseedTenantInstanceError(
      `No asset files in ${dir} — a branded build needs at least a logo + favicon.`,
    );
  }
  return assets;
}

/** Project ref is the first label of the Supabase URL host (xxxx.supabase.co). */
function projectRefFromUrl(url: string): string {
  try {
    return new URL(url).host.split('.')[0];
  } catch {
    return '(unparseable SUPABASE_URL)';
  }
}

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit?.slice(prefix.length);
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const overrideDomain = parseArg('allowed-domain');

  const clientId = await discoverClientId();
  const [config, assets] = await Promise.all([
    loadConfig(clientId),
    loadAssets(clientId),
  ]);

  const supabase = createServiceRoleClient(); // throws if creds absent
  const ref = projectRefFromUrl(process.env.SUPABASE_URL!.trim());

  // Preserve the existing signup domain unless explicitly overridden.
  let allowedDomain = overrideDomain;
  if (!allowedDomain) {
    const { data, error } = await supabase
      .from(SIGNUP_POLICY_TABLE)
      .select('allowed_domain')
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new ReseedTenantInstanceError(
        `Could not read existing ${SIGNUP_POLICY_TABLE}.allowed_domain: ${error.message}. ` +
          `Pass --allowed-domain=<domain> to set it explicitly.`,
      );
    }
    allowedDomain = (data?.allowed_domain as string | undefined) ?? undefined;
    if (!allowedDomain) {
      throw new ReseedTenantInstanceError(
        `No existing ${SIGNUP_POLICY_TABLE} row and no --allowed-domain provided. ` +
          `Refusing to guess the sign-up domain.`,
      );
    }
  }

  const manifest: ReseedManifest = {
    clientId,
    allowedDomain,
    config,
    assets,
  };

  console.log(`[seed-tenant] target project ref : ${ref}`);
  console.log(`[seed-tenant] client id          : ${clientId}`);
  console.log(`[seed-tenant] signup domain       : ${allowedDomain}`);
  console.log(
    `[seed-tenant] assets (${assets.length})         : ${assets
      .map((a) => a.name)
      .join(', ')}`,
  );

  if (!apply) {
    console.log(
      `\n[seed-tenant] DRY-RUN — no writes. Re-run with --apply to seed ${ref}.`,
    );
    return;
  }

  console.log(`\n[seed-tenant] APPLYING manifest to ${ref} …`);
  const result = await reseedTenantInstance({ supabase, manifest });
  console.log(`[seed-tenant] done:`, JSON.stringify(result));
}

main().catch((err) => {
  console.error('[seed-tenant] FAILED:', err);
  process.exit(1);
});
