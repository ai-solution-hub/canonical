/**
 * Impact analysis for source document updates.
 *
 * When a new version of a source document is uploaded, this module determines
 * which content items are affected by the changes. It matches diff entries
 * (modified/removed Q&A pairs) to content items linked to the previous
 * document version using deterministic substring matching.
 *
 * Phase 4.3 of Content Lifecycle spec.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

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
 * 2. Fetches diff entries (modified/removed) from source_document_diffs.
 * 3. Matches each diff entry to content items linked to the old document.
 * 4. Updates affected_content_item_id on matched diff entries.
 * 5. Returns the full impact analysis result.
 */
export async function analyseDocumentImpact(
  supabase: SupabaseClient<Database>,
  newDocumentId: string,
): Promise<ImpactAnalysis> {
  // 1. Get the new document and its parent (previous version)
  const { data: newDoc } = await supabase
    .from('source_documents')
    .select('id, filename, parent_id')
    .eq('id', newDocumentId)
    .single();

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

  // 2. Get diff entries for this document pair (modified and removed only)
  const { data: diffs } = await supabase
    .from('source_document_diffs')
    .select('id, diff_type, old_question, old_content, new_question, new_content')
    .eq('old_document_id', previousVersionId)
    .eq('new_document_id', newDocumentId)
    .in('diff_type', ['modified', 'removed']);

  if (!diffs || diffs.length === 0) {
    return {
      document_id: newDocumentId,
      document_filename: newDoc.filename,
      previous_version_id: previousVersionId,
      total_affected_items: 0,
      items: [],
    };
  }

  // 3. Get content items linked to the OLD document
  const { data: linkedItems } = await supabase
    .from('content_items')
    .select('id, title, content')
    .eq('source_document_id', previousVersionId);

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

  for (const diff of diffs) {
    const questionText = diff.old_question?.toLowerCase().trim() ?? '';
    if (!questionText) continue;

    // Find the best matching content item
    const match = findMatchingContentItem(linkedItems, questionText);
    if (!match) continue;

    // Avoid duplicate entries for the same content item
    if (matchedItemIds.has(match.id)) continue;
    matchedItemIds.add(match.id);

    const impactType: ImpactItem['impact_type'] =
      diff.diff_type === 'removed' ? 'source_removed' : 'needs_update';

    const diffDetail =
      diff.diff_type === 'removed'
        ? `Q&A pair removed: "${truncate(diff.old_question ?? '', 80)}"`
        : `Q&A pair modified: "${truncate(diff.old_question ?? '', 80)}"`;

    impactItems.push({
      content_item_id: match.id,
      content_item_title: match.title ?? 'Untitled',
      impact_type: impactType,
      diff_detail: diffDetail,
    });

    // 5. Update the diff entry with the matched content item ID
    await supabase
      .from('source_document_diffs')
      .update({ affected_content_item_id: match.id })
      .eq('id', diff.id);
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
    if (title && (title.includes(questionText) || questionText.includes(title))) {
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
