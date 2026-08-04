/**
 * lib/corpus/fixture-manifest.ts
 *
 * id-406 — loader + schema for the corpus fixture manifest, the checked-in
 * register of every test-fixture tree in the repo (id-396 TECH §1, ratified
 * S511 and unbuilt until now).
 *
 * WHERE THE MANIFEST LIVES: `docs/reference/testing/corpus-manifest.json`,
 * ratified S523 as **DR-118**. DR-117 files fixture *trees* under the domain
 * that owns them; this is a cross-tree register spanning the pipeline's corpus,
 * its form templates and `__tests__/fixtures/**`, so it has no owning domain and
 * files as what it is — a testing standard, beside `test-philosophy.md` and
 * `testing-patterns.md`. The spec's original `docs/testing/` path is dead (that
 * directory was deleted in the S521–S522 fixture relocation).
 *
 * WHY THE PATH RESOLVES HERE AND NOWHERE ELSE: there are two consumers — the
 * guard (`__tests__/validation/corpus-manifest.test.ts`) and the census gate
 * (`scripts/cocoindex-census-gate.ts`, whose hardcoded `DRIVER_MANIFEST_DEST_PATHS`
 * this replaces). The manifest is a *sibling* of the test-standards docs rather
 * than a child of `__tests__/`, so both reach it by a relative path out of their
 * own tree. Resolving it twice is how the two lists drift apart again, which is
 * the entire defect this task exists to close — so it is resolved ONCE, here.
 *
 * NAME COLLISION — read this before touching anything called "manifest" in the
 * Python pipeline. A *workspace manifest* was deliberately REMOVED from the
 * ingest path and is guarded against returning
 * (`test_ingest_file_no_longer_accepts_a_workspace_manifest_kwarg` et al. in
 * `scripts/tests/test_cocoindex_flow_fork_routing.py`). That retirement is
 * correct. THIS manifest is a repo-side test-fixture register and never becomes
 * an ingest-path input.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Repo-root-relative home of the manifest (DR-118). The single spelling of this
 * path in the codebase.
 */
export const CORPUS_MANIFEST_RELATIVE_PATH =
  'docs/reference/testing/corpus-manifest.json';

/**
 * Absolute path to the manifest, resolved from THIS file's own location rather
 * than `process.cwd()` — the census gate is an operator script that may be
 * invoked from anywhere, and a cwd-relative resolve would make it silently
 * unreadable rather than loudly wrong.
 */
export const CORPUS_MANIFEST_PATH = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
  CORPUS_MANIFEST_RELATIVE_PATH,
);

/** Repo root, derived from the same anchor. */
export const REPO_ROOT = resolve(
  join(dirname(fileURLToPath(import.meta.url)), '..', '..'),
);

/**
 * Test-side retention class (id-396 TECH §2).
 *
 * `staged-ephemeral` — staged per run/test, swept by the pre-run sweep.
 * `durable-seed`     — deliberately persistent, declared with a reason.
 * `vendored-read-only` — never staged; consumed as files.
 */
export const fixtureClassSchema = z.enum([
  'staged-ephemeral',
  'durable-seed',
  'vendored-read-only',
]);

/**
 * How a fixture reaches the pipeline.
 *
 * The first four are id-396 TECH §1's enumeration verbatim. `walked-baseline`
 * is an ADDITIVE fifth value (id-406, S523) and the reason is the S522 owner
 * ruling: the vendored Platform corpus is the tree the nightly is supposed to
 * WALK, and TECH §1 was written before anyone noticed that axis was being
 * violated — it has no value meaning "this IS the corpus". `never-staged` would
 * be actively misleading for it. The extension is deliberate and surfaced, not
 * silent; id-406's AC-8 requires the walked baseline to be registrable.
 */
export const stagingModeSchema = z.enum([
  'verify-driver',
  'per-test',
  'never-staged',
  'db-seed',
  'walked-baseline',
]);

export const fixtureEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  tree: z.string().min(1),
  format: z.string().min(1),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().nonnegative(),
  fixture_class: fixtureClassSchema,
  staging_mode: stagingModeSchema,
  /**
   * Hand-declared consuming test/spec paths. NOT derivable: {377.6} cleared
   * ast-dataflow as a precision instrument, not an inventory one, and
   * "which tests use this file" is exactly the question it cannot answer
   * reliably. An empty list is an orphan and FAILS the guard.
   */
  consumers: z.array(z.string().min(1)),
  notes: z.string(),
  /**
   * Flat `verify/<basename>` destination for the three fixtures
   * `verify_driver.py` FIXTURE_SETS['templates'] stages (scheme aligned at
   * `c64be60b`). Sourcing these from the manifest is what retires the census
   * gate's hardcoded `DRIVER_MANIFEST_DEST_PATHS`.
   */
  verify_dest: z.string().min(1).optional(),
  /**
   * Escape hatch for a registered file that is NOT a fixture any test loads
   * (today: one README beside the eval gold standards). Requires a
   * justification in `notes` — the guard enforces that, so the exemption stays
   * visible in the data instead of being a filename hardcoded in the guard.
   */
  orphan_exempt: z.boolean().optional(),
});

export const fixtureTreeSchema = z.object({
  id: z.string().min(1),
  root: z.string().min(1),
  /** Whether every basename in this tree must carry the `synthetic-` prefix. */
  synthetic: z.boolean(),
  notes: z.string(),
});

export const corpusManifestSchema = z.object({
  $schema_version: z.literal(1),
  generated_by: z.string(),
  trees: z.array(fixtureTreeSchema).min(1),
  fixtures: z.array(fixtureEntrySchema).min(1),
});

export type FixtureEntry = z.infer<typeof fixtureEntrySchema>;
export type FixtureTree = z.infer<typeof fixtureTreeSchema>;
export type CorpusManifest = z.infer<typeof corpusManifestSchema>;

/** Read + validate the manifest. Throws on a malformed file, by design. */
export function loadCorpusManifest(
  path: string = CORPUS_MANIFEST_PATH,
): CorpusManifest {
  return corpusManifestSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/**
 * The flat `verify/<basename>` dest paths the verify driver stages, in manifest
 * order. Replaces `scripts/cocoindex-census-gate.ts`'s hardcoded
 * `DRIVER_MANIFEST_DEST_PATHS`.
 */
export function verifyDriverDestPaths(manifest: CorpusManifest): string[] {
  // Keyed on verify_dest PRESENCE, not staging_mode === 'verify-driver':
  // since S527 the driver stages platform-corpus CONTENT docs, and those
  // entries keep staging_mode 'walked-baseline' (the S522 whole-tree
  // invariant) while verify_dest records the verify-lane staging. A
  // verify-driver staging_mode without a verify_dest is still an error.
  for (const f of manifest.fixtures) {
    if (f.staging_mode === 'verify-driver' && !f.verify_dest) {
      throw new Error(
        `corpus manifest: ${f.id} declares staging_mode "verify-driver" without a verify_dest`,
      );
    }
  }
  return manifest.fixtures
    .filter((f) => f.verify_dest !== undefined)
    .map((f) => f.verify_dest as string);
}
