import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  ReferenceDetailClient,
  ReferenceDetailError,
} from './reference-detail-client';
import type {
  ReferenceDetail,
  ReferenceIngestionSource,
  ReferenceSourceDocument,
} from '@/types/reference';
import type { Database } from '@/supabase/types/database.types';

/**
 * The raw `reference_get_verbatim` RPC return row. The generated types widen
 * `ingestion_source` to `string` (it is a CHECK-constrained `text` column); we
 * narrow it to {@link ReferenceDetail} at the read boundary below.
 */
type ReferenceGetVerbatimRow =
  Database['public']['Functions']['reference_get_verbatim']['Returns'][number];

/**
 * `/reference/[id]` — read-only reference detail page (ID-111.7).
 *
 * Primary read: the `reference_get_verbatim` RPC (returns a one-row array).
 * No row OR an invalid uuid (PGRST116) → `notFound()` (PRODUCT.md B-5).
 * A non-not-found RPC/transport error → a non-destructive error state with
 * retry, never a blank page (PRODUCT.md B-7).
 *
 * Secondary read (B-28, after the primary, since `source_document_id` is NOT
 * NULL): the `source_documents` row via `tryQuery`. On failure the page renders
 * WITHOUT the enriched provenance block, falling back to the `ingestion_source`
 * plain-language line (PRODUCT.md B-2) — it MUST NOT 404 or blank on a failed
 * enrichment.
 *
 * Authenticated surface — `/reference/[id]` is NOT in `proxy.ts` publicRoutes
 * (PRODUCT.md B-6).
 *
 * Spec: PRODUCT.md B-1..B-7, B-27, B-28, B-2, B-26; TECH.md Seam 2.
 */
export default async function ReferenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // PRIMARY read — reference_get_verbatim returns a single-row array.
  const referenceResult = await tryQuery<ReferenceGetVerbatimRow[]>(
    supabase.rpc('reference_get_verbatim', { p_reference_id: id }),
    'reference.detail.get_verbatim',
  );

  if (!referenceResult.ok) {
    // PGRST116 ("no rows") and an invalid-uuid lookup are both "not found".
    if (referenceResult.error.code === 'PGRST116') {
      notFound();
    }
    // Any other failure (transport/RPC error) → non-blank error + retry (B-7).
    logBestEffortWarn(
      'reference.detail.get_verbatim',
      'reference_get_verbatim RPC failed',
      { referenceId: id, code: referenceResult.error.code },
    );
    return <ReferenceDetailError />;
  }

  const rawReference = referenceResult.data?.[0] ?? null;
  if (!rawReference) {
    // Empty array — the reference does not exist (B-5).
    notFound();
  }

  // Narrow `ingestion_source` from the generated `string` to its
  // CHECK-constrained union (the deliberate exception documented in
  // `types/reference.ts`); the rest of the row maps 1:1 to ReferenceDetail.
  const reference: ReferenceDetail = {
    ...rawReference,
    ingestion_source: rawReference.ingestion_source as ReferenceIngestionSource,
  };

  // SECONDARY read (B-28) — source_documents provenance. `source_document_id`
  // is NOT NULL, so a missing row is a genuine failure to enrich, not an
  // expected null. Degrade gracefully: a failed enrichment must never 404 or
  // blank the readable reference (TECH.md Seam 2).
  let sourceDocument: ReferenceSourceDocument | null = null;
  const sourceDocumentResult = await tryQuery<ReferenceSourceDocument | null>(
    supabase
      .from('source_documents')
      .select(
        'original_filename, filename, mime_type, file_size, extraction_method, source_url, created_at',
      )
      .eq('id', reference.source_document_id)
      .maybeSingle(),
    'reference.detail.source_document',
  );

  if (sourceDocumentResult.ok) {
    sourceDocument = sourceDocumentResult.data;
  } else {
    logBestEffortWarn(
      'reference.detail.source_document',
      'source_documents enrichment read failed — degrading to ingestion_source line',
      {
        referenceId: id,
        sourceDocumentId: reference.source_document_id,
        code: sourceDocumentResult.error.code,
      },
    );
  }

  return (
    <ReferenceDetailClient
      reference={reference}
      sourceDocument={sourceDocument}
    />
  );
}
