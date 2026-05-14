/**
 * Synchronous reader for `docs/ontology/*.md`.
 *
 * One pass at module load: validates every file against `OntologyCVSchema`;
 * throws fatally on parse error or schema violation with the offending file
 * path. Subsequent imports reuse a cached array reference — do NOT mutate
 * the returned value, the `readonly` types are intent rather than runtime
 * enforcement.
 *
 * Sync I/O is correct here: this runs once per Node process at first import,
 * keeps the consumer API plain (`const types = CONTENT_TYPE_VALUES`), and
 * works inside Vitest (no top-level await ceremony needed).
 *
 * Spec: `docs/specs/wp6-ontology-harness/TECH.md` §5.2.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import matter from 'gray-matter';

import { OntologyCVSchema, type OntologyCV } from '@/lib/ontology/schemas';

// Resolve the repo root from this file's location (`lib/ontology/loader.ts`)
// so the loader works under both Vitest (jsdom) and direct Bun runs.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');

/** Absolute path to the markdown ontology directory. */
export const ONTOLOGY_DIR = join(REPO_ROOT, 'docs', 'ontology');

// Module-scope cache. The returned array is the SAME reference across all
// callers; mutating it would leak across tests in the same Vitest worker.
let cached: readonly OntologyCV[] | null = null;

/**
 * Read + parse + Zod-validate every `.md` file in `docs/ontology/` except
 * `README.md`. Returns a deterministic (filename-sorted) array. Caches the
 * result for subsequent calls.
 *
 * Throws an `Error` whose message includes the offending file path and the
 * Zod issue list if any file fails to validate.
 */
export function loadOntologyCVs(): readonly OntologyCV[] {
  if (cached !== null) return cached;

  if (!existsSync(ONTOLOGY_DIR)) {
    throw new Error(
      `[ontology/loader] ONTOLOGY_DIR does not exist at ${ONTOLOGY_DIR}. ` +
        'The Drafter / Editor waves must produce the 29 markdown files first.',
    );
  }

  const files = readdirSync(ONTOLOGY_DIR)
    .filter((name) => name.endsWith('.md') && name !== 'README.md')
    .sort();

  const parsed: OntologyCV[] = [];
  for (const filename of files) {
    const filePath = join(ONTOLOGY_DIR, filename);
    const raw = readFileSync(filePath, 'utf8');
    const fm = matter(raw);
    const result = OntologyCVSchema.safeParse(fm.data);
    if (!result.success) {
      const issues = result.error.issues
        .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(
        `[ontology/loader] Schema validation failed for ${filename}:\n${issues}`,
      );
    }
    parsed.push(result.data);
  }

  cached = Object.freeze(parsed);
  return cached;
}
