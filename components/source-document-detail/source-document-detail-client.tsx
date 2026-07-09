'use client';

import Link from 'next/link';
import { ArrowLeft, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SourceDocumentProvenance } from '@/components/source-document-detail/source-document-provenance';
import { DocumentVersionList } from '@/components/source-document-detail/document-version-list';
import { DocumentCitationsPanel } from '@/components/source-document-detail/document-citations-panel';
import { DerivedPairsList } from '@/components/source-document-detail/derived-pairs-list';
import { CorpusRelatedRecords } from '@/components/corpus-search/corpus-related-records';
import type { Tables } from '@/supabase/types/database.types';

/**
 * SourceDocumentDetailClient — id-135 {135.18} Surface B detail shell
 * (TECH §3 BI-22/BI-24/BI-25/BI-27/BI-28/BI-30/BI-31, §4).
 *
 * Composes the five Surface-B sections: `SourceDocumentProvenance` (BI-24)
 * renders straight off the SAME server-read row this component receives —
 * no separate fetch — while the other four are self-fetching, INDEPENDENT
 * TanStack queries (BI-30): `DocumentVersionList` (BI-25/26),
 * `DocumentCitationsPanel` (BI-27), `DerivedPairsList` (BI-28),
 * `CorpusRelatedRecords` ({135.20} — the ontology-grounded related-records
 * rail, mounted here as the §9-DROPPED `find_related_items` REPLACEMENT).
 * Each of those four owns its own query and its own localised error+retry
 * (the shared `SectionErrorState`, {135.18} convergence pass) — a failure in
 * one never fails this shell or its siblings.
 *
 * BI-22: no top-nav slot (that is a site-header/nav decision, out of this
 * component's scope) — the in-page "Back to search" link is the only
 * navigation affordance. BI-31: read-only — no edit/delete/
 * version-mutation/re-ingest/send-to-review affordance anywhere below.
 */
export interface SourceDocumentDetailClientProps {
  documentId: string;
  sourceDocument: Tables<'source_documents'>;
}

export function SourceDocumentDetailClient({
  documentId,
  sourceDocument,
}: SourceDocumentDetailClientProps) {
  const documentName =
    sourceDocument.original_filename ||
    sourceDocument.filename ||
    'Untitled document';

  return (
    <article className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
      <nav className="mb-6">
        <Link
          href="/search"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to search
        </Link>
      </nav>

      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight break-words text-foreground">
          {documentName}
        </h1>
      </header>

      <div className="space-y-6">
        <SourceDocumentProvenance sourceDocument={sourceDocument} />
        <DocumentVersionList documentId={documentId} />
        <DocumentCitationsPanel documentId={documentId} />
        <DerivedPairsList documentId={documentId} />
        <CorpusRelatedRecords recordId={documentId} recordKind="document" />
      </div>
    </article>
  );
}

/**
 * Non-destructive error surface for the Surface-B detail shell (BI-30),
 * modelled on `ReferenceDetailError`
 * (`app/reference/[id]/reference-detail-client.tsx`). Shown when the
 * PRIMARY `source_documents` read fails for a reason other than not-found
 * (transport/RLS/DB error) — never a blank page; offers a retry via full
 * reload.
 */
export function SourceDocumentDetailError() {
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-3xl flex-col items-center gap-4 px-4 py-16 text-center sm:px-6"
    >
      <h1 className="text-xl font-semibold text-foreground">
        This document could not be loaded
      </h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Something went wrong while fetching this document. This is usually
        temporary — please try again.
      </p>
      <Button onClick={() => window.location.reload()} variant="outline">
        <RefreshCcw className="size-4" aria-hidden="true" />
        Try again
      </Button>
    </div>
  );
}
