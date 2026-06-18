/**
 * Canonical Supabase project references, sourced from the environment.
 *
 * No client-owned project ref is hardcoded in tracked source (ID-68 / theme 12:
 * client IP separation before this repo goes public). Each client runs its own
 * DB instance, so client prod/staging refs are NOT baked into this platform
 * repo — they are supplied at run time by whoever operates against a given
 * client DB (e.g. `PROD_PROJECT_REF=<that client's ref> bun run scripts/...`).
 *
 *   - PLATFORM_PROJECT_REF — this repo's own dev/CI Supabase project (canonical
 *     platform). Set in .env.local locally and as a GitHub Actions secret in CI.
 *   - STAGING_PROJECT_REF / PROD_PROJECT_REF — the staging/prod project of the
 *     client DB an operator is targeting. Supplied per invocation; never a
 *     committed default.
 *
 * Getters are lazy and fail loud: a ref is read (and validated) only when a
 * guard actually needs it, so importing a script in a test that never exercises
 * the guard does not require the env var. An unset ref is a configuration error
 * — an empty string would make `url.includes(ref)` guards silently misfire.
 */

function requireRef(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Supply it via .env.local (local) or a CI secret. ` +
        `Project-ref guards cannot run safely without it.`,
    );
  }
  return value;
}

/** This repo's own dev/CI Supabase project (canonical platform). */
export const platformProjectRef = (): string =>
  requireRef('PLATFORM_PROJECT_REF');

/** Staging project of the client DB an operator is targeting (runtime-supplied). */
export const stagingProjectRef = (): string =>
  requireRef('STAGING_PROJECT_REF');

/** Production project of the client DB an operator is targeting (runtime-supplied). */
export const prodProjectRef = (): string => requireRef('PROD_PROJECT_REF');
