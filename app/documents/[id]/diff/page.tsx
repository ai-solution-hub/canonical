import type { Metadata } from 'next';
import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import {
  SourceDocumentDiffReview,
  type DiffReviewEntry,
} from '@/components/source-document-diff-review';

// ---------------------------------------------------------------------------
// Dynamic page title (Item 3: C5-QW-Diff-1)
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
    .select('id, filename, version, parent_id')
    .eq('id', documentId)
    .single();

  if (!doc) {
    return { title: 'Diff Review' };
  }

  // Determine old/new versions
  let oldVersion = doc.version;
  let newVersion = doc.version;
  const filename = doc.filename;

  // Check if this document is the old side of a diff
  const { data: diffAsOld } = await supabase
    .from('source_document_diffs')
    .select('new_document_id')
    .eq('old_document_id', documentId)
    .limit(1);

  if (diffAsOld && diffAsOld.length > 0) {
    const { data: child } = await supabase
      .from('source_documents')
      .select('version')
      .eq('id', diffAsOld[0].new_document_id)
      .single();

    if (child) {
      oldVersion = doc.version;
      newVersion = child.version;
    }
  } else {
    // Check if this document is the new side of a diff
    const { data: diffAsNew } = await supabase
      .from('source_document_diffs')
      .select('old_document_id')
      .eq('new_document_id', documentId)
      .limit(1);

    if (diffAsNew && diffAsNew.length > 0) {
      const { data: parent } = await supabase
        .from('source_documents')
        .select('version')
        .eq('id', diffAsNew[0].old_document_id)
        .single();

      if (parent) {
        oldVersion = parent.version;
        newVersion = doc.version;
      }
    }
  }

  return {
    title: `Diff Review: ${filename} v${oldVersion} vs v${newVersion}`,
  };
}

export default async function DocumentDiffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: documentId } = await params;
  const supabase = await createClient();

  // Fetch the document
  const { data: doc, error: docErr } = await supabase
    .from('source_documents')
    .select('id, filename, version, created_at, parent_id')
    .eq('id', documentId)
    .single();

  if (docErr || !doc) {
    notFound();
  }

  // Determine the diff pair: this document could be either the old or new side.
  let oldDoc: { id: string; filename: string; version: number; created_at: string } = doc;
  let newDoc: typeof oldDoc | null = null;

  // Try as old_document_id first
  const { data: diffAsOld } = await supabase
    .from('source_document_diffs')
    .select('new_document_id')
    .eq('old_document_id', documentId)
    .limit(1);

  if (diffAsOld && diffAsOld.length > 0) {
    const { data: child } = await supabase
      .from('source_documents')
      .select('id, filename, version, created_at')
      .eq('id', diffAsOld[0].new_document_id)
      .single();

    if (child) {
      newDoc = child;
    }
  }

  // If not found as old, try as new_document_id
  if (!newDoc) {
    const { data: diffAsNew } = await supabase
      .from('source_document_diffs')
      .select('old_document_id')
      .eq('new_document_id', documentId)
      .limit(1);

    if (diffAsNew && diffAsNew.length > 0) {
      const { data: parent } = await supabase
        .from('source_documents')
        .select('id, filename, version, created_at')
        .eq('id', diffAsNew[0].old_document_id)
        .single();

      if (parent) {
        newDoc = { id: doc.id, filename: doc.filename, version: doc.version, created_at: doc.created_at };
        oldDoc = parent;
      }
    }
  }

  if (!newDoc) {
    notFound();
  }

  // Fetch all diff entries for this document pair
  const { data: entries, error: entriesErr } = await supabase
    .from('source_document_diffs')
    .select(
      'id, diff_type, old_question, new_question, old_content, new_content, similarity_score, affected_content_item_id, status',
    )
    .eq('old_document_id', oldDoc.id)
    .eq('new_document_id', newDoc.id)
    .order('diff_type');

  if (entriesErr) {
    return (
      <section aria-label="Document diff review" className="container px-4 py-8">
        <div className="mx-auto max-w-4xl rounded-lg border border-destructive/30 bg-destructive/5 p-8 text-center">
          <p className="text-sm text-destructive">
            Failed to load diff entries: {entriesErr.message}
          </p>
        </div>
      </section>
    );
  }

  // Collect affected content item IDs to fetch titles in bulk
  const affectedIds = (entries ?? [])
    .map((e) => e.affected_content_item_id)
    .filter((id): id is string => id !== null);

  let affectedTitles: Record<string, string> = {};
  if (affectedIds.length > 0) {
    const { data: items } = await supabase
      .from('content_items')
      .select('id, title')
      .in('id', affectedIds);

    if (items) {
      affectedTitles = Object.fromEntries(
        items.map((item) => [item.id, item.title ?? 'Untitled']),
      );
    }
  }

  // Build summary counts
  const summary = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const entry of entries ?? []) {
    const type = entry.diff_type as keyof typeof summary;
    if (type in summary) {
      summary[type]++;
    }
  }

  // Build entries for the component
  const reviewEntries: DiffReviewEntry[] = (entries ?? []).map((entry) => ({
    id: entry.id,
    diff_type: entry.diff_type as DiffReviewEntry['diff_type'],
    old_question: entry.old_question ?? undefined,
    new_question: entry.new_question ?? undefined,
    old_content: entry.old_content ?? undefined,
    new_content: entry.new_content ?? undefined,
    similarity_score: entry.similarity_score ?? undefined,
    affected_item: entry.affected_content_item_id
      ? {
          id: entry.affected_content_item_id,
          title:
            affectedTitles[entry.affected_content_item_id] ?? 'Untitled',
        }
      : undefined,
    status: entry.status,
  }));

  return (
    <section aria-label="Document diff review" className="container px-4 py-8">
      <SourceDocumentDiffReview
        documentId={oldDoc.id}
        oldDocument={{
          id: oldDoc.id,
          filename: oldDoc.filename,
          version: oldDoc.version,
          uploaded_at: oldDoc.created_at,
        }}
        newDocument={{
          id: newDoc.id,
          filename: newDoc.filename,
          version: newDoc.version,
          uploaded_at: newDoc.created_at,
        }}
        summary={summary}
        entries={reviewEntries}
      />
    </section>
  );
}
