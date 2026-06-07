/**
 * Ontology baseline parity guard (formerly the live-markdown ontology parity
 * guard; repointed at ID-68.27 OQ-E branch (b)).
 *
 * Real-behaviour: no mocks. Loads the frozen parity baselines from
 * `__tests__/fixtures/ontology/ontology-cv-baselines.json` (the CVs with
 * lib-/snapshot-side counterparts: content_type, platform, requirement_type,
 * form_type), validates them against the real Zod schema, and compares the
 * declared enums against the live DB CHECK via
 * `scripts/tests/fixtures/taxonomy_snapshot.json`.
 *
 * History: this guard originally loaded the live `docs/ontology/*.md`
 * register. That register went fully private at the ID-68.27 OQ-E branch-(b)
 * cutover (live home: `${KH_PRIVATE_DOCS_DIR}/src/content/docs/ontology/`).
 * The full-corpus frontmatter validation + prose parity moved conceptually
 * to the private docs-site repo (the "parity-guard twin" follow-up recorded
 * in the ID-68.27 journal). What stays public is exactly the protective
 * intent with public counterparts:
 *   - the ontology Zod schema contract (`lib/ontology/schemas.ts`)
 *   - the content-type registry (`lib/ontology/content-type-registry.ts`)
 *   - the DB-derived taxonomy snapshot parity
 *   - the loader's fail-loud contract now that the public register is gone
 *     (PC-25 Inv 29 — no silent fallback)
 *
 * Spec: `wp6-ontology-harness/TECH.md` §5.4 + §7; ID-68.27 record holdback
 * (b), branch (b) ratified S324.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

import { loadOntologyCVs, ONTOLOGY_DIR } from '@/lib/ontology/loader';
import { OntologyCVSchema, type OntologyCV } from '@/lib/ontology/schemas';
import { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-registry';

const PROJECT_ROOT = join(__dirname, '../../..');
const SNAPSHOT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);
const BASELINES_PATH = join(
  PROJECT_ROOT,
  '__tests__/fixtures/ontology/ontology-cv-baselines.json',
);

interface TaxonomySnapshot {
  content_types?: string[];
  platforms?: string[];
  requirement_type?: string[];
}

const SNAPSHOT_EXISTS = existsSync(SNAPSHOT_PATH);
const snapshot: TaxonomySnapshot | null = SNAPSHOT_EXISTS
  ? (JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) as TaxonomySnapshot)
  : null;

const cvs = (
  JSON.parse(readFileSync(BASELINES_PATH, 'utf8')) as { cvs: unknown[] }
).cvs as OntologyCV[];

// Map of cv_name → snapshot key for the parity case (§5.4 case 2).
const SNAPSHOT_KEY_BY_CV_NAME: Record<string, keyof TaxonomySnapshot> = {
  content_type: 'content_types',
  platform: 'platforms',
};

describe('Ontology Baseline Parity', () => {
  it('every frozen baseline CV parses and validates against the ontology schema', () => {
    // Accumulate-and-report so a developer sees ALL failing CVs in one run
    // (per `__tests__/validation/schema-db-consistency.test.ts:72-88`
    // pattern).
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

  it('the fixture freezes exactly the four parity-relevant CVs', () => {
    expect(cvs.map((cv) => cv.cv_name).sort()).toEqual([
      'content_type',
      'form_type',
      'platform',
      'requirement_type',
    ]);
  });

  it('CONTENT_TYPE_VALUES (lib registry) matches the frozen content_type baseline both ways', () => {
    const contentTypeCV = cvs.find((cv) => cv.cv_name === 'content_type');
    expect(contentTypeCV).toBeDefined();
    const fixtureKeys = (contentTypeCV!.baseline_values ?? [])
      .map((bv) => bv.key)
      .sort();
    expect([...CONTENT_TYPE_VALUES].sort()).toEqual(fixtureKeys);
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

      it('every frozen CV with editable_via=database_migration matches the live DB CHECK both ways', () => {
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
          // {63.9} made baseline_values optional (requirement_type standalone
          // case). A wired snapshot key always implies baseline_values must be
          // present for the parity comparison — fail loudly if it is missing.
          expect(cv.baseline_values).toBeDefined();
          const baselineValues = cv.baseline_values ?? [];
          const mdKeys = baselineValues.map((bv) => bv.key);
          const mdSet = new Set(mdKeys);
          const dbSet = new Set(dbValues);
          const missingFromMD = dbValues.filter((v) => !mdSet.has(v));
          const missingFromDB = mdKeys.filter((k) => !dbSet.has(k));
          if (missingFromMD.length > 0) {
            errors.push(
              `${cv.cv_name}: values in DB CHECK but missing from frozen baseline: ${missingFromMD.join(', ')}`,
            );
          }
          if (missingFromDB.length > 0) {
            errors.push(
              `${cv.cv_name}: values in frozen baseline but missing from DB CHECK: ${missingFromDB.join(', ')}`,
            );
          }
        }
        expect(
          errors,
          `Frozen baseline ↔ DB CHECK drift (update the fixture per its _meta.update_protocol):\n${errors.join('\n')}`,
        ).toHaveLength(0);
      });

      // Standalone parity case for `requirement_type` (ID-63.9 — PRODUCT
      // Inv-9; TECH §3.9 + §5.2). The requirement_type CV is
      // `editable_via: admin_ui`, so the `database_migration` loop above
      // skips it entirely — this case is NOT gated on `editable_via` and
      // asserts the frozen baseline_values match the snapshot
      // `requirement_type` set both ways. The snapshot is DB-derived, so
      // fixture == snapshot == live DB CHECK holds transitively.
      it('requirement_type frozen baseline_values match the snapshot requirement_type set and the live DB CHECK both ways', () => {
        const reqCV = cvs.find((cv) => cv.cv_name === 'requirement_type');
        expect(
          reqCV,
          'requirement_type CV not found in ontology-cv-baselines.json',
        ).toBeDefined();

        const dbValues = snapshot!.requirement_type;
        expect(
          Array.isArray(dbValues),
          "snapshot key 'requirement_type' is missing from taxonomy_snapshot.json",
        ).toBe(true);

        const mdKeys = (reqCV!.baseline_values ?? []).map((bv) => bv.key);
        const md = [...mdKeys].sort();
        const db = [...(dbValues ?? [])].sort();

        const mdSet = new Set(mdKeys);
        const missingFromMD = (dbValues ?? []).filter((v) => !mdSet.has(v));
        const dbSet = new Set(dbValues ?? []);
        const missingFromDB = mdKeys.filter((k) => !dbSet.has(k));

        expect(
          md,
          `requirement_type frozen baseline ↔ snapshot/DB CHECK drift:\n` +
            `  in DB CHECK but missing from fixture: ${missingFromMD.join(', ') || '(none)'}\n` +
            `  in fixture but missing from DB CHECK: ${missingFromDB.join(', ') || '(none)'}`,
        ).toEqual(db);
      });
    },
  );

  it('each cv_name appears in only one frozen baseline entry', () => {
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
      // Layer-5 KG-entity CVs have no `baseline_values` — schema admits
      // absence (form-extraction TECH §2.6c). `?? []` keeps that shape a
      // no-op rather than a TypeError.
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

  it('the public docs/ontology/ register is gone and the loader fails loudly (ID-68.27 OQ-E branch (b) / PC-25 Inv 29)', () => {
    // Branch-(b) privacy tripwire: the CV register is fully private. If
    // this case fails because the directory exists, someone has re-added
    // ontology markdown to the PUBLIC repo — that is a privacy regression,
    // not a fixture problem. If it fails because the loader stopped
    // throwing, the fail-loud contract (no silent fallback) has been
    // weakened.
    expect(existsSync(ONTOLOGY_DIR)).toBe(false);
    expect(() => loadOntologyCVs()).toThrowError(/ONTOLOGY_DIR does not exist/);
  });

  // Per-layer relaxation cases (form-extraction TECH §2.6c — Layer-5
  // KG-entity admits no `baseline_values` + three optional declarative keys;
  // Layer-1..4 + 6 retain the wp6 D1 R-A invariant). Cases (a)/(b)/(c) use
  // constructed fixtures so they pass standalone.
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
          'docs/specs/id-31-canonical-pipeline-implementation-plan/PLAN.md §4.6',
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
