/**
 * PI-18 canonical-content propagation payload contract (ID-95 {95.11}).
 *
 * This is the WRITTEN contract the {95.13} fan-out worker
 * (`scripts/propagate-canonical-content.ts`) implements against, so the worker is
 * not a guess. It enumerates the platform-curated canonical SOURCE tables the
 * one-way platform -> client propagation worker pushes, in FK-dependency order,
 * with the natural key that identifies a row ACROSS databases (NOT the per-DB uuid
 * `id`) and the rule for re-resolving any per-DB uuid foreign key on the target.
 *
 * ONE-WAY ONLY. The worker reads the canonical payload from the platform SOURCE and
 * upserts into each client target by `stableKey`, deleting target rows whose
 * stableKey is absent from the source active set (`tombstone: 'delete-absent'`). The
 * worker NEVER reads client rows back into the SOURCE (PI-18). No `postgres_fdw`, no
 * logical replication -- a plain service-role upsert over a per-target connection
 * (PI-19). Applied state is recorded per target in `content_propagation_version`.
 *
 * CLIENT-PROVENANCE TABLES ARE EXPLICITLY EXCLUDED. The worker pushes the
 * platform-curated baseline only; it NEVER propagates client data
 * (guides, entity_mentions, q_a_pairs, form_responses,
 * source_documents, ...). These do not appear in this contract by construction.
 *
 * Spec: PLAN.md §"D-2 PI-18 worker mechanism" points 2 + 4 (id-95-per-client-topology).
 * Natural keys verified this session against the defining migrations
 * (20260416102457 pre-squash, 20260520120828 form-type split, 20260606121451
 * reference_items) and live staging columns.
 */

/** How a per-DB uuid foreign key is re-resolved on the target database. */
export interface FkRemap {
  /** The uuid FK column on this table whose value differs per database. */
  readonly column: string;
  /** The table the FK points at (must appear earlier in PAYLOAD_CONTRACT). */
  readonly referencesTable: string;
  /**
   * The natural-key column(s) on `referencesTable` used to re-resolve the FK on
   * the target: look up the source row's referenced natural key, then find the
   * target row with the same natural key and use ITS uuid.
   */
  readonly referencesStableKey: readonly string[];
}

export interface PayloadTableContract {
  /** The canonical source table name (also the `payload_key` in the version ledger). */
  readonly table: string;
  /**
   * The natural-key column(s) that identify a row across databases -- NOT the
   * per-DB uuid `id`. Upsert is `ON CONFLICT (stableKey)`.
   */
  readonly stableKey: readonly string[];
  /**
   * Re-resolution rule for any per-DB uuid foreign key on this table, or `null`
   * if the table has no per-DB uuid FK to remap (text-key FKs and PKs are stable
   * across DBs and need no remap).
   */
  readonly fkRemap: FkRemap | null;
  /**
   * Tombstone policy: delete target rows whose stableKey is absent from the
   * source active set. v1 is uniformly 'delete-absent' across all payload tables.
   */
  readonly tombstone: 'delete-absent';
}

/**
 * The five v1 canonical payload tables, in FK-dependency order
 * (a table never appears before a table its fkRemap references).
 *
 * id-417 / DR-130: taxonomy_domains/taxonomy_subtopics dropped (the
 * subject-taxonomy axis retired) — removed from the contract.
 *
 * Order rationale:
 *  - layer_vocabulary / application_types / form_types are independent text/uuid
 *    natural-key tables with no inbound remap dependency among the payload set.
 *  - form_requirement_templates after form_types (its template_type FK is by TEXT
 *    `key` -> form_types(key), which is stable across DBs, so NO uuid remap; order
 *    kept for clarity / referential safety).
 *  - reference_items last (independent natural key `source_url`).
 */
export const PAYLOAD_CONTRACT: readonly PayloadTableContract[] = [
  {
    table: 'layer_vocabulary',
    stableKey: ['key'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
  {
    table: 'application_types',
    // PK is uuid `id`, but `key` is UNIQUE and stable across DBs.
    stableKey: ['key'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
  {
    table: 'form_types',
    // PK IS `key` (text) -- stable across DBs.
    stableKey: ['key'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
  {
    table: 'form_requirement_templates',
    // Unique section: (template_name, template_version, section_ref, question_number).
    // template_type is an FK to form_types(key) BY TEXT KEY -> stable, NO uuid remap.
    stableKey: [
      'template_name',
      'template_version',
      'section_ref',
      'question_number',
    ],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
  {
    table: 'reference_items',
    // `source_url` is UNIQUE (the canonical normalised-URL join contract, BI-4).
    // (id-417 / DR-124: the former source_document_id FK note is obsolete —
    // the column is dropped; a reference item is the record.)
    stableKey: ['source_url'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
] as const;
