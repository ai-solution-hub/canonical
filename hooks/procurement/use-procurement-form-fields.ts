'use client';

/**
 * §C fill-slot review read (ID-145 {145.47}, TECH §3/§4, PRODUCT §C1-C4).
 *
 * Wraps the existing `GET /api/procurement/[id]/fields` route ({145.19}) —
 * the form's document info (`storage_path`/`mime_type`, needed to tell a PDF
 * form from a DOCX/XLSX one, §C4), its detected `fields` (each now carrying
 * the `geometry` jsonb added by ID-147 {147.9}/{147.10}, validated on read
 * via `geometrySchema`/`parseGeometry` — a malformed or absent blob is
 * treated as no geometry, never a misaligned box), and the mapping/fill
 * `summary`.
 *
 * Response types are declared here (not at the route) because
 * `app/api/procurement/[id]/fields/route.ts` does not itself export a
 * response type (pre-existing — it builds an ad-hoc `Record<string,
 * unknown>` body); this hook is the canonical declaration site for {145.47}'s
 * purposes.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

/** A matched bid question enrichment, joined onto a field server-side. */
export interface ProcurementFormFieldMatchedQuestion {
  id: string;
  question_text: string;
  status: string;
  response_preview: string | null;
}

/** One `form_instance_fields` row, as returned by the `[id]/fields` GET. */
export interface ProcurementFormFieldRow {
  id: string;
  form_instance_id: string;
  field_type: string;
  table_index: number | null;
  row_index: number | null;
  col_index: number | null;
  question_text: string | null;
  section_name: string | null;
  word_limit: number | null;
  placeholder_text: string | null;
  question_id: string | null;
  mapping_status: string;
  mapping_confidence: number | null;
  fill_status: string | null;
  fill_error: string | null;
  /**
   * Raw jsonb — validate with `parseGeometry`
   * (lib/domains/procurement/geometry-schema.ts) before use; never trust the
   * shape directly (§C4).
   */
  geometry: unknown;
  sequence: number;
  created_at: string;
  updated_at: string;
  matched_question?: ProcurementFormFieldMatchedQuestion | null;
}

export interface ProcurementFormFieldsSummary {
  total_fields: number;
  confirmed_fields: number;
  rejected_fields: number;
  unmapped_fields: number;
  unreviewed_fields: number;
  filled_fields: number;
  pending_fields: number;
  skipped_fields: number;
  failed_fields: number;
}

/** The `[id]/fields` GET response envelope — form document info + fields + summary. */
export interface ProcurementFormFieldsResponse {
  id: string;
  name: string;
  description: string | null;
  filename: string;
  storage_path: string;
  file_size: number | null;
  mime_type: string | null;
  processing_status: string;
  field_count: number | null;
  mapped_count: number;
  structure_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fields: ProcurementFormFieldRow[];
  summary: ProcurementFormFieldsSummary;
  completions: unknown[];
  warnings?: string[];
}

/** The §C fill-slot review surface's data source (`ItemFillSlotReview`). */
export function useProcurementFormFields(formId: string) {
  return useQuery<ProcurementFormFieldsResponse>({
    queryKey: queryKeys.procurement.fields(formId),
    queryFn: () =>
      fetchJson<ProcurementFormFieldsResponse>(
        `/api/procurement/${formId}/fields`,
      ),
    enabled: !!formId,
  });
}
