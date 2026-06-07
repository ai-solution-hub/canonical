/**
 * Eval gold-standard fixture resolution (ID-68.17 — TECH PC-7 step 3).
 *
 * The eval lane is split CODE-public / DATA-split (PRODUCT Inv 7):
 *
 * - Public fixtures (name-swapped, no client identity) live in-repo at
 *   `__tests__/fixtures/eval-gold/` — their history begins at the clean
 *   blob.
 * - Private fixtures (verbatim client bid prose) live in the
 *   `knowledge-hub-docs-site` repo at `eval-fixtures/`, reached through
 *   the single `KH_PRIVATE_DOCS_DIR` bridge knob via
 *   `resolvePrivateDocsDir()` — fail-loud per Inv 29, no fallback. No
 *   second knob and no per-space routing matrix (Inv 25/27): the private
 *   branch below is a plain bridge consumer.
 *
 * Canonical fixture names: `classification`, `entity` (public);
 * `summarisation`, `procurement-drafting` (private). The historical
 * `bid-drafting` filename was reconciled to `procurement-drafting`
 * (Checker S317 discrepancy — the tracked artefact name is canonical).
 *
 * Import directly (`@/lib/eval/fixtures` or a relative path) — no barrel
 * re-exports.
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { resolvePrivateDocsDir } from '../private-docs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** In-repo home of the name-swapped public gold standards (PC-7 step 2). */
const PUBLIC_FIXTURE_DIR = join(
  __dirname,
  '../../__tests__/fixtures/eval-gold',
);

/** Docs-site-relative home of the private gold standards (PC-7 step 1). */
const PRIVATE_FIXTURE_SUBDIR = 'eval-fixtures';

const PUBLIC_FIXTURES: Record<string, string> = {
  classification: 'classification-eval-gold-standard.json',
  entity: 'entity-eval-gold-standard.json',
};

const PRIVATE_FIXTURES: Record<string, string> = {
  summarisation: 'summarisation-eval-gold-standard.json',
  'procurement-drafting': 'procurement-drafting-eval-gold-standard.json',
};

/** Canonical eval fixture names accepted by {@link resolveEvalFixture}. */
export type EvalFixtureName =
  | 'classification'
  | 'entity'
  | 'summarisation'
  | 'procurement-drafting';

/**
 * Resolve the absolute path of an eval gold-standard fixture.
 *
 * @param name canonical fixture name (see {@link EvalFixtureName}).
 * @returns absolute path — in-repo `__tests__/fixtures/eval-gold/` for
 *   public names; `${KH_PRIVATE_DOCS_DIR}/eval-fixtures/` for private
 *   names.
 * @throws for private names when `KH_PRIVATE_DOCS_DIR` is unset or blank
 *   (Inv 29 actionable error from `resolvePrivateDocsDir()` — never falls
 *   back to an in-repo copy), and for unknown fixture names.
 */
export function resolveEvalFixture(name: EvalFixtureName): string {
  const publicFile = PUBLIC_FIXTURES[name];
  if (publicFile) {
    return join(PUBLIC_FIXTURE_DIR, publicFile);
  }

  const privateFile = PRIVATE_FIXTURES[name];
  if (privateFile) {
    return join(resolvePrivateDocsDir(), PRIVATE_FIXTURE_SUBDIR, privateFile);
  }

  throw new Error(
    `Unknown eval fixture name '${name}' — expected one of: ` +
      `${[...Object.keys(PUBLIC_FIXTURES), ...Object.keys(PRIVATE_FIXTURES)].join(', ')}.`,
  );
}
