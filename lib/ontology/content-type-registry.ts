/**
 * First downstream consumer of the markdown ontology register.
 *
 * Re-exports the build-time-generated `CONTENT_TYPE_VALUES` tuple. The
 * generated module is produced by `scripts/generate-content-type-values.ts`
 * (wired into `prebuild` + `predev`) and reads
 * `docs/ontology/04-content-type.md` `baseline_values[].key`. Inlining at
 * build time keeps client bundles free of the synchronous node:fs reads
 * that `lib/ontology/loader.ts` performs — Turbopack rejects external
 * modules in client chunks.
 *
 * Parity test (`__tests__/lib/ontology/markdown-parity.test.ts`) still
 * runs the loader on the Node side and asserts the markdown register and
 * the live DB CHECK constraint remain in lockstep.
 *
 * Spec: `docs/specs/wp6-ontology-harness/TECH.md` §5.3.
 */
export { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-values.generated';
