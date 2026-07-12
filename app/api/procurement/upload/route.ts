import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth/client';
import { isEncryptedDocx } from '@/lib/docx-utils';
import { safeErrorMessage } from '@/lib/error';
import { logger } from '@/lib/logger';
import { enqueueQueueJob } from '@/lib/queue/enqueue';
import type { JobType } from '@/lib/queue/envelope';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';
import { tryQuery } from '@/lib/supabase/safe';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

/**
 * POST /api/procurement/upload — DR-014 manual-upload creation (ID-145
 * {145.9}, BI-9/16). "Upload a form -> it becomes the procurement item" is a
 * FIRST-CLASS entry point — not tender-document ingestion nested under an
 * existing item (that is `[id]/tender/route.ts`, which requires an existing
 * bid). This route mints the item itself: the uploaded document IS that
 * item's form (`form_instances.filename` / `storage_path` / `mime_type`,
 * `ingest_source='app_upload'`).
 *
 * Reuses the hardened `[id]/tender/route.ts` pattern (magic-byte sniff,
 * 50 MB cap, rate limit) — see TECH.md §1.2/§3.1. Unlike that route, there is
 * no bid to look up: the `form_instances` row is created here, so a UUID is
 * pre-generated for both the row id and the storage path prefix (mirrors
 * `[id]/templates/route.ts`'s `templateId` pre-generation, which needs the
 * same "know the id before the row exists" shape for its storage path).
 *
 * ID-145 {145.6} W1c renamed `form_templates` -> `form_instances` and
 * dropped `workspace_id` (BI-1: the item IS the form, no workspace
 * mediation) — this route is authored against that POST-W1 schema even
 * though the generated `database.types.ts` still reflects the PRE-W1 shape
 * (staging DB has not been pushed yet; the Orchestrator pushes W1 and runs
 * `bun run sync` as a later, separate step). Typecheck failures against the
 * stale generated types on `form_instances` / `processing_status` are
 * EXPECTED here — same allowance {145.6}/{145.7} already took (see e.g.
 * `scripts/seed-id145-w1f-exemplar.ts`, `app/api/procurement/[id]/questions/
 * route.ts` post-{145.7}) — journalled, not chased.
 *
 * Storage bucket: `tender-documents` — the same bucket {145.6}'s own W1f
 * exemplar-seed script (`scripts/seed-id145-w1f-exemplar.ts`) uses to upload
 * a real file backing a `form_instances` row. The `templates` bucket is a
 * DIFFERENT concept (the template-completion "upload a blank form to
 * auto-fill" child-of-a-bid flow, `[id]/templates/route.ts` — pre-form-first
 * vocabulary the {145.6} rename leaves stale; flagged out-of-scope below).
 *
 * DR-059 (.doc/.xls convert-on-upload): this route ACCEPTS the legacy binary
 * Office mime types (`application/msword`, `application/vnd.ms-excel`) as
 * valid input — DR-014/BI-9 upload must not reject real buyer documents that
 * still arrive in these formats (British Council `.doc` RFPs, Charnwood
 * `.xls`) — but does NOT perform the LibreOffice conversion itself (no
 * LibreOffice binary in the Vercel/Next.js runtime; DR-059 places that
 * conversion "on the extraction worker"). `form_instances.mime_type` is
 * DELIBERATELY set to the TARGET post-conversion OOXML mime
 * (`.doc`->docx, `.xls`->xlsx) at insert time — the {145.6} W1c migration's
 * own header comment: "`.doc/.xls` convert to one of those three
 * **pre-insert**, so the [3-valued mime_type CHECK] constraint never needs
 * to see the legacy MIME types" — and {145.13}'s own brief confirms
 * "Conversion keeps the stored mime" (i.e. the mime_type value set HERE
 * does not change once the {145.13} worker's LibreOffice step runs; only
 * the bytes at `storage_path` are overwritten with the real converted
 * artefact before the OOXML extraction lane runs). The RAW legacy bytes are
 * what get uploaded to storage now — `contentType` on the storage object
 * reflects the file's ACTUAL current bytes (the legacy mime), not the
 * forward-looking DB `mime_type` value, so the two are deliberately
 * decoupled until {145.13} converts.
 */
export const maxDuration = 30;

/** Maximum file size: 50 MB (matches `[id]/tender/route.ts`). */
const MAX_FILE_SIZE = 52_428_800;

const PDF_MIME = 'application/pdf';
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Legacy binary Office formats — DR-059 accepts these, converts later. */
const LEGACY_DOC_MIME = 'application/msword';
const LEGACY_XLS_MIME = 'application/vnd.ms-excel';

/** Mime types this route accepts as upload input. */
const ALLOWED_MIME_TYPES = new Set([
  PDF_MIME,
  DOCX_MIME,
  XLSX_MIME,
  LEGACY_DOC_MIME,
  LEGACY_XLS_MIME,
]);

/**
 * Maps each accepted upload mime type to the `form_instances.mime_type`
 * value persisted on the row. PDF/DOCX/XLSX map to themselves; the legacy
 * binary formats map to their OOXML equivalent (DR-059 — the 3-valued
 * `{docx,xlsx,pdf}` CHECK constraint is deliberately unchanged by {145.6}).
 */
const TARGET_MIME_TYPE: Record<string, string> = {
  [PDF_MIME]: PDF_MIME,
  [DOCX_MIME]: DOCX_MIME,
  [XLSX_MIME]: XLSX_MIME,
  [LEGACY_DOC_MIME]: DOCX_MIME,
  [LEGACY_XLS_MIME]: XLSX_MIME,
};

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46]; // %PDF
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK\x03\x04 — OOXML (docx/xlsx) container
/** OLE2/MS-CFB compound-file signature — legacy .doc/.xls container. */
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function matchesPrefix(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/**
 * Validate file magic bytes match the declared MIME type's container family.
 * Prevents spoofed file extensions from reaching storage.
 *
 * Note: `.doc` and `.xls` share the IDENTICAL OLE2/MS-CFB outer-container
 * signature (both are legacy binary Office formats) — this is a shallow
 * first-8-bytes sniff, matching the existing house pattern
 * (`[id]/tender/route.ts`'s `validateMagicBytes`), not deep OLE2 stream
 * parsing. It confirms "genuine OLE2 compound file", not "genuinely .doc
 * as opposed to .xls" — that disambiguation relies on the client-declared
 * `file.type`, same trust boundary every mime gate in this file already
 * accepts for the initial `ALLOWED_MIME_TYPES` check.
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

/**
 * Job-type-specific body for the `analyse_form` job ({145.6} M3 CHECK
 * widening). `'analyse_form'` is not yet a member of `lib/queue/envelope.ts`
 * `JobType` — {145.13} (ANALYSE_FORM WORKER LANE + DEPLOY) owns that union
 * addition per its own file-ownership boundary ("Job type registered in
 * lib/queue/envelope.ts"). The producer (this route) and the union
 * registration are deliberately split across Subtasks; `as JobType` below is
 * the narrow, documented bridge until {145.13} lands.
 */
interface AnalyseFormJobBody extends Record<string, unknown> {
  form_id: string;
}

export const POST = defineRoute(z.unknown(), async (request: NextRequest) => {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase, role } = auth;

    const { allowed } = checkRateLimit(`form-upload:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

    // Parse multipart form data.
    const formData = await request.formData();
    const file = formData.get('file');
    const nameOverride = formData.get('name');

    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'No file provided. Upload a file using the "file" field.' },
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

    // Encrypted-package detection only applies to true OOXML/ZIP uploads
    // (docx/xlsx) — running it against a genuine legacy .doc/.xls would
    // false-positive, since those are natively OLE2 (the same envelope
    // `isEncryptedDocx` treats as "always encrypted" for a docx upload).
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

    const targetMimeType = TARGET_MIME_TYPE[file.type];
    const formInstanceId = crypto.randomUUID();
    const storagePath = `${formInstanceId}/${file.name}`;
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('tender-documents')
      .upload(storagePath, buffer, {
        // The storage object's contentType reflects the file's ACTUAL
        // current bytes (which may still be the legacy .doc/.xls format
        // pre-{145.13}-conversion), deliberately decoupled from the
        // forward-looking `form_instances.mime_type` value below.
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      logger.error(
        { err: uploadError },
        'procurement.upload: failed to upload form document to storage',
      );
      return NextResponse.json(
        { error: 'Failed to upload form document to storage.' },
        { status: 500 },
      );
    }

    const derivedName =
      (typeof nameOverride === 'string' ? nameOverride.trim() : '') ||
      file.name.replace(/\.[^./\\]+$/, '').trim() ||
      'Untitled form';

    // ID-145 {145.6}/{145.7} type-regen-skip allowance: `form_instances` /
    // `processing_status` are POST-W1 schema, not yet in the generated
    // Database type (staging DB pre-push). Expected typecheck drift.
    const insertResult = await tryQuery(
      supabase
        .from('form_instances')
        .insert({
          id: formInstanceId,
          name: derivedName,
          filename: file.name,
          storage_path: storagePath,
          file_size: file.size,
          mime_type: targetMimeType,
          ingest_source: 'app_upload',
          processing_status: 'uploaded',
          created_by: user.id,
        })
        .select(
          'id, name, filename, storage_path, file_size, mime_type, ingest_source, processing_status, form_type, created_by, created_at, updated_at',
        )
        .single(),
      'procurement.upload.formInstanceInsert',
    );

    if (!insertResult.ok) {
      // Compensate: the row failed, do not leave an orphaned storage object.
      await supabase.storage.from('tender-documents').remove([storagePath]);
      logger.error(
        { err: insertResult.error },
        'procurement.upload: failed to create form_instances record',
      );
      return NextResponse.json(
        { error: 'Failed to create form record.' },
        { status: 500 },
      );
    }

    const form = insertResult.data;

    // Enqueue the analyse_form job (TECH.md §3.1) — the {145.13} worker runs
    // Plane-1 questions ({145.12}) + Plane-2 fields ({145.10}/{145.11}) over
    // this same artefact. Service-role client: `processing_queue_select_admin`
    // is admin-only, so an editor caller's insert-with-RETURNING would fail
    // at the SELECT step under RLS — same precedent as
    // `[id]/responses/draft-all/route.ts`.
    let analyseFormJobId: string | null = null;
    let analyseFormEnqueueError: string | null = null;
    try {
      const serviceClient = createServiceClient();
      const enqueueResult = await enqueueQueueJob<AnalyseFormJobBody>({
        supabase: serviceClient,
        jobType: 'analyse_form' as JobType,
        body: { form_id: form.id },
        authContext: {
          user_id: user.id,
          role,
          workspace_id: form.id,
        },
        priority: 0,
        maxAttempts: 3,
      });
      analyseFormJobId = enqueueResult.jobId;
    } catch (err) {
      // The item WAS created (BI-9) — do not fail the whole request over a
      // queue-enqueue failure (that would misrepresent a real create as a
      // total failure). Surface the gap explicitly instead (H13 sibling-field
      // pattern) so the caller can retry analysis rather than the item
      // silently sitting at `processing_status='uploaded'` forever.
      logger.error(
        { err, formId: form.id },
        'procurement.upload: analyse_form enqueue failed — form created without a queued analysis job',
      );
      analyseFormEnqueueError = safeErrorMessage(
        err,
        'Failed to queue form analysis',
      );
    }

    return NextResponse.json(
      {
        ...form,
        analyse_form_job_id: analyseFormJobId,
        ...(analyseFormEnqueueError
          ? { analyse_form_enqueue_error: analyseFormEnqueueError }
          : {}),
      },
      { status: 201 },
    );
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to upload form document') },
      { status: 500 },
    );
  }
});
