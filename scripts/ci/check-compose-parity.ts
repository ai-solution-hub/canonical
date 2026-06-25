#!/usr/bin/env bun
/**
 * Compose structural-parity guard — asserts the Platform PRODUCTION ingestion
 * compose (deploy/coolify/docker-compose.platform.yaml) still conforms to the
 * shared cocoindex service structural template (ID-127 BI-15 Change B; TECH.md
 * §BI-15 Change B).
 *
 * WHY THIS EXISTS:
 *   The Platform-production and Platform-staging composes are clones that share
 *   a single structural template for their cocoindex service block. Only
 *   env-scoped values legitimately differ between them (container/volume/router
 *   names, the Traefik Host DNS, the -staging suffix). The STRUCTURE — the
 *   hard-fail image-tag form, the LMDB engine-store wiring, the Traefik
 *   path-scope, the healthcheck probe, and the env keyset — is a contract. If a
 *   future edit to the platform-production compose silently drops the
 *   `${COCOINDEX_IMAGE_TAG:?}` hard-fail (regressing to `:latest`), narrows the
 *   `/walk + /health + /extract` Traefik scope, breaks the LMDB path, or drops a
 *   required env key, the deploy ships broken. This guard SURFACES that drift on
 *   a push to main rather than letting it ship silently.
 *
 * POSTURE — WARN-ONLY / NON-REQUIRED (mirrors the token-parity guard, ID-114):
 *   This guard exits non-zero on drift, but its workflow
 *   (.github/workflows/compose-parity.yml) is intentionally NOT a required check
 *   and is NOT listed in ci.yml. It runs on push to main (path-filtered) and on
 *   demand via workflow_dispatch — a build-time warning, not a merge gate. v1 is
 *   deliberately advisory: it raises a visible signal, an operator decides.
 *
 * WHAT IT CHECKS (the cocoindex service block of the platform-production compose):
 *   1. image           — the ghcr.io/<owner>/kh-cocoindex-pipeline path pinned via
 *                        the ${COCOINDEX_IMAGE_TAG:?...} HARD-FAIL form (never
 *                        :latest, never the soft :- default form).
 *   2. COCOINDEX_DB    — the engine LMDB state-store wired to /cocoindex-state/lmdb.
 *   3. Traefik scope   — the router rule path-scoped to EXACTLY /walk + /health +
 *                        /extract (and NOT /stage — Inv-13 keeps /stage internal).
 *   4. healthcheck     — the bash /dev/tcp/127.0.0.1/8080 liveness probe with the
 *                        interval / timeout / retries / start_period quartet.
 *   5. env keyset      — every required environment key is present.
 *
 * NOTE: the `.never-auto-deploy-sentinel` is a Coolify SETTING handled in
 * ID-127.11 — explicitly NOT in scope for this structural guard.
 *
 * Exit codes (CLI mode):
 *   0 — the platform-production cocoindex block conforms to the template.
 *   1 — drift detected; a per-divergence report is printed on stderr.
 *
 * Wiring:
 *   - CI: invoked from .github/workflows/compose-parity.yml on push to main
 *     (path-filtered to deploy/coolify/** + this script + the workflow).
 *   - Local: `bun run scripts/ci/check-compose-parity.ts`.
 *
 * Spec source: TECH.md §BI-15 Change B (ID-127).
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

/**
 * The required environment keyset every cocoindex service block must declare.
 * Order is fixed for stable assertion output. These are the structural keys —
 * boot-required wiring plus the Supabase/API secret refs — that both the
 * platform-production and platform-staging composes share.
 */
export const REQUIRED_ENV_KEYS = [
  'COCOINDEX_DB_DSN',
  'COCOINDEX_DB',
  'COCOINDEX_SOURCE_PATH',
  'COCOINDEX_LMDB_MAP_SIZE',
  'PIPELINE_RUN_WEBHOOK_URL',
  'CRON_SECRET',
  'EXTRACT_API_TOKEN',
  'IMAGE_SHA',
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'SUPABASE_URL',
  'SUPABASE_PUBLISHABLE_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_APP_URL',
  'SENTRY_AUTH_TOKEN',
] as const;

/**
 * The exact Traefik path-prefix scope the router rule must expose. Anything
 * narrower (dropping /extract) or wider (adding /stage) is drift — the scope IS
 * the public-exposure guard (Inv-13).
 */
export const REQUIRED_TRAEFIK_PATHS = ['/walk', '/health', '/extract'] as const;

/** The LMDB engine state-store mount path COCOINDEX_DB must point at. */
export const COCOINDEX_DB_PATH = '/cocoindex-state/lmdb';

/** The container port the Traefik service + healthcheck probe target. */
export const COCOINDEX_PORT = '8080';

export interface ComposeDrift {
  check:
    | 'service-block'
    | 'image-tag-hardfail'
    | 'cocoindex-db'
    | 'traefik-scope'
    | 'healthcheck'
    | 'env-keyset';
  message: string;
}

/**
 * The minimal compose shape this guard reads. The full compose has far more
 * keys; we type only what the structural template asserts over.
 */
interface ComposeService {
  image?: unknown;
  labels?: unknown;
  environment?: unknown;
  healthcheck?: {
    test?: unknown;
    interval?: unknown;
    timeout?: unknown;
    retries?: unknown;
    start_period?: unknown;
  };
}

interface ComposeFile {
  services?: Record<string, ComposeService>;
}

/**
 * Locate the single cocoindex service block in a parsed compose. The service
 * KEY differs between environments (cocoindex-platform vs
 * cocoindex-platform-staging), so we match on the `cocoindex` prefix rather
 * than a fixed key — the structural template is environment-agnostic.
 */
export function findCocoindexService(
  compose: ComposeFile,
): ComposeService | undefined {
  const services = compose.services ?? {};
  for (const [name, service] of Object.entries(services)) {
    if (name.startsWith('cocoindex')) return service;
  }
  return undefined;
}

/** Normalise a compose `labels` value (map or array form) to a string[]. */
function labelsToList(labels: unknown): string[] {
  if (Array.isArray(labels)) return labels.map((l) => String(l));
  if (labels && typeof labels === 'object') {
    return Object.entries(labels as Record<string, unknown>).map(
      ([k, v]) => `${k}=${String(v)}`,
    );
  }
  return [];
}

/** Normalise a compose `environment` value (map or array form) to a key[]. */
function environmentKeys(environment: unknown): string[] {
  if (Array.isArray(environment)) {
    return environment.map((e) => String(e).split('=')[0]);
  }
  if (environment && typeof environment === 'object') {
    return Object.keys(environment as Record<string, unknown>);
  }
  return [];
}

/**
 * Assert the parsed compose's cocoindex service block conforms to the shared
 * structural template. Returns one ComposeDrift per divergence; an empty array
 * means the block conforms.
 */
export function diffComposeTemplate(compose: ComposeFile): ComposeDrift[] {
  const drifts: ComposeDrift[] = [];
  const service = findCocoindexService(compose);

  if (!service) {
    drifts.push({
      check: 'service-block',
      message:
        'No cocoindex* service found in compose `services` — the platform ingestion service block is missing.',
    });
    return drifts;
  }

  // 1. image — the ${COCOINDEX_IMAGE_TAG:?...} hard-fail form on the shared
  //    kh-cocoindex-pipeline artefact. Reject :latest and the soft :- default.
  const image = typeof service.image === 'string' ? service.image : '';
  if (!image.includes('kh-cocoindex-pipeline')) {
    drifts.push({
      check: 'image-tag-hardfail',
      message: `image is not the shared kh-cocoindex-pipeline artefact: "${image}"`,
    });
  } else if (!/\$\{COCOINDEX_IMAGE_TAG:\?/.test(image)) {
    drifts.push({
      check: 'image-tag-hardfail',
      message: `image must pin the tag via the \${COCOINDEX_IMAGE_TAG:?...} HARD-FAIL form (never :latest, never the soft :- default): "${image}"`,
    });
  }

  // 2. COCOINDEX_DB — the engine LMDB state store wired to /cocoindex-state/lmdb.
  const env = service.environment;
  const dbValue =
    env && typeof env === 'object' && !Array.isArray(env)
      ? (env as Record<string, unknown>).COCOINDEX_DB
      : undefined;
  if (String(dbValue ?? '') !== COCOINDEX_DB_PATH) {
    drifts.push({
      check: 'cocoindex-db',
      message: `COCOINDEX_DB must wire the engine LMDB store to "${COCOINDEX_DB_PATH}" (found "${String(dbValue ?? '')}")`,
    });
  }

  // 3. Traefik scope — the router rule must path-scope to EXACTLY /walk +
  //    /health + /extract (and NOT /stage). The scope is the exposure guard.
  const labels = labelsToList(service.labels);
  const ruleLabel = labels.find((l) => l.includes('.rule='));
  if (!ruleLabel) {
    drifts.push({
      check: 'traefik-scope',
      message:
        'No Traefik router `.rule=` label found on the cocoindex service.',
    });
  } else {
    for (const path of REQUIRED_TRAEFIK_PATHS) {
      if (!ruleLabel.includes(`PathPrefix(\`${path}\`)`)) {
        drifts.push({
          check: 'traefik-scope',
          message: `Traefik router rule must include PathPrefix(\`${path}\`) — scope divergence in: ${ruleLabel}`,
        });
      }
    }
    if (ruleLabel.includes('PathPrefix(`/stage`)')) {
      drifts.push({
        check: 'traefik-scope',
        message:
          'Traefik router rule routes /stage — Inv-13 requires /stage stay compose-internal (NOT edge-routed).',
      });
    }
  }

  // 4. healthcheck — the bash /dev/tcp/127.0.0.1/<port> liveness probe with the
  //    interval / timeout / retries / start_period quartet.
  const hc = service.healthcheck;
  if (!hc) {
    drifts.push({
      check: 'healthcheck',
      message: 'No healthcheck block on the cocoindex service.',
    });
  } else {
    const test = Array.isArray(hc.test)
      ? hc.test.map((t) => String(t)).join(' ')
      : String(hc.test ?? '');
    if (!test.includes(`/dev/tcp/127.0.0.1/${COCOINDEX_PORT}`)) {
      drifts.push({
        check: 'healthcheck',
        message: `healthcheck test must probe the HTTP port via bash /dev/tcp/127.0.0.1/${COCOINDEX_PORT} (found "${test}")`,
      });
    }
    for (const field of [
      'interval',
      'timeout',
      'retries',
      'start_period',
    ] as const) {
      if (hc[field] === undefined || hc[field] === null) {
        drifts.push({
          check: 'healthcheck',
          message: `healthcheck is missing the "${field}" field.`,
        });
      }
    }
  }

  // 5. env keyset — every required environment key must be declared.
  const presentKeys = new Set(environmentKeys(env));
  for (const key of REQUIRED_ENV_KEYS) {
    if (!presentKeys.has(key)) {
      drifts.push({
        check: 'env-keyset',
        message: `environment is missing required key "${key}".`,
      });
    }
  }

  return drifts;
}

/**
 * Parse compose YAML text and run the structural template assertion. Exposed so
 * the test can drive both the real compose and an injected-divergence variant
 * without touching the filesystem.
 */
export function checkComposeText(yamlText: string): ComposeDrift[] {
  const compose = parseYaml(yamlText) as ComposeFile;
  return diffComposeTemplate(compose);
}

/**
 * CLI entry point. Resolves the platform-production compose repo-root-relative
 * (scripts/ci/ lives two levels below the repo root), parses it, and reports
 * any structural drift. Warn-only posture: exits 1 on drift so the signal is
 * visible, but the workflow is non-required so it does not block a merge.
 */
async function main(): Promise<number> {
  const here = dirname(fileURLToPath(import.meta.url));
  // scripts/ci/ -> up two levels to the repo root.
  const repoRoot = resolve(here, '..', '..');
  const composePath = resolve(
    repoRoot,
    'deploy/coolify/docker-compose.platform.yaml',
  );

  const yamlText = await readFile(composePath, 'utf8');
  const drifts = checkComposeText(yamlText);

  if (drifts.length === 0) {
    console.log(
      'check-compose-parity: PASS — the platform-production cocoindex block conforms to the shared structural template.',
    );
    return 0;
  }

  console.error(
    `check-compose-parity: WARN — ${drifts.length} structural divergence(s) detected in deploy/coolify/docker-compose.platform.yaml:`,
  );
  for (const d of drifts) {
    console.error(`  - [${d.check}] ${d.message}`);
  }
  console.error(
    '\nThe platform-production cocoindex service block has drifted from the shared',
  );
  console.error(
    'structural template (TECH.md §BI-15 Change B). Reconcile it against',
  );
  console.error(
    'deploy/coolify/docker-compose.platform-staging.yaml, or update this guard if',
  );
  console.error('the template itself was deliberately changed.');
  return 1;
}

// `import.meta.main` is Bun-specific; the script is invoked via `bun` only.
if (import.meta.main) {
  const code = await main();
  process.exit(code);
}
