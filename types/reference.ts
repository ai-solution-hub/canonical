import type { Database } from '@/supabase/types/database.types';

/**
 * Display types for the global reference layer (ID-75 / ID-111).
 *
 * References are workspace-less, global evidence rows (one per normalised URL)
 * and are NEVER content_items-shaped — hence they live here rather than in
 * `types/content.ts`. Field types are derived from the generated DB row shape
 * (`reference_items`) so a schema change propagates here automatically. The one deliberate exception is `ingestion_source`: the column
 * is a plain `text` with a CHECK constraint, so the generated Row types it as
 * `string`; we narrow it to its 2-value union here.
 *
 * Spec: PRODUCT.md B-1, B-11, B-28; TECH.md Seam 1/2 types.
 */

type ReferenceItemRow = Database['public']['Tables']['reference_items']['Row'];

/**
 * The two permitted `reference_items.ingestion_source` values. The DB column is
 * `text` with a CHECK constraint (`'rss_feed' | 'url_import'`), which the
 * generated types widen to `string`; this union restores the real domain.
 */
export type ReferenceIngestionSource = 'rss_feed' | 'url_import';

/**
 * Verbatim single-reference shape — the exact `reference_get_verbatim` RPC
 * return (11 fields; id-417 / DR-130 + DR-124 retired the domain fields and
 * source_document_id). Spec: PRODUCT.md B-1; TECH.md Seam 1.
 */
export interface ReferenceDetail {
  id: ReferenceItemRow['id'];
  title: ReferenceItemRow['title'];
  body: ReferenceItemRow['body'];
  summary: ReferenceItemRow['summary'];
  source_url: ReferenceItemRow['source_url'];
  published_at: ReferenceItemRow['published_at'];
  layer: ReferenceItemRow['layer'];
  /** Narrowed to the CHECK-constrained union (not the generated `string`). */
  ingestion_source: ReferenceIngestionSource;
  op_id: ReferenceItemRow['op_id'];
  created_at: ReferenceItemRow['created_at'];
  updated_at: ReferenceItemRow['updated_at'];
}

/**
 * Reference list/grid row — the `reference_list` RPC return shape (8 fields;
 * id-417 / DR-130 + DR-124 retired the domain fields and
 * source_document_id), which is identical to the non-score columns of
 * `reference_search`. The two optional score fields are present ONLY on
 * `reference_search` results, so one type serves both the list RPC and the
 * search RPC. Spec: PRODUCT.md B-11; TECH.md Seam 2.
 */
export interface ReferenceListItem {
  reference_id: ReferenceItemRow['id'];
  title: ReferenceItemRow['title'];
  summary_preview: ReferenceItemRow['summary'];
  body_preview: ReferenceItemRow['body'];
  source_url: ReferenceItemRow['source_url'];
  published_at: ReferenceItemRow['published_at'];
  layer: ReferenceItemRow['layer'];
  /** Narrowed to the CHECK-constrained union (not the generated `string`). */
  ingestion_source: ReferenceIngestionSource;
  /** Cosine-similarity score — present only on `reference_search` results. */
  embedding_score?: number;
  /** Lexical (full-text) score — present only on `reference_search` results. */
  fulltext_score?: number;
}

// (ReferenceSourceDocument deleted — id-417 / DR-124: the B-28
// source_documents provenance join retired with ri.source_document_id.)
