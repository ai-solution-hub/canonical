/**
 * Impact analysis for source document updates.
 *
 * When a new version of a source document is uploaded, this module determines
 * which content items are affected by the changes. It matches diff entries
 * (modified/removed Q&A pairs) to content items linked to the previous
 * document version using deterministic substring matching.
 *
 * Phase 4.3 of Content Lifecycle spec.
 *
 * ID-117.11 REHOME decouple: accepts in-memory DiffEntry[] directly instead of
 * re-fetching from source_document_diffs. The back-write of affected_content_item_id
 * into that table is also removed — the table is being dropped in {117.13}.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type { DiffEntry } from '@/lib/source-documents/document-diff';
import { sb } from '@/lib/supabase/safe';

export interface ImpactItem {
  content_item_id: string;
  content_item_title: string;
  impact_type: 'needs_update' | 'may_be_outdated' | 'source_removed';
  diff_detail: string;
}

export interface ImpactAnalysis {
  document_id: string;
  document_filename: string;
  previous_version_id: string;
  total_affected_items: number;
  items: ImpactItem[];
}

/**
 * Analyse the impact of a newly uploaded source document version.
 *
 * 1. Follows the parent_id chain to find the previous version.
 * 2. Uses the caller-supplied diff entries (modified/removed only).
 * 3. Matches each diff entry to content items linked to the old document.
 * 4. Returns the full impact analysis result.
 *
 * No longer reads or writes source_document_diffs (ID-117.11 decouple;
 * table is dropped in {117.13}).
 */
export async function analyseDocumentImpact(
  supabase: SupabaseClient<Database>,
  newDocumentId: string,
  entries: DiffEntry[],
): Promise<ImpactAnalysis> {
  // 1. Get the new document and its parent (previous version)
  const newDoc = await sb(
    supabase
      .from('source_documents')
      .select('id, filename, parent_id')
      .eq('id', newDocumentId)
      .maybeSingle(),
    'source_documents.byId',
  );

  if (!newDoc || !newDoc.parent_id) {
    return {
      document_id: newDocumentId,
      document_filename: newDoc?.filename ?? 'unknown',
      previous_version_id: '',
      total_affected_items: 0,
      items: [],
    };
  }

  const previousVersionId = newDoc.parent_id;

  // 2. Filter the caller-supplied entries to modified and removed only
  const relevantEntries = entries.filter(
    (e) => e.diff_type === 'modified' || e.diff_type === 'removed',
  );

  if (relevantEntries.length === 0) {
    return {
      document_id: newDocumentId,
      document_filename: newDoc.filename,
      previous_version_id: previousVersionId,
      total_affected_items: 0,
      items: [],
    };
  }

  // 3. Get content items linked to the OLD document
  const linkedItems = await sb(
    supabase
      .from('content_items')
      .select('id, title, content')
      .eq('source_document_id', previousVersionId),
    'content_items.bySourceDocument',
  );

  if (!linkedItems || linkedItems.length === 0) {
    return {
      document_id: newDocumentId,
      document_filename: newDoc.filename,
      previous_version_id: previousVersionId,
      total_affected_items: 0,
      items: [],
    };
  }

  // 4. Match diff entries to content items
  const impactItems: ImpactItem[] = [];
  const matchedItemIds = new Set<string>();

  for (const entry of relevantEntries) {
    const questionText = entry.old_question?.toLowerCase().trim() ?? '';
    if (!questionText) continue;

    // Find the best matching content item
    const match = findMatchingContentItem(linkedItems, questionText);
    if (!match) continue;

    // Avoid duplicate entries for the same content item
    if (matchedItemIds.has(match.id)) continue;
    matchedItemIds.add(match.id);

    const impactType: ImpactItem['impact_type'] =
      entry.diff_type === 'removed' ? 'source_removed' : 'needs_update';

    const diffDetail =
      entry.diff_type === 'removed'
        ? `Q&A pair removed: "${truncate(entry.old_question ?? '', 80)}"`
        : `Q&A pair modified: "${truncate(entry.old_question ?? '', 80)}"`;

    impactItems.push({
      content_item_id: match.id,
      content_item_title: match.title ?? 'Untitled',
      impact_type: impactType,
      diff_detail: diffDetail,
    });
  }

  return {
    document_id: newDocumentId,
    document_filename: newDoc.filename,
    previous_version_id: previousVersionId,
    total_affected_items: impactItems.length,
    items: impactItems,
  };
}

/**
 * Find a content item whose title or content contains the question text.
 * Uses deterministic substring matching (case-insensitive).
 */
function findMatchingContentItem(
  items: Array<{ id: string; title: string | null; content: string | null }>,
  questionText: string,
): { id: string; title: string | null } | null {
  // First pass: exact title match (case-insensitive)
  for (const item of items) {
    const title = item.title?.toLowerCase().trim() ?? '';
    if (title && title === questionText) {
      return { id: item.id, title: item.title };
    }
  }

  // Second pass: title contains question or question contains title
  for (const item of items) {
    const title = item.title?.toLowerCase().trim() ?? '';
    if (
      title &&
      (title.includes(questionText) || questionText.includes(title))
    ) {
      return { id: item.id, title: item.title };
    }
  }

  // Third pass: content contains question text
  for (const item of items) {
    const content = item.content?.toLowerCase() ?? '';
    if (content && content.includes(questionText)) {
      return { id: item.id, title: item.title };
    }
  }

  return null;
}

/**
 * Truncate a string to a maximum length, appending ellipsis if needed.
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
