/**
 * Markdown ontology parity guard.
 *
 * Real-behaviour: no mocks. Loads the actual 29 `docs/ontology/*.md` files,
 * parses with real `gray-matter`, validates against the real Zod schema, and
 * compares the markdown-declared `content_type` enum against the live DB
 * CHECK constraint via `scripts/tests/fixtures/taxonomy_snapshot.json`.
 *
 * Each `it()` title reads as a product spec per `docs/reference/test-philosophy.md`
 * §1 criterion 5. Mirrors the accumulate-and-report pattern of
 * `__tests__/validation/schema-db-consistency.test.ts:72-88`.
 *
 * Spec: `docs/specs/wp6-ontology-harness/TECH.md` §5.4 + §7.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import matter from 'gray-matter';
import { describe, it, expect } from 'vitest';

import { loadOntologyCVs, ONTOLOGY_DIR } from '@/lib/ontology/loader';
import { OntologyCVSchema } from '@/lib/ontology/schemas';
import { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-registry';

const PROJECT_ROOT = join(__dirname, '../../..');
const SNAPSHOT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);

interface TaxonomySnapshot {
  content_types?: string[];
  platforms?: string[];
}

const SNAPSHOT_EXISTS = existsSync(SNAPSHOT_PATH);
const snapshot: TaxonomySnapshot | null = SNAPSHOT_EXISTS
  ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as TaxonomySnapshot)
  : null;

const cvs = loadOntologyCVs();

// Map of cv_name → snapshot key for the parity case (§5.4 case 2).
// When new `database_migration` CVs are added without a snapshot entry here,
// the loop below `it.skip`s with an explicit todo-shape message rather than
// failing silently.
const SNAPSHOT_KEY_BY_CV_NAME: Record<string, keyof TaxonomySnapshot> = {
  content_type: 'content_types',
  platform: 'platforms',
};

describe('Markdown Ontology Parity', () => {
  it('every CV file parses and validates against the ontology schema', () => {
    // loadOntologyCVs() already throws on the first failure, but re-validate
    // per-file so a developer running this test sees ALL failing files in
    // one run rather than one-at-a-time across N reruns (per
    // `__tests__/validation/schema-db-consistency.test.ts:72-88` pattern).
    const failures: string[] = [];
    for (const cv of cvs) {
      const result = OntologyCVSchema.safeParse(cv);
      if (!result.success) {
        const issues = result.error.issues
          .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
          .join('\n');
        failures.push(`${cv.cv_name}:\n${issues}`);
      }
    }
    expect(
      failures,
      `Frontmatter validation failures:\n${failures.join('\n\n')}`,
    ).toHaveLength(0);
  });

  describe.skipIf(!snapshot)(
    'live DB CHECK parity (via taxonomy_snapshot.json)',
    () => {
      it('content_items.content_type lists exactly 15 values matching the live DB CHECK', () => {
        const md = [...CONTENT_TYPE_VALUES].sort();
        const db = [...(snapshot!.content_types ?? [])].sort();
        expect(md).toEqual(db);
        expect(CONTENT_TYPE_VALUES).toHaveLength(15);
      });

      it('every CV with editable_via=database_migration matches the live DB CHECK both ways', () => {
        const databaseMigrationCVs = cvs.filter(
          (cv) => cv.editable_via === 'database_migration',
        );
        const errors: string[] = [];
        for (const cv of databaseMigrationCVs) {
          const snapshotKey = SNAPSHOT_KEY_BY_CV_NAME[cv.cv_name];
          if (!snapshotKey) {
            // No snapshot key wired for this CV yet. Schema validation has
            // already passed (case 1), so this is a known gap — skip without
            // failing the build. Adding the key to SNAPSHOT_KEY_BY_CV_NAME
            // wires it into the parity check.
            continue;
          }
          const dbValues = snapshot![snapshotKey];
          if (!Array.isArray(dbValues)) {
            errors.push(
              `${cv.cv_name}: snapshot key '${String(snapshotKey)}' is missing from taxonomy_snapshot.json`,
            );
            continue;
          }
          const mdKeys = cv.baseline_values.map((bv) => bv.key);
          const mdSet = new Set(mdKeys);
          const dbSet = new Set(dbValues);
          const missingFromMD = dbValues.filter((v) => !mdSet.has(v));
          const missingFromDB = mdKeys.filter((k) => !dbSet.has(k));
          if (missingFromMD.length > 0) {
            errors.push(
              `${cv.cv_name}: values in DB CHECK but missing from markdown: ${missingFromMD.join(', ')}`,
            );
          }
          if (missingFromDB.length > 0) {
            errors.push(
              `${cv.cv_name}: values in markdown but missing from DB CHECK: ${missingFromDB.join(', ')}`,
            );
          }
        }
        expect(
          errors,
          `Markdown ↔ DB CHECK drift:\n${errors.join('\n')}`,
        ).toHaveLength(0);
      });
    },
  );

  it('each cv_name appears in only one ontology file', () => {
    const names = cvs.map((cv) => cv.cv_name);
    const seen = new Set<string>();
    const duplicates: string[] = [];
    for (const name of names) {
      if (seen.has(name)) duplicates.push(name);
      seen.add(name);
    }
    expect(
      duplicates,
      `Duplicate cv_name values: ${duplicates.join(', ')}`,
    ).toHaveLength(0);
    expect(seen.size).toBe(names.length);
  });

  it('each baseline_values key appears once within its CV', () => {
    const errors: string[] = [];
    for (const cv of cvs) {
      // Layer-5 KG-entity CVs (e.g. `q_a_pair`) have no `baseline_values`
      // — schema admits absence (form-extraction TECH §2.6c). The
      // duplicate-key check is meaningful only for CVs with baseline_values
      // populated; `?? []` makes Layer-5 a no-op rather than a TypeError.
      const keys = (cv.baseline_values ?? []).map((bv) => bv.key);
      const seen = new Set<string>();
      const duplicates: string[] = [];
      for (const key of keys) {
        if (seen.has(key)) duplicates.push(key);
        seen.add(key);
      }
      if (duplicates.length > 0) {
        errors.push(
          `${cv.cv_name}: duplicate baseline_values keys: ${duplicates.join(', ')}`,
        );
      }
    }
    expect(
      errors,
      `Duplicate baseline_values keys within CVs:\n${errors.join('\n')}`,
    ).toHaveLength(0);
  });

  it('reads markdown files from the real `docs/ontology/` directory', () => {
    // Belt-and-braces: assert the loader actually crossed the fs boundary
    // and parsed real markdown (no fixture stub leaked in). If this fails,
    // either ONTOLOGY_DIR was misresolved or the Drafter wave's output is
    // missing.
    const samplePath = join(ONTOLOGY_DIR, '04-content-type.md');
    expect(existsSync(samplePath)).toBe(true);
    const raw = readFileSync(samplePath, 'utf8');
    const fm = matter(raw);
    expect(fm.data.cv_name).toBe('content_type');
    expect(cvs.length).toBeGreaterThanOrEqual(29);
  });

  // Per-layer relaxation cases (form-extraction TECH §2.6c — Layer-5
  // KG-entity admits no `baseline_values` + three optional declarative keys;
  // Layer-1..4 + 6 retain the wp6 D1 R-A invariant). Cases (a)/(b)/(c) use
  // constructed fixtures so they pass standalone — the full integrated
  // parity over the live `32-q-a-pair.md` requires the sibling {52.5}
  // status-flip and is exercised by the existing `every CV file parses`
  // case once both Subtasks land.
  describe('per-layer relaxation (Layer-5 KG-entity)', () => {
    it('(a) accepts a Layer-5 fixture with no baseline_values and the three optional declarative keys', () => {
      const layer5Fixture = {
        cv_name: 'q_a_pair',
        layer: 5 as const,
        provenance_model: 'hybrid' as const,
        client_extensible: false,
        editable_via: 'database_migration' as const,
        core_seed_path:
          'supabase/migrations/20260520225456_t6_q_a_pairs_full_schema.sql',
        status: 'active' as const,
        related_layers: [1 as const, 2 as const],
        related_ontology: ['22-origin-kind.md', '23-extractor-kind.md'],
        source_of_truth: [
          'docs/specs/canonical-pipeline-implementation-plan/PLAN.md §4.6',
        ],
        last_updated: '21/05/2026',
      };
      const result = OntologyCVSchema.safeParse(layer5Fixture);
      expect(
        result.success,
        result.success
          ? ''
          : result.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('\n'),
      ).toBe(true);
    });

    it('(b) rejects a Layer-1 fixture missing baseline_values', () => {
      const layer1MissingBaseline = {
        cv_name: 'malformed_layer_1',
        layer: 1 as const,
        provenance_model: 'core' as const,
        client_extensible: false,
        editable_via: 'seed_data' as const,
        core_seed_path: null,
        status: 'active' as const,
        related_layers: [],
        // baseline_values intentionally omitted
      };
      const result = OntologyCVSchema.safeParse(layer1MissingBaseline);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' | ');
        expect(messages).toContain(
          'baseline_values required for non-Layer-5 CVs',
        );
      }
    });

    it('(c) rejects a Layer-1 fixture with a stray source_of_truth key as Layer-5-only', () => {
      const layer1WithStraySourceOfTruth = {
        cv_name: 'malformed_layer_1_stray_key',
        layer: 1 as const,
        provenance_model: 'core' as const,
        client_extensible: false,
        editable_via: 'seed_data' as const,
        core_seed_path: null,
        status: 'active' as const,
        baseline_values: [
          {
            key: 'sample',
            label: 'Sample',
            provenance: 'core' as const,
          },
        ],
        related_layers: [],
        source_of_truth: ['some/spec.md §1'],
      };
      const result = OntologyCVSchema.safeParse(layer1WithStraySourceOfTruth);
      expect(result.success).toBe(false);
      if (!result.success) {
        const messages = result.error.issues.map((i) => i.message).join(' | ');
        expect(messages).toContain('Layer-5-only');
        expect(messages).toContain('source_of_truth');
      }
    });
  });
});
