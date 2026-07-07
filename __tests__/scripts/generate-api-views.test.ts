/**
 * Tests for scripts/lib/anon-grant-filter.ts's `anonFilteredGrantRoles` —
 * the anon-EXECUTE filter (DR-035 {61.14}) that scripts/generate-api-views.ts's
 * `emitFunction` uses to mirror a public function's grants onto its api.*
 * wrapper. `generate-api-views.ts` itself computes its migration OUTPUT_FILE
 * path from Bun-only `import.meta.dir` at module top level, so it cannot be
 * imported under Vitest; the filter was extracted into this standalone pure
 * module specifically so it can be exercised without a live Postgres catalog
 * (see that module's header).
 *
 * This guards the exact regression the S450 GO caught live: a drifted anon
 * EXECUTE grant on a public fn silently propagating onto its api wrapper on
 * regen.
 */
import { describe, expect, it } from 'vitest';

import {
  anonFilteredGrantRoles,
  type Role,
} from '@/scripts/lib/anon-grant-filter';

describe('anonFilteredGrantRoles', () => {
  it('strips anon from the mirrored roles when the base fn has drifted an anon grant', () => {
    const roles = anonFilteredGrantRoles(
      'q_a_extractions_promotion_candidates',
      ['anon', 'authenticated', 'service_role'],
    );
    expect(roles).not.toContain('anon');
    expect(roles).toEqual(['authenticated', 'service_role']);
  });

  it('mirrors anon through as-is for set_config (INV-20 sole exception)', () => {
    const roles = anonFilteredGrantRoles('set_config', [
      'anon',
      'authenticated',
      'service_role',
    ]);
    expect(roles).toContain('anon');
  });

  it('defaults to server-only roles when the anon-filtered mirror set would be empty', () => {
    const roles = anonFilteredGrantRoles('anon_only_fn', ['anon']);
    expect(roles).not.toContain('anon');
    expect(roles).toEqual(['authenticated', 'service_role']);
  });

  it('leaves non-anon roles unchanged', () => {
    const input: Role[] = ['authenticated'];
    expect(anonFilteredGrantRoles('authenticated_only_fn', input)).toEqual([
      'authenticated',
    ]);
  });

  it('never includes anon for any fn name other than the literal set_config', () => {
    const roles = anonFilteredGrantRoles('set_config_typo', [
      'anon',
      'service_role',
    ]);
    expect(roles).not.toContain('anon');
  });
});
