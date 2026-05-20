/**
 * Zod contract for every `docs/ontology/*.md` file's YAML frontmatter.
 *
 * Mirrors `lib/validation/schemas.ts` patterns: `as const` literal tuples,
 * `z.enum(...)`, no `z.any()`. The schema is `.strict()` so unknown
 * frontmatter keys fail loudly — silently stripping unknown fields would
 * mean Drafter-wave additions to the ontology corpus could go unnoticed
 * by downstream consumers.
 *
 * Source-of-truth contract: `docs/specs/wp6-ontology-harness/TECH.md` §6
 * (verbatim) plus `docs/plans/phase-0-investigation/phase-b-prerequisite-1-onthology-pipeline-feedback-investigation.md` §6.3
 * (canonical frontmatter shape).
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
export const LAYER_VALUES = [1, 2, 3, 4, 5, 6] as const;

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
});

export const OntologyCVSchema = z
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
    baseline_values: z.array(BaselineValueSchema).min(1),
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
  })
  .strict();

export type OntologyCV = z.infer<typeof OntologyCVSchema>;
