// Post-ID-29 (S252+): sync source of truth for `application_types.key`
// values, paired with the DB seed in `application_types`. Used by
// `lib/validation/schemas.ts` to construct the Zod enum at module-load.
// The UI metadata surface (label, labelPlural, description, icon, route,
// available, hasCustomCreation, features, defaultColour, defaultIcon)
// lives in `hooks/workspaces/use-application-types.ts` as a TanStack
// Query hook over `application_types` DB rows joined with a static
// client config (Option C hybrid per
// docs/specs/id-29-tanstack-workspace-types/TECH.md). Add or retire a seed
// key: update both the module-internal `APPLICATION_TYPE_KEYS` list AND
// the `application_types` table seed in lockstep.

/**
 * Six application_types seed keys (matches `application_types.key` per T2
 * migration S246/S247). Source of truth is the DB table; this constant is
 * the sync-callable equivalent used by Zod schema construction at module
 * load via `getValidTypeValues()` (`lib/validation/schemas.ts:545`). Update
 * both this list AND the `application_types` table seed in lockstep if a
 * seed key is added or retired.
 *
 * Module-internal — external consumers use `getValidTypeValues()`.
 */
const APPLICATION_TYPE_KEYS = [
  'procurement',
  'intelligence',
  'sales_proposal',
  'product_guide',
  'competitor_research',
  'training_onboarding',
] as const;

/**
 * Get the valid type values for Zod validation.
 * Returns the 6 application_types seed keys hardcoded — sync-callable
 * equivalent of `SELECT key FROM application_types`. Async DB-driven
 * validation belongs in route handlers, not module-load-time Zod.
 */
export function getValidTypeValues(): [string, ...string[]] {
  return APPLICATION_TYPE_KEYS as unknown as [string, ...string[]];
}
