import { notFound, redirect } from 'next/navigation';
import { getAuthenticatedClient } from '@/lib/auth/client';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import {
  SourceDocumentDetailClient,
  SourceDocumentDetailError,
} from '@/components/source-document-detail/source-document-detail-client';
import type { Tables } from '@/supabase/types/database.types';

/**
 * `/documents/[id]` — Surface B `source_document` detail/provenance page
 * (ID-135 {135.18}, TECH.md §2/§3 BI-1/BI-22/BI-23/BI-24/BI-30/BI-31; BND-2).
 *
 * **BND-2 (shared route tree):** net-new SIBLING of the shipped
 * `/documents/[id]/diff` (`app/documents/[id]/diff/page.tsx`, id-117) —
 * this file adds `page.tsx` alongside it in the same `[id]` segment. No
 * behavioural coupling: this page never imports from `diff/`, and
 * `gitnexus_impact` on `DocumentDiffPage` confirmed LOW risk / 0 upstream
 * callers before this file was added.
 *
 * Reuses the id-111 detail-shell **pattern**
 * (`app/reference/[id]/page.tsx`): UUID-format gate → auth check →
 * primary read → notFound()/error branching → client presenter. BI-22: no
 * top-nav slot (this route is a detail destination, not a nav entry).
 *
 * BI-1 (authenticated, read-only): `getAuthenticatedClient()` → explicit
 * `auth.success` check → `redirect('/login')` — the page-component-correct
 * equivalent of `authFailureResponse()` (which returns a `NextResponse`, not
 * a valid Server Component return), matching the established
 * `app/search/page.tsx` pattern for this same Task. This is
 * defence-in-depth alongside `proxy.ts` `publicRoutes` — `/documents/[id]`
 * is deliberately OMITTED from that allowlist (authenticated, not public).
 *
 * BI-23 (not-found / invalid-id): the `UUID_RE` gate (reused verbatim from
 * `app/reference/[id]/page.tsx`) rejects a non-UUID `id` with `notFound()`
 * before any DB work; a well-formed id with no matching `source_documents`
 * row also `notFound()`s. Never a 500, blank page, or partial shell.
 *
 * BI-30 (partial-failure): a genuine primary-read failure (not a
 * not-found — RLS/transport/DB error) renders the single
 * `SourceDocumentDetailError` with retry, never a blank page. The three
 * composed sections (version chain, citations, derived pairs) are each an
 * independent client-side query with their own localised error+retry —
 * see `SourceDocumentDetailClient`.
 */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function SourceDocumentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  // BI-23 — an id that isn't shaped like a Postgres uuid can never match a
  // row; gate before any auth/DB work so a malformed id never reaches them.
  if (!UUID_RE.test(id)) {
    notFound();
  }

  // BI-1 — defence-in-depth alongside the `proxy.ts` publicRoutes omission
  // (mirrors `app/search/page.tsx`, same Task).
  const auth = await getAuthenticatedClient();
  if (!auth.success) {
    redirect('/login');
  }

  // PRIMARY read — the full source_documents row (RLS-scoped via
  // auth.supabase). `.maybeSingle()` resolves `{ data: null, error: null }`
  // for "no such row" (an expected outcome, not a failure) so `tryQuery`
  // lets us distinguish that from a genuine read failure.
  const result = await tryQuery<Tables<'source_documents'> | null>(
    auth.supabase
      .from('source_documents')
      .select('*')
      .eq('id', id)
      .maybeSingle(),
    'documents.detail.get',
  );

  if (!result.ok) {
    // Genuine failure (RLS/transport/DB error) — never blank, never 404.
    logBestEffortWarn(
      'documents.detail.get',
      'source_documents primary read failed',
      { documentId: id, code: result.error.code },
    );
    return <SourceDocumentDetailError />;
  }

  if (!result.data) {
    // No row (or RLS-invisible) — BI-23 not-found, not an error.
    notFound();
  }

  return (
    <SourceDocumentDetailClient documentId={id} sourceDocument={result.data} />
  );
}
