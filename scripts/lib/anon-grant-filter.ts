/**
 * DR-035 {61.14} anon-EXECUTE filter — shared by `scripts/generate-api-views.ts`'s
 * `emitFunction`. Kept in its own module (no top-level DB/env config, unlike
 * generate-api-views.ts) so it can be imported and unit-tested without a live
 * Postgres catalog.
 *
 * Mirrors a public function's grant roles onto its api.* wrapper EXCEPT anon
 * — regardless of whether the base fn itself has drifted an anon grant —
 * unless the function is `set_config` (INV-20's sole deliberate anon-EXECUTE
 * entrypoint). The S450 GO caught the regression this guards live: a drifted
 * anon EXECUTE grant on public.q_a_extractions_promotion_candidates silently
 * propagated onto the api wrapper on regen.
 */
export type Role = 'anon' | 'authenticated' | 'service_role';

/**
 * Filters `grantRoles` down to the roles the api.* wrapper should mirror.
 * Falls back to server-only roles (`authenticated`, `service_role`) when the
 * anon-filtered mirror set would otherwise be empty.
 */
export function anonFilteredGrantRoles(
  fnName: string,
  grantRoles: readonly Role[],
): Role[] {
  const mirrored = grantRoles.filter(
    (r) => r !== 'anon' || fnName === 'set_config',
  );
  return mirrored.length > 0 ? mirrored : ['authenticated', 'service_role'];
}
