/**
 * source-document-revision adapter (ID-117 {117.6}, cluster A→B).
 *
 * Pure mapper: a source_documents row → UnifiedRevision.
 *
 * This adapter is a PURE FUNCTION. It performs no fetch, no DB access, and
 * no diff-storage write. Callers supply a pre-fetched row (Tables<'source_documents'>)
 * and a resolved display-name map so the adapter can apply the labelFor pattern.
 *
 * Text projection: source_documents.extracted_text (the binary-leg text fallback
 * source — OQ-117-3 resolved: extracted_text is legacy, used only as the binary-leg
 * text fallback in INV-6; the canonical-markdown depth uses content_history).
 *
 * Binary leg: binary.storagePath = storage_path, binary.mimeType = mime_type.
 * Present only when both storage_path and mime_type are non-null.
 *
 * Provenance synthesis (OQ-117-4 resolved, TECH §4):
 * - changeType: 'initial_ingest' when version === 1 AND parent_id is null;
 *               'reingest'       otherwise (version > 1, or parent_id is present).
 * - changeSummary: always null  (no such column on source_documents).
 * - editIntent:    always null  (no such column on source_documents).
 * - createdByLabel: resolved from uploaded_by via the labelFor pattern:
 *   uploaded_by is non-null → displayNames.get(uploaded_by) ?? 'Unknown'
 *   uploaded_by is null     → 'System'
 *   (Mirrors the labelFor callback in components/item-detail/version-history.tsx:115.)
 *
 * NO fabrication of absent columns. Column `uploaded_by` is the user-identity
 * field on source_documents (the schema has no `created_by` column; `uploaded_by`
 * is the FK to user_profiles that identifies the uploader).
 *
 * Caller convention: both blobs in a UnifiedDiff MUST share the same documentId
 * (adapters enforce same-record by construction — INV-1). This adapter does NOT
 * validate that constraint; it is the caller's responsibility to pass the correct
 * documentId for both older and newer rows.
 */

import type { Tables } from '@/supabase/types/database.types';
import type { UnifiedRevision } from '@/lib/diff/unified-revision';

/** Row shape for source_documents (public schema canonical definition). */
type SourceDocumentRow = Tables<'source_documents'>;

/**
 * Map a source_documents row to a UnifiedRevision.
 *
 * @param row          - The full row from the source_documents table.
 * @param documentId   - The source_documents.id this row belongs to. Both blobs
 *                       in a UnifiedDiff must share this value.
 * @param displayNames - Resolved user-UUID → display-name map. Caller resolves
 *                       this (e.g. via useDisplayNames on the client, or a
 *                       profiles lookup on the server). The adapter applies the
 *                       standard labelFor fallback rules against this map.
 */
export function sourceDocumentRevisionToUnified(
  row: SourceDocumentRow,
  documentId: string,
  displayNames: ReadonlyMap<string, string>,
): UnifiedRevision {
  return {
    recordKind: 'source_document',
    recordId: documentId,
    version: row.version,
    // Text projection: extracted_text is the binary-leg text fallback (INV-6).
    // Null coalesces to empty string so the diff engine always has a diffable string.
    text: row.extracted_text ?? '',
    // Provenance synthesis per OQ-117-4 (TECH §4):
    // initial_ingest = the document's first version with no predecessor.
    // reingest = any subsequent upload (version > 1, or parent_id signals a chain link).
    changeType: synthesiseChangeType(row.version, row.parent_id),
    // No change_summary column on source_documents — no fabrication.
    changeSummary: null,
    createdAt: row.created_at,
    // uploaded_by is the user-identity FK on source_documents (no created_by column).
    // labelFor pattern: non-null UUID → map lookup ?? 'Unknown'; null → 'System'.
    createdByLabel: labelFor(row.uploaded_by, displayNames),
    // No edit_intent column on source_documents — always null (INV-4, TECH §1.1).
    editIntent: null,
    // Binary leg: present only when both paths are available.
    binary:
      row.storage_path != null && row.mime_type != null
        ? { storagePath: row.storage_path, mimeType: row.mime_type }
        : undefined,
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Synthesise the changeType for a source_documents revision (OQ-117-4).
 *
 * Rules (TECH §4):
 * - version === 1 AND parent_id is null → 'initial_ingest'
 * - anything else (version > 1, or parent_id is set)  → 'reingest'
 */
function synthesiseChangeType(
  version: number,
  parentId: string | null,
): 'initial_ingest' | 'reingest' {
  if (version === 1 && parentId === null) {
    return 'initial_ingest';
  }
  return 'reingest';
}

/**
 * Resolve a display label from uploaded_by (the labelFor pattern).
 *
 * Mirrors the inline `labelFor` callback in version-history.tsx:115:
 *   createdBy ? (displayNames.get(createdBy) ?? 'Unknown') : 'System'
 *
 * @param uploadedBy   - UUID of the uploading user, or null for system actions.
 * @param displayNames - Resolved UUID → display-name map.
 */
function labelFor(
  uploadedBy: string | null,
  displayNames: ReadonlyMap<string, string>,
): string {
  if (uploadedBy === null) {
    return 'System';
  }
  return displayNames.get(uploadedBy) ?? 'Unknown';
}
