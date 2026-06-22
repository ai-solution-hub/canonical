import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { resolveUserDisplayNames } from '@/lib/users/display-names';
import { sourceDocumentRevisionToUnified } from '@/lib/diff/adapters/source-document-revision';
import { UnifiedDiffContainer } from '@/components/diff/unified-diff-container';
import type { Tables } from '@/supabase/types/database.types';
import type { UnifiedDiff } from '@/lib/diff/unified-revision';

/**
 * /documents/[id]/diff — the binary view-depth of the unified diff surface
 * (ID-117 {117.10}, cluster F+A; INV-1/17/18/19/20).
 *
 * REBUILT (S39x): this page NO LONGER reads the legacy `source_document_diffs`
 * table (DROPPED in {117.13}). It resolves the version pair via the
 * `source_documents.parent_id` chain — the requested document is the NEWER side,
 * its `parent_id` is the OLDER side — and renders the binary depth of the
 * shared `UnifiedDiffContainer`. Where there is no `parent_id` (initial ingest),
 * it shows a clear "no previous version" notice rather than a crash or a 404.
 *
 * Workspace scoping (INV-19): all reads use the RLS-scoped client
 * (`createClient()` from `@/lib/supabase/server`), so a document the requesting
 * user cannot see returns no row → notFound(); a valid, visible document always
 * renders something (never a 404-gap).
 *
 * Read-only (INV-17/18) + AI-invisible (INV-20) are enforced inside
 * `UnifiedDiffContainer` / `BinaryDiffPane` — this page wires data only.
 */

/** Columns the diff surface needs from a source_documents row. */
const SOURCE_DOC_COLUMNS =
  'id, filename, version, parent_id, storage_path, mime_type, extracted_text, uploaded_by, created_at';

type DiffDocRow = Pick<
  Tables<'source_documents'>,
  | 'id'
  | 'filename'
  | 'version'
  | 'parent_id'
  | 'storage_path'
  | 'mime_type'
  | 'extracted_text'
  | 'uploaded_by'
  | 'created_at'
>;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id: documentId } = await params;
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from('source_documents')
    .select('filename, version')
    .eq('id', documentId)
    .maybeSingle();

  if (!doc) {
    return { title: 'Document comparison' };
  }

  return {
    title: `Document comparison: ${doc.filename} v${doc.version}`,
  };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function DocumentDiffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = await params;
  const supabase = await createClient();

  // The requested document is the NEWER side of the comparison.
  const { data: newerRow } = await supabase
    .from('source_documents')
    .select(SOURCE_DOC_COLUMNS)
    .eq('id', documentId)
    .maybeSingle<DiffDocRow>();

  // RLS-invisible or non-existent → 404 (do not leak cross-workspace existence).
  if (!newerRow) {
    notFound();
  }

  // No predecessor → this is the initial ingest; render a clear notice, not a
  // crash and not a 404 (the document itself is valid and visible).
  if (!newerRow.parent_id) {
    return (
      <section aria-label="Document comparison" className="container px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">
            {newerRow.filename}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Version {newerRow.version}
          </p>
        </header>
        <div className="rounded-lg border bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            This is the first version of this document — there is no previous
            version to compare against.
          </p>
        </div>
      </section>
    );
  }

  // The OLDER side is the parent in the version chain.
  const { data: olderRow } = await supabase
    .from('source_documents')
    .select(SOURCE_DOC_COLUMNS)
    .eq('id', newerRow.parent_id)
    .maybeSingle<DiffDocRow>();

  // Parent exists in the chain but is not visible to this user (or was removed):
  // show a notice rather than 404-gapping the visible newer document.
  if (!olderRow) {
    return (
      <section aria-label="Document comparison" className="container px-4 py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold text-foreground">
            {newerRow.filename}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Version {newerRow.version}
          </p>
        </header>
        <div className="rounded-lg border bg-muted/30 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            The previous version of this document is no longer available to
            compare against.
          </p>
        </div>
      </section>
    );
  }

  // Resolve uploader UUIDs → display names for both rows (single round trip).
  const uploaderIds = [olderRow.uploaded_by, newerRow.uploaded_by].filter(
    (id): id is string => id !== null,
  );
  const resolved = await resolveUserDisplayNames(supabase, uploaderIds);
  const displayNames = new Map<string, string>(
    [...resolved.entries()].map(([id, info]) => [id, info.display_name]),
  );

  // Project both rows into the unified revision abstraction. The OLDER and NEWER
  // sides are distinct source_documents rows, so each carries its OWN recordId
  // (its own source_documents.id) — the binary leg mints two distinct URLs.
  const diff: UnifiedDiff = {
    older: sourceDocumentRevisionToUnified(
      olderRow as Tables<'source_documents'>,
      olderRow.id,
      displayNames,
    ),
    newer: sourceDocumentRevisionToUnified(
      newerRow as Tables<'source_documents'>,
      newerRow.id,
      displayNames,
    ),
  };

  return (
    <section aria-label="Document comparison" className="container px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-foreground">
          {newerRow.filename}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Comparing v{olderRow.version} with v{newerRow.version}
        </p>
      </header>

      <UnifiedDiffContainer
        diff={diff}
        viewDepth="binary"
        olderDocId={olderRow.id}
        newerDocId={newerRow.id}
      />
    </section>
  );
}
