/**
 * lib/corpus/sweep-scope.ts
 *
 * The storage-path prefixes the cocoindex nightly pre-run sweep claims as
 * TEST-minted, in one place.
 *
 * WHY THIS IS NOT INLINE IN THE SWEEP: the sweep's selection scope and the
 * NM-6 showcase guard's protected set must be provably DISJOINT, and the only
 * way to assert that is for a third party — `__tests__/guards/corpus-manifest.test.ts`
 * — to read both. The sweep script is a top-level-`await` operator script that
 * refuses and `process.exit`s on import, so a guard cannot import it. Keeping
 * the list here is what makes the disjointness assertion possible at all.
 *
 * The overlap this exists to prevent is not hypothetical. `verify/` is a
 * SELECTION prefix here, and the verify driver was once pointed at three
 * Platform-corpus content documents (`c3286753f`), which froze their
 * `storage_path` at `verify/…`. The sweep then selected two Platform-corpus
 * rows on every run while the NM-6 guard refused to let them be deleted — a
 * permanent standoff that aborted the nightly at its first step with zero
 * deletes. Selection and protection have to be kept apart by construction, not
 * by reading two files carefully.
 */

/**
 * Declared dest-dir families (storage_path prefixes) the sweep is entitled to
 * delete. Every entry names a directory that ONLY per-test staging writes to.
 *
 * Adding a prefix here is a claim that no walked-baseline document can ever be
 * filed under it. The guard checks that claim against the manifest, so a new
 * prefix that overlaps the baseline fails in CI rather than at 06:45 on the
 * nightly.
 */
export const SWEEP_STORAGE_PATH_PREFIX_FAMILIES = [
  'verify/',
  'inv-',
  'chunking-',
  // stage5-canonical-name-freshness.integration.test.ts:123,129 — reachable
  // only through the retired `filename LIKE '[53.14-%'` leg, so narrowing
  // selection to storage_path would otherwise have leaked its rows.
  'c54-freshness/',
  'nm1-ingest-once/',
  'nm2-keepwatch/',
  'nm3-legacy/',
] as const;
