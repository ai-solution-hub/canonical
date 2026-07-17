'use client';

import { useMutation, type UseMutationResult } from '@tanstack/react-query';

/**
 * ID-147 {147.14} — E-Signature fork persistence glue (TECH.md §5 "an
 * `onSigned` persistence callback writing the completed signed PDF to
 * storage (a `form_attachments` row, `role='form_source'`)"; PRODUCT.md
 * §F3/§F4).
 *
 * Binds to the EXISTING hardened attachment-upload path rather than
 * writing to Supabase Storage/`form_attachments` directly from the
 * client (TECH.md §1 step 5, DR-063 "Extend ships zero backend": "Every
 * callback (`onFilesAccepted`, editor persist, e-signature persist)
 * binds to *our* existing hardened path"). This also matches the
 * repo-wide mutation convention — every write in `components/`/`hooks/`
 * goes `fetch('/api/...')` -> server-side Supabase write under RLS/auth
 * (see `hooks/use-file-upload-pipeline.ts`); there is zero precedent for
 * a client component calling `supabase.storage.upload()` or
 * `.from(...).insert()` directly.
 *
 * The target route, `POST /api/procurement/[id]/attachments` (ID-147.8),
 * is admin/editor-gated server-side via
 * `getAuthorisedClient(['admin', 'editor'])` + `authFailureResponse(auth)`
 * (§F4) and, on success, inserts a `form_attachments` row with
 * `role='form_source'` and `form_instance_id` set (the
 * `form_attachments_form_source_scoped` CHECK, migration
 * `20260716113306_id147_form_attachments.sql`) — satisfied here by
 * posting `role=form_source` with NO `engagement_group_id` field, which
 * the route treats as form-scoped against `[id]`.
 *
 * `form_attachments` is not yet in the generated `database.types.ts`
 * (the {147.7} migration is authored-not-pushed) — this module never
 * references the generated `Tables<'form_attachments'>` type or calls
 * `.from('form_attachments')` directly (it talks to the route over
 * `fetch`), so it carries none of that typecheck drift.
 */

export interface PersistSignedDocumentInput {
  /** `form_instances.id` — the form this signed document belongs to. */
  formId: string;
  /** The completed, merged signed PDF bytes (all signed fields drawn in). */
  pdfBytes: Uint8Array;
  /** Filename recorded on the `form_attachments` row. */
  filename?: string;
}

/** The persisted `form_attachments` row, as returned by the attachments route. */
export interface PersistSignedDocumentResult {
  id: string;
  form_instance_id: string | null;
  engagement_group_id: string | null;
  role: 'form_source' | 'reference_evidence';
  filename: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  created_by: string | null;
  created_at: string;
}

const DEFAULT_SIGNED_PDF_FILENAME = 'signed-document.pdf';

async function persistSignedDocument({
  formId,
  pdfBytes,
  filename = DEFAULT_SIGNED_PDF_FILENAME,
}: PersistSignedDocumentInput): Promise<PersistSignedDocumentResult> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(pdfBytes)], {
    type: 'application/pdf',
  });
  formData.append('file', blob, filename);
  formData.append('role', 'form_source');

  const response = await fetch(`/api/procurement/${formId}/attachments`, {
    method: 'POST',
    body: formData,
  });

  const data: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'error' in data
        ? String((data as { error: unknown }).error)
        : `Failed to save the signed document (${response.status}).`;
    throw new Error(message);
  }

  return data as PersistSignedDocumentResult;
}

/**
 * TanStack Query mutation wrapping `persistSignedDocument` — the concrete
 * `onSigned` persistence glue the {147.14} fork wires up after a user
 * completes and confirms a signature (§F3(b)).
 */
export function usePersistSignedDocument(): UseMutationResult<
  PersistSignedDocumentResult,
  Error,
  PersistSignedDocumentInput
> {
  return useMutation({
    mutationFn: persistSignedDocument,
  });
}
