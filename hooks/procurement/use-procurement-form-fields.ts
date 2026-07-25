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
 * Response types are declared at the route
 * (`app/api/procurement/[id]/fields/route.ts`) and re-exported here. They
 * briefly lived at this hook while the route still built an ad-hoc
 * `Record<string, unknown>` body — that inversion is exactly the
 * fetcher-only drift `type-drift-detect` flags, so the route reclaimed the
 * declaration.
 */
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query/query-keys';
import { fetchJson } from '@/lib/query/fetchers';

import type {
  ProcurementFormFieldRow,
  ProcurementFormFieldsResponse,
} from '@/app/api/procurement/[id]/fields/route';

// Re-exported for consumers that import the wire types from this hook module
// rather than the route file directly — the route file is the canonical
// declaration site (type-drift-detect conformance convention), this hook is a
// pass-through re-export, never the reverse.
export type { ProcurementFormFieldRow, ProcurementFormFieldsResponse };

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
