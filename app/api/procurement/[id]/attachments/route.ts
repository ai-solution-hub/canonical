import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { isEncryptedDocx } from '@/lib/docx-utils';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { checkRateLimit } from '@/lib/rate-limit';
import { tryQuery } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST/DELETE /api/procurement/[id]/attachments — ID-147 {147.8}
 * (TECH.md §2 "Reference/evidence attachment store"; PRODUCT.md §A6/§A7/§E2).
 *
 * The `form_attachments` table ({147.7}, migration authored-not-pushed —
 * `supabase/migrations/20260716113306_id147_form_attachments.sql`) is the
 * NEW store for a labelled reference/evidence attachment (a CV, etc.) at
 * FORM level or ENGAGEMENT level, plus the `role='form_source'` signed-PDF
 * write target ({147.3} §5/§F3, not exercised by this Subtask). It is
 * DISTINCT from the form's own zero-schema primary document
 * (`form_instances.filename`/`storage_path`/`mime_type` +
 * `tender-documents/<form_id>/` listing, `[id]/route.ts:GET`) — this route
 * never touches that.
 *
 * `[id]` is always the CURRENT form's `form_instances.id` (the item IS the
 * form, {147.3} §6 ruling) — both a form-scoped AND an engagement-scoped
 * attach/detach happen from that form's page. A form-scoped write targets
 * `form_instance_id = [id]` directly; an engagement-scoped write carries an
 * explicit `engagement_group_id` body field (TECH §2 "Engagement-level
 * attach carries an engagement_group_id body param").
 *
 * §E2 backend binding: this reuses the EXISTING hardened upload
 * characteristics (magic-byte sniff, 50 MB cap, rate-limit, encrypted-docx
 * rejection) from `app/api/procurement/upload/route.ts` /
 * `[id]/tender/route.ts` — DR-063 "Extend ships zero backend", no new
 * upload backend. Following the established house pattern (each of those
 * two routes ALSO duplicates this validation inline rather than sharing a
 * module), the same constants/checks are mirrored here rather than
 * factored out — file ownership for this Subtask is this NEW route only.
 * Unlike `upload/route.ts`, `form_attachments.mime_type` carries NO 3-valued
 * CHECK constraint (nullable free text), so there is no
 * legacy-mime -> target-mime remapping here: the validated `file.type` is
 * stored as-is.
 *
 * Storage path (TECH §2, reuses the `tender-documents` bucket): form-level
 * -> `<form_id>/attachments/<uuid>-<filename>`; engagement-level ->
 * `engagement/<engagement_group_id>/<uuid>-<filename>`. The sanitised
 * filename is embedded in the key per the TECH-specified shape (unlike
 * `upload/route.ts`'s extension-only key) — the same `UNSAFE_FILENAME_RE`
 * path-traversal guard as that route is applied first, so the (now-safe)
 * filename cannot escape the prefix.
 *
 * DELETE identifies the attachment via an `attachmentId` query parameter
 * (`?attachmentId=<uuid>`) rather than a nested dynamic segment — file
 * ownership for this Subtask is a single route file
 * (`app/api/procurement/[id]/attachments/route.ts`), no
 * `[attachmentId]` child route. It does a best-effort storage `remove()`
 * (the FK `ON DELETE CASCADE` on both scope columns removes the DB row but
 * cannot reach the Storage object — TECH §2 "Storage-object cleanup
 * owner"); a failure there is logged, not fatal (the {147.8} orphan-sweep
 * cron is the backstop for anything this best-effort step misses).
 *
 * OUT OF SCOPE (owned by {145.19}, W2 — TECH §2/§6 group-A ruling): the
 * group-A GET read-fold (`form_attachments` joined into the item detail
 * response, split by `role` for §A5) and the group-A DELETE's OWN
 * best-effort `form_attachments` storage cleanup (deleting the whole form).
 * This route neither reads nor is read by that surface.
 *
 * AUTH: `getAuthorisedClient(['admin','editor'])` for both POST and DELETE
 * (§F4/BI-47 mutation gating) — reviewer/viewer get `authFailureResponse`.
 * This route is AUTHENTICATED and MUST NOT be added to `proxy.ts`
 * `publicRoutes`.
 */
export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum file size: 50 MB (matches `upload/route.ts` / `[id]/tender/route.ts`). */
const MAX_FILE_SIZE = 52_428_800;

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Legacy binary Office formats — accepted for parity with `upload/route.ts` (DR-059). */
const LEGACY_DOC_MIME = 'application/msword';
const LEGACY_XLS_MIME = 'application/vnd.ms-excel';

/** Mime types this route accepts as attachment input (mirrors the hardened backend). */
const ALLOWED_MIME_TYPES = new Set([
  PDF_MIME,
  DOCX_MIME,
  XLSX_MIME,
  LEGACY_DOC_MIME,
  LEGACY_XLS_MIME,
]);

/** `form_attachments.role` CHECK values (migration `20260716113306`). */
const ATTACHMENT_ROLES = new Set(['form_source', 'reference_evidence']);

/**
 * Reject filenames carrying path-traversal or path-separator characters
 * before they are ever embedded in the storage key or persisted to the DB
 * `filename` column — same guard as `upload/route.ts`.
 */
const UNSAFE_FILENAME_RE = /[/\\]|\.\.|\0/;

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — OOXML (docx/xlsx) container
/** OLE2/MS-CFB compound-file signature — legacy .doc/.xls container. */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function matchesPrefix(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Validate file magic bytes match the declared MIME type's container family
 * (same shallow first-8-bytes sniff as `upload/route.ts:validateMagicBytes`).
 */
function validateMagicBytes(buffer: ArrayBuffer, mimeType: string): boolean {
  const bytes = new Uint8Array(buffer);
  if (mimeType === PDF_MIME) return matchesPrefix(bytes, PDF_MAGIC);
  if (mimeType === DOCX_MIME || mimeType === XLSX_MIME) {
    return matchesPrefix(bytes, ZIP_MAGIC);
  }
  if (mimeType === LEGACY_DOC_MIME || mimeType === LEGACY_XLS_MIME) {
    return matchesPrefix(bytes, OLE2_MAGIC);
  }
  return false;
}

export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { user, supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid form ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const { allowed } = checkRateLimit(
        `form-attachment-upload:${user.id}`,
        5,
        60_000,
      );
      if (!allowed) return rateLimitResponse();

      const formData = await request.formData();
      const file = formData.get('file');
      const roleRaw = formData.get('role');
      const engagementGroupIdRaw = formData.get('engagement_group_id');

      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'No file provided. Upload a file using the "file" field.' },
          { status: 400 },
        );
      }

      const role = typeof roleRaw === 'string' ? roleRaw : '';
      if (!ATTACHMENT_ROLES.has(role)) {
        return NextResponse.json(
          {
            error: `Invalid role "${role}". Must be "form_source" or "reference_evidence".`,
          },
          { status: 400 },
        );
      }

      const engagementGroupId =
        typeof engagementGroupIdRaw === 'string' &&
        engagementGroupIdRaw.trim() !== ''
          ? engagementGroupIdRaw.trim()
          : null;

      if (engagementGroupId && !UUID_RE.test(engagementGroupId)) {
        return NextResponse.json(
          { error: 'Invalid engagement_group_id -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Scope-XOR (form_attachments_scope_xor CHECK, migration 20260716113306):
      // engagement_group_id present in the body -> engagement-scoped;
      // otherwise -> form-scoped ([id]).
      const isEngagementScoped = engagementGroupId !== null;

      // form_attachments_form_source_scoped CHECK: a form_source can only be
      // form-scoped — an engagement has no form source of its own (§F3).
      if (role === 'form_source' && isEngagementScoped) {
        return NextResponse.json(
          {
            error:
              'A form-source attachment must be form-scoped, not engagement-scoped.',
          },
          { status: 400 },
        );
      }

      if (UNSAFE_FILENAME_RE.test(file.name)) {
        return NextResponse.json(
          {
            error:
              'Invalid filename. Filenames must not contain path separators or ".." segments.',
          },
          { status: 400 },
        );
      }

      if (file.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 50 MB.`,
          },
          { status: 413 },
        );
      }

      if (file.size === 0) {
        return NextResponse.json({ error: 'File is empty.' }, { status: 400 });
      }

      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: `Unsupported file type "${file.type}". Accepted: PDF (.pdf), Word (.doc/.docx), and Excel (.xls/.xlsx).`,
          },
          { status: 400 },
        );
      }

      const arrayBuffer = await file.arrayBuffer();

      if (!validateMagicBytes(arrayBuffer, file.type)) {
        return NextResponse.json(
          {
            error:
              'File content does not match its declared type. Ensure the file is a genuine document of the declared type.',
          },
          { status: 415 },
        );
      }

      // Same encrypted-package caveat as `upload/route.ts`: only run against
      // genuine OOXML/ZIP uploads, never the natively-OLE2 legacy formats.
      if (
        (file.type === DOCX_MIME || file.type === XLSX_MIME) &&
        isEncryptedDocx(arrayBuffer)
      ) {
        return NextResponse.json(
          {
            error:
              'This document is password-protected. Please remove the password and re-upload.',
          },
          { status: 400 },
        );
      }

      // Verify the current form exists — this route is always reached in a
      // specific form's context, whether the attach itself ends up
      // form-scoped or engagement-scoped.
      //
      // ID-145 {145.6}/{145.7} type-regen-skip allowance: `form_instances`
      // is POST-W1 schema, not yet in the generated Database type (staging
      // DB pre-push). Expected typecheck drift, journalled not chased —
      // same allowance {145.9}/{145.19} already took.
      const formResult = await tryQuery<{ id: string }>(
        supabase.from('form_instances').select('id').eq('id', id).single(),
        'procurement.attachments.formLookup',
      );
      if (!formResult.ok) {
        if (formResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Procurement not found' },
            { status: 404 },
          );
        }
        throw formResult.error;
      }

      const attachmentId = crypto.randomUUID();
      // TECH §2 storage-path shape: `<uuid>-<filename>` — the filename has
      // already been through UNSAFE_FILENAME_RE above, so embedding it here
      // (unlike `upload/route.ts`'s extension-only key) is safe.
      const storagePath = isEngagementScoped
        ? `engagement/${engagementGroupId}/${attachmentId}-${file.name}`
        : `${id}/attachments/${attachmentId}-${file.name}`;
      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from('tender-documents')
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        logger.error(
          { err: uploadError },
          'procurement.attachments: failed to upload attachment to storage',
        );
        return NextResponse.json(
          { error: 'Failed to upload attachment to storage.' },
          { status: 500 },
        );
      }

      const insertResult = await tryQuery(
        supabase
          .from('form_attachments')
          .insert({
            id: attachmentId,
            form_instance_id: isEngagementScoped ? null : id,
            engagement_group_id: isEngagementScoped ? engagementGroupId : null,
            role,
            filename: file.name,
            storage_path: storagePath,
            mime_type: file.type,
            file_size: file.size,
            created_by: user.id,
          })
          .select(
            'id, form_instance_id, engagement_group_id, role, filename, storage_path, mime_type, file_size, created_by, created_at',
          )
          .single(),
        'procurement.attachments.insert',
      );

      if (!insertResult.ok) {
        // Compensate: the row failed, do not leave an orphaned storage
        // object (mirrors `upload/route.ts`'s compensation pattern).
        await supabase.storage.from('tender-documents').remove([storagePath]);
        if (insertResult.error.code === '23503') {
          return NextResponse.json(
            { error: 'Engagement not found' },
            { status: 400 },
          );
        }
        logger.error(
          { err: insertResult.error },
          'procurement.attachments: failed to create form_attachments record',
        );
        return NextResponse.json(
          { error: 'Failed to create attachment record.' },
          { status: 500 },
        );
      }

      return NextResponse.json(insertResult.data, { status: 201 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to upload attachment') },
        { status: 500 },
      );
    }
  },
);

export const DELETE = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid form ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const attachmentId = request.nextUrl.searchParams.get('attachmentId');
      if (!attachmentId || !UUID_RE.test(attachmentId)) {
        return NextResponse.json(
          {
            error:
              'attachmentId query parameter is required and must be a valid UUID',
          },
          { status: 400 },
        );
      }

      const attachmentResult = await tryQuery<{
        id: string;
        storage_path: string;
        form_instance_id: string | null;
        engagement_group_id: string | null;
      }>(
        supabase
          .from('form_attachments')
          .select('id, storage_path, form_instance_id, engagement_group_id')
          .eq('id', attachmentId)
          .single(),
        'procurement.attachments.lookup',
      );

      if (!attachmentResult.ok) {
        if (attachmentResult.error.code === 'PGRST116') {
          return NextResponse.json(
            { error: 'Attachment not found' },
            { status: 404 },
          );
        }
        throw attachmentResult.error;
      }

      const attachment = attachmentResult.data;

      // Defence-in-depth: the attachment must belong to THIS form's context
      // — either form-scoped directly, or engagement-scoped via the form's
      // OWN engagement_group_id — so this route cannot be used to delete an
      // unrelated form's / engagement's attachment by id-guessing.
      let authorised = attachment.form_instance_id === id;
      if (!authorised && attachment.engagement_group_id) {
        const formResult = await tryQuery<{
          engagement_group_id: string | null;
        }>(
          supabase
            .from('form_instances')
            .select('engagement_group_id')
            .eq('id', id)
            .single(),
          'procurement.attachments.formEngagementLookup',
        );
        authorised =
          formResult.ok &&
          formResult.data.engagement_group_id ===
            attachment.engagement_group_id;
      }

      if (!authorised) {
        return NextResponse.json(
          { error: 'Attachment not found' },
          { status: 404 },
        );
      }

      const { error: deleteError } = await supabase
        .from('form_attachments')
        .delete()
        .eq('id', attachmentId);

      if (deleteError) {
        logger.error(
          { err: deleteError },
          'procurement.attachments: failed to delete form_attachments row',
        );
        return NextResponse.json(
          { error: 'Failed to delete attachment' },
          { status: 500 },
        );
      }

      // Best-effort storage cleanup (TECH §2 "Storage-object cleanup
      // owner" — the FK CASCADE gap). A failure here orphans the storage
      // object but must NOT fail the request; the {147.8} orphan-sweep cron
      // is the backstop.
      const { error: removeError } = await supabase.storage
        .from('tender-documents')
        .remove([attachment.storage_path]);
      if (removeError) {
        logger.error(
          { err: removeError, storagePath: attachment.storage_path },
          'procurement.attachments: best-effort storage remove() failed (orphaned; orphan-sweep backstop will reconcile)',
        );
      }

      return new NextResponse(null, { status: 204 });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete attachment') },
        { status: 500 },
      );
    }
  },
);
