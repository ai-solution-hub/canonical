/**
 * Zod contract for every `docs/ontology/*.md` file's YAML frontmatter.
 *
 * Mirrors `lib/validation/schemas.ts` patterns: `as const` literal tuples,
 * `z.enum(...)`, no `z.any()`. The base schema is `.strict()` so unknown
 * frontmatter keys fail loudly — silently stripping unknown fields would
 * mean Drafter-wave additions to the ontology corpus could go unnoticed
 * by downstream consumers.
 *
 * Per-layer relaxation (ratified S275 OQ-52-WAVE-1-A Option 3,
 * `docs/specs/id-52-form-extraction/TECH.md` §2.6c): Layer-5 KG-entity CVs
 * (e.g. `q_a_pair`) admit no `baseline_values` plus three optional
 * declarative keys (`related_ontology`, `source_of_truth`, `last_updated`).
 * Layer-1..4 + 6 retain the wp6 D1 invariants unchanged: `baseline_values`
 * required with `.min(1)`, and the three Layer-5-only keys rejected.
 *
 * Source-of-truth contract: `docs/specs/wp6-ontology-harness/TECH.md` §6
 * (verbatim) plus `docs/plans/phase-0-investigation/phase-b-prerequisite-1-onthology-pipeline-feedback-investigation.md` §6.3
 * (canonical frontmatter shape), and `docs/specs/id-52-form-extraction/TECH.md`
 * §2.6c (Layer-5 KG-entity relaxation).
 */
import { z } from 'zod';

export const PROVENANCE_VALUES = ['core', 'client', 'recommended'] as const;
export const PROVENANCE_MODEL_VALUES = ['core', 'client', 'hybrid'] as const;
export const EDITABLE_VIA_VALUES = [
  'database_migration',
  'admin_ui',
  'seed_data',
] as const;
export const STATUS_VALUES = ['active', 'planned', 'needed'] as const;

const BaselineValueSchema = z.object({
  // Accepts snake_case (canonical), kebab-case (mirrors existing TS module names
  // like `bid-metadata`, `unified-gap`, `filter-preset`), and the literal `TBD`
  // sentinel used by the Drafter wave for placeholder rows. The parity test
  // (§5.4 case 2) catches any TBD-key that survives into the Editor wave for
  // CVs whose snapshot exists.
  key: z
    .string()
    .min(1)
    .regex(
      /^([a-z][a-z0-9_-]*|TBD)$/,
      'baseline value key must be snake_case, kebab-case, or the TBD placeholder sentinel',
    ),
  label: z.string().min(1),
  provenance: z.enum(PROVENANCE_VALUES),
  definition: z.string().min(1).optional(),
  // Per-value provenance for the KG-ontology CVs `34-entity-type.md` (Layer 5)
  // and `35-relationship.md` (Layer 6) — ID-133 BI-5 / Decision B. All three
  // keys are OPTIONAL, so the existing 33 CVs (whose baseline values carry only
  // key/label/provenance/definition) are unaffected and continue to validate.
  // These mirror the CV-level provenance triple and are the forward-compat
  // bridge to a future DB-backed allowed_types/allowed_relations register
  // (TECH §BI-5, Decision B).
  provenance_model: z.enum(PROVENANCE_MODEL_VALUES).optional(),
  client_extensible: z.boolean().optional(),
  editable_via: z.enum(EDITABLE_VIA_VALUES).optional(),
});

/**
 * Base schema (`.strict()` — any non-enumerated key still fails). The three
 * Layer-5-only keys are declared `.optional()` here so they parse on Layer-5
 * files; `.superRefine` below rejects them on non-Layer-5 layers, preserving
 * the wp6 D1 R-A invariant for Layer-1..4 + 6.
 */
const OntologyCVBaseSchema = z
  .object({
    // Accepts snake_case (canonical) AND UPPER_SNAKE (e.g. `PROCUREMENT_WORKFLOW_STATES` in
    // `14-bid-states.md`). UPPER_SNAKE is allowed because A1 ships at least
    // one file using it; see TECH.md §11 for the long-term normalisation note.
    cv_name: z
      .string()
      .min(1)
      .regex(
        /^[A-Za-z][A-Za-z0-9_]*$/,
        'cv_name must be alphanumeric with underscores',
      ),
    layer: z.union([
      z.literal(1),
      z.literal(2),
      z.literal(3),
      z.literal(4),
      z.literal(5),
      z.literal(6),
    ]),
    provenance_model: z.enum(PROVENANCE_MODEL_VALUES),
    client_extensible: z.boolean(),
    editable_via: z.enum(EDITABLE_VIA_VALUES),
    core_seed_path: z.string().min(1).nullable(),
    status: z.enum(STATUS_VALUES),
    // Optional at the base layer — `.superRefine` re-enforces `.min(1)` for
    // non-Layer-5 CVs (form-extraction TECH §2.6c).
    baseline_values: z.array(BaselineValueSchema).optional(),
    related_layers: z
      .array(
        z.union([
          z.literal(1),
          z.literal(2),
          z.literal(3),
          z.literal(4),
          z.literal(5),
          z.literal(6),
        ]),
      )
      .default([]),
    // Layer-5-only declarative keys (form-extraction TECH §2.6c). Present on
    // `32-q-a-pair.md`; `.superRefine` rejects them on any layer ≠ 5.
    related_ontology: z.array(z.string()).optional(),
    source_of_truth: z.array(z.string()).optional(),
    last_updated: z.string().optional(),
  })
  .strict();

export const OntologyCVSchema = OntologyCVBaseSchema.superRefine(
  (data, ctx) => {
    if (data.layer === 5) {
      // Layer-5 KG-entity: no baseline_values requirement; three optional
      // declarative keys permitted (parsed by base schema, accepted here).
      return;
    }
    // Layer-1..4 + 6: baseline_values must be present with at least one entry
    // (wp6 D1 R-A invariant preserved).
    if (!data.baseline_values || data.baseline_values.length < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['baseline_values'],
        message:
          'baseline_values required for non-Layer-5 CVs (must have ≥1 entry)',
      });
    }
    // The three Layer-5-only keys are rejected on any non-Layer-5 layer.
    for (const key of [
      'related_ontology',
      'source_of_truth',
      'last_updated',
    ] as const) {
      if (data[key] !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} is Layer-5-only; not permitted on layer ${data.layer}`,
        });
      }
    }
  },
);

export type OntologyCV = z.infer<typeof OntologyCVSchema>;
