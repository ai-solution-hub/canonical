/**
 * Shared Supabase-env resolution + `--env=prod` safety guard for standalone
 * scripts (WP-S5.3 D-21 F-1).
 *
 * Background: ~34 scripts under `scripts/` carried an inline `assertEnvFlag()`
 * (the `--env=prod` opt-in guard) plus a near-identical SUPABASE_URL/KEY
 * resolution stanza. Both are consolidated here.
 *
 * `assertEnvFlag` is the guard that stops `--env=prod` from running against a
 * non-prod URL: if `--env=prod` is passed but `SUPABASE_URL` does not contain
 * the configured `PROD_PROJECT_REF`, it prints a remediation hint and exits 1.
 * `prodProjectRef()` is lazy + fail-loud (throws if `PROD_PROJECT_REF` is unset)
 * — see `project-refs.ts`.
 *
 * Usage:
 *
 *   import { resolveSupabaseEnv, assertEnvFlag } from './lib/script-env';
 *   const { url, key, env } = resolveSupabaseEnv(args.env, 'scripts/my-script.ts');
 *   const supabase = createScriptClient(url, key);
 */
import { prodProjectRef } from '@/scripts/lib/project-refs';

/**
 * Assert that `--env=prod` is only honoured when `SUPABASE_URL` actually points
 * at the configured prod project. Exits the process (code 1) with a remediation
 * hint when the flag is set but the URL does not contain `PROD_PROJECT_REF`.
 *
 * `scriptName` is woven into the example invocation in the error message so the
 * hint is copy-pasteable for the calling script (defaults to a generic path).
 */
export function assertEnvFlag(
  env: string,
  url: string | undefined,
  scriptName = 'scripts/<script>.ts',
): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run ${scriptName} --env=prod`,
    );
    process.exit(1);
  }
}

/** Resolved Supabase connection for a standalone script. */
export interface ResolvedSupabaseEnv {
  url: string;
  key: string;
  env: string;
}

/**
 * Resolve the Supabase URL + key from the environment and apply the
 * `--env=prod` guard in one step.
 *
 * URL resolution:   `SUPABASE_URL` ?? `NEXT_PUBLIC_SUPABASE_URL`.
 * Key resolution:   `SUPABASE_SERVICE_ROLE_KEY` || `SUPABASE_PUBLISHABLE_KEY`
 *                   || `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (the superset
 *                   fallback chain across the consolidated copies).
 *
 * Exits the process (code 1) when URL or key is missing, or when the
 * `--env=prod` guard fails. On success returns `{ url, key, env }`.
 */
export function resolveSupabaseEnv(
  env = '',
  scriptName = 'scripts/<script>.ts',
): ResolvedSupabaseEnv {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
    );
    process.exit(1);
  }

  assertEnvFlag(env, url, scriptName);

  return { url, key, env };
}
