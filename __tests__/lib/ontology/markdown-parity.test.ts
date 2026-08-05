/**
 * Ontology baseline parity guard (formerly the live-markdown ontology parity
 * guard; repointed at ID-68.27 OQ-E branch (b)).
 *
 * Real-behaviour: no mocks. Loads the frozen parity baselines from
 * `__tests__/fixtures/ontology/ontology-cv-baselines.json` and validates them
 * against the real Zod schema. The former taxonomy_snapshot.json DB-CHECK
 * parity legs were retired with the snapshot itself (DR-130 — the snapshot
 * retires entirely; its generator and `sync:taxonomy` legs are gone).
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
 *   - a loader-free privacy tripwire asserting the public register directory
 *     is absent (PC-25 Inv 29 — no public register). The dead ontology loader
 *     (`lib/ontology/loader.ts`) was retired at ID-133 BI-7 (Decision A: zero
 *     production callers), so the old fail-loud-loader half of this guard is
 *     gone — the privacy-regression intent is preserved by the direct
 *     directory-absence assertion below.
 *
 * Spec: `wp6-ontology-harness/TECH.md` §5.4 + §7; ID-68.27 record holdback
 * (b), branch (b) ratified S324; ID-133 TECH §BI-7 + Decision A.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import { OntologyCVSchema, type OntologyCV } from '@/lib/ontology/schemas';
import { CONTENT_TYPE_VALUES } from '@/lib/ontology/content-type-registry';

const PROJECT_ROOT = join(__dirname, '../../..');

// Local, loader-free path constant for the privacy tripwire below. The dead
// `lib/ontology/loader.ts` (which exported `ONTOLOGY_DIR`) was retired at
// ID-133 BI-7 — this asserts the PUBLIC register directory is absent directly,
// without importing any loader.
const PUBLIC_ONTOLOGY_DIR = resolve(PROJECT_ROOT, 'docs', 'ontology');
const BASELINES_PATH = join(
  PROJECT_ROOT,
  '__tests__/fixtures/ontology/ontology-cv-baselines.json',
);

const cvs = (
  JSON.parse(readFileSync(BASELINES_PATH, 'utf8')) as { cvs: unknown[] }
).cvs as OntologyCV[];

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

  it('the fixture freezes exactly the five parity-relevant CVs', () => {
    // content_type / requirement_type / form_type are the original lib-side
    // mirrors; entity_type (Layer 5) + relationship (Layer 6) are the ID-133
    // BI-5 KG-ontology mirrors of the extraction.py Literals (public mirror
    // per Decision A) — their parity is Python-Literal ↔ TS-const ↔ this
    // fixture, enforced in scripts/tests/test_cocoindex_extraction.py, NOT
    // here. `platform` was dropped with the 05-platform CV (id-417 S535
    // DROP ruling; no live table enforced it since ID-131.19 M6).
    expect(cvs.map((cv) => cv.cv_name).sort()).toEqual([
      'content_type',
      'entity_type',
      'form_type',
      'relationship',
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

  it('the public docs/ontology/ register is gone (ID-68.27 OQ-E branch (b) / PC-25 Inv 29; loader-free since ID-133 BI-7)', () => {
    // Branch-(b) privacy tripwire: the CV register is fully private. If
    // this case fails because the directory exists, someone has re-added
    // ontology markdown to the PUBLIC repo — that is a privacy regression,
    // not a fixture problem.
    //
    // The fail-loud-loader half of this guard was dropped at ID-133 BI-7
    // (Decision A): the dead `lib/ontology/loader.ts` was retired (zero
    // production callers), so there is no loader to assert against. The
    // privacy-regression intent is preserved by asserting the public
    // register directory is absent directly.
    expect(existsSync(PUBLIC_ONTOLOGY_DIR)).toBe(false);
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

  // Per-value provenance keys on BaselineValueSchema (ID-133 BI-5 / Decision B;
  // TECH §BI-5 "Testing and validation" BI-5 bullet). The three keys
  // (provenance_model / client_extensible / editable_via) are OPTIONAL, so the
  // existing 33-CV register baseline values (which carry none of them) remain
  // valid, and a KG-ontology baseline value carrying all three round-trips
  // intact. Validated through the real `OntologyCVSchema`, which parses
  // baseline_values via the nested (extended) `BaselineValueSchema`.
  describe('per-value provenance keys (BaselineValueSchema, ID-133 BI-5)', () => {
    it('backward-compat: a baseline value with the three optional keys ABSENT still validates', () => {
      const cvWithoutOptionalKeys = {
        cv_name: 'legacy_cv_no_optional_keys',
        layer: 1 as const,
        provenance_model: 'core' as const,
        client_extensible: false,
        editable_via: 'database_migration' as const,
        core_seed_path: null,
        status: 'active' as const,
        related_layers: [],
        baseline_values: [
          // Exactly the pre-ID-133 baseline-value shape: key/label/provenance,
          // none of the three new optional keys.
          {
            key: 'legacy_value',
            label: 'Legacy Value',
            provenance: 'core' as const,
          },
        ],
      };
      const result = OntologyCVSchema.safeParse(cvWithoutOptionalKeys);
      expect(
        result.success,
        result.success
          ? ''
          : result.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('\n'),
      ).toBe(true);
      if (result.success) {
        const bv = result.data.baseline_values![0];
        expect(bv.provenance_model).toBeUndefined();
        expect(bv.client_extensible).toBeUndefined();
        expect(bv.editable_via).toBeUndefined();
      }
    });

    it('round-trip: a baseline value carrying provenance_model/client_extensible/editable_via parses and preserves all three', () => {
      const cvWithOptionalKeys = {
        cv_name: 'kg_cv_with_per_value_provenance',
        // Layer 6 mirrors `35-relationship.md` — baseline_values required and
        // each value carries the per-value provenance triple.
        layer: 6 as const,
        provenance_model: 'hybrid' as const,
        client_extensible: true,
        editable_via: 'database_migration' as const,
        core_seed_path: null,
        status: 'active' as const,
        related_layers: [5 as const],
        baseline_values: [
          {
            key: 'holds',
            label: 'Holds',
            provenance: 'core' as const,
            provenance_model: 'core' as const,
            client_extensible: false,
            editable_via: 'database_migration' as const,
          },
        ],
      };
      const result = OntologyCVSchema.safeParse(cvWithOptionalKeys);
      expect(
        result.success,
        result.success
          ? ''
          : result.error.issues
              .map((i) => `${i.path.join('.')}: ${i.message}`)
              .join('\n'),
      ).toBe(true);
      if (result.success) {
        const bv = result.data.baseline_values![0];
        expect(bv.provenance_model).toBe('core');
        expect(bv.client_extensible).toBe(false);
        expect(bv.editable_via).toBe('database_migration');
      }
    });
  });
});
