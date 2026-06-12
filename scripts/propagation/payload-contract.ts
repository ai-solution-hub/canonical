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
 * (content_items, guides, entity_mentions, q_a_pairs, form_responses,
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
 * The seven v1 canonical payload tables, in FK-dependency order
 * (a table never appears before a table its fkRemap references).
 *
 * Order rationale:
 *  - taxonomy_domains before taxonomy_subtopics (subtopics.domain_id -> domains).
 *  - layer_vocabulary / application_types / form_types are independent text/uuid
 *    natural-key tables with no inbound remap dependency among the payload set.
 *  - form_template_requirements after form_types (its template_type FK is by TEXT
 *    `key` -> form_types(key), which is stable across DBs, so NO uuid remap; order
 *    kept for clarity / referential safety).
 *  - reference_items last (independent natural key `source_url`).
 */
export const PAYLOAD_CONTRACT: readonly PayloadTableContract[] = [
  {
    table: 'taxonomy_domains',
    stableKey: ['name'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
  {
    table: 'taxonomy_subtopics',
    // stableKey is the non-FK identifying component only: the subtopic `name`.
    // `domain_name` is NOT a stored column (it exists only as a SELECT alias in
    // coverage-RPC RETURNS TABLE signatures) -- so it cannot be an ON CONFLICT
    // target. The cross-DB identity is (resolved domain, subtopic name); the domain
    // component is supplied by the fkRemap below, not by a stableKey column.
    //
    // Worker upsert target (so {95.13} builds the right ON CONFLICT without
    // guessing): the ON CONFLICT column set = fkRemap-resolved FK column(s) UNION
    // stableKey = (domain_id, name), which is the existing DB UNIQUE constraint
    // `taxonomy_subtopics_domain_id_name_key`. The worker resolves the target-side
    // `domain_id` via the fkRemap (look up the source row's domain `name`, find the
    // target taxonomy_domains row with that `name`, use ITS uuid id) BEFORE the
    // upsert, then conflicts on (domain_id, name).
    stableKey: ['name'],
    fkRemap: {
      column: 'domain_id',
      referencesTable: 'taxonomy_domains',
      referencesStableKey: ['name'],
    },
    tombstone: 'delete-absent',
  },
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
    table: 'form_template_requirements',
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
    // NOTE: reference_items.source_document_id is a NOT NULL uuid FK to
    // source_documents, which is a CLIENT-PROVENANCE table EXCLUDED from this
    // contract. It is intentionally NOT modelled as an fkRemap here because the
    // worker cannot remap to a table it does not propagate. Resolving this
    // cross-class FK on the target is a {95.13} concern (e.g. seed a sentinel
    // platform source_document, or scope reference_items propagation to the
    // platform-reference subset). Flagged for {95.13}; not resolvable in {95.11}.
    stableKey: ['source_url'],
    fkRemap: null,
    tombstone: 'delete-absent',
  },
] as const;
