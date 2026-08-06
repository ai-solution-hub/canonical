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
 * A reference id must be shaped like a Postgres `uuid` (8-4-4-4-12 hex). A
 * malformed id can never match a row, and passing it to `reference_get_verbatim`
 * raises a Postgres `22P02` cast error (not PGRST116), which would otherwise fall
 * to the error+retry state. Gate the format up front so an invalid id renders the
 * standard 404 surface (PRODUCT.md B-5: "the id is not a valid uuid → 404"), with
 * no wasted RPC round-trip. Deliberately loose (not RFC-4122 strict) to mirror
 * exactly what the `::uuid` cast accepts.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `/reference/[id]` — read-only reference detail page (ID-111.7).
 *
 * Primary read: the `reference_get_verbatim` RPC (returns a one-row array).
 * No row OR an invalid uuid (PGRST116) → `notFound()` (PRODUCT.md B-5).
 * A non-not-found RPC/transport error → a non-destructive error state with
 * retry, never a blank page (PRODUCT.md B-7).
 *
 * (The former B-28 secondary source_documents provenance read retired with
 * ri.source_document_id — id-417 / DR-124: a reference item no longer has a
 * source_documents shell. The `ingestion_source` plain-language line is the
 * provenance surface.)
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

  // PRODUCT.md B-5 — an id that is not a valid uuid is "not found", not an
  // error. Gate before any DB work so a malformed id never reaches the RPC.
  if (!UUID_RE.test(id)) {
    notFound();
  }

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
  // `types/reference.ts`). Explicit field map (not a spread) so the shape is
  // exact against both the pre- and post-regen generated row types (id-417).
  const reference: ReferenceDetail = {
    id: rawReference.id,
    title: rawReference.title,
    body: rawReference.body,
    summary: rawReference.summary,
    source_url: rawReference.source_url,
    published_at: rawReference.published_at,
    layer: rawReference.layer,
    ingestion_source: rawReference.ingestion_source as ReferenceIngestionSource,
    op_id: rawReference.op_id,
    created_at: rawReference.created_at,
    updated_at: rawReference.updated_at,
  };

  return <ReferenceDetailClient reference={reference} />;
}
