/**
 * umbrellas-roundtrip.test.ts
 *
 * Schema self-parse round-trip guard for `docs/reference/umbrellas.json`.
 *
 * Per TECH §3.4 of
 * `docs/specs/canonical-pipeline-task-list-migration/TECH.md` and PRODUCT
 * invariant 17 (Inv 17: schema-roundtrip ratification) — asserts that the
 * on-disk umbrellas document parses cleanly through `UmbrellasSchema` and
 * carries at least one umbrella entry. The non-empty check is a sanity
 * floor: an empty umbrellas[] array would silently disconnect the cross-doc
 * cross-check from any Task-id assertions and is therefore a configuration
 * smell worth catching at test time.
 *
 * Companion test: `__tests__/docs/umbrellas-task-list-roundtrip.test.ts`
 * (cross-doc round-trip with `task-list.json`, PRODUCT inv 9).
 *
 * T-OQ-4 RATIFIED: no shared fixture/helper between the two test files —
 * each re-reads the JSON independently. This keeps the dependency surface
 * for either test the schema module + the on-disk JSON only.
 *
 * Failure recovery: if this test fails, either (a) the on-disk
 * `umbrellas.json` has drifted from the schema (re-run schema validation +
 * fix the JSON), or (b) `UmbrellasSchema` has tightened in a way that
 * invalidates the existing umbrellas (re-author the entries or escalate
 * the schema change).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { UmbrellasSchema } from '@/lib/validation/umbrellas-schema';

describe('umbrellas.json round-trip', () => {
  it('parses cleanly via UmbrellasSchema', () => {
    const raw = readFileSync('docs/reference/umbrellas.json', 'utf-8');
    const parsed = UmbrellasSchema.parse(JSON.parse(raw));
    expect(parsed.umbrellas.length).toBeGreaterThan(0);
  });
});
