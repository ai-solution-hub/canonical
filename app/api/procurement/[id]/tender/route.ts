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
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Allowed MIME types for tender documents */
const ALLOWED_MIME_TYPES = new Set(['application/pdf', DOCX_MIME, XLSX_MIME]);

/**
 * Validate file magic bytes match the declared MIME type.
 * Prevents spoofed file extensions from reaching storage.
 */
function validateMagicBytes(buffer: ArrayBuffer, mimeType: string): boolean {
  const bytes = new Uint8Array(buffer).slice(0, 4);
  if (mimeType === 'application/pdf') {
    // %PDF (hex: 25 50 44 46)
    return (
      bytes[0] === 0x25 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x44 &&
      bytes[3] === 0x46
    );
  }
  if (mimeType === DOCX_MIME || mimeType === XLSX_MIME) {
    // PK\x03\x04 — ZIP archive signature (DOCX and XLSX are ZIP containers)
    return (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      bytes[2] === 0x03 &&
      bytes[3] === 0x04
    );
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
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      const { allowed } = checkRateLimit(`tender-upload:${user.id}`, 5, 60_000);
      if (!allowed) return rateLimitResponse();

      // Parse multipart form data
      const formData = await request.formData();
      const file = formData.get('file');

      if (!file || !(file instanceof File)) {
        return NextResponse.json(
          { error: 'No file provided. Upload a file using the "file" field.' },
          { status: 400 },
        );
      }

      // Validate file size
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

      // Validate MIME type
      if (!ALLOWED_MIME_TYPES.has(file.type)) {
        return NextResponse.json(
          {
            error: `Unsupported file type "${file.type}". Accepted: PDF (.pdf), DOCX (.docx) and XLSX (.xlsx).`,
          },
          { status: 400 },
        );
      }

      // Verify bid exists.
      // ID-145 {145.23} round-2 runtime grep sweep (mandatory extra #2, DR-056):
      // workspaces/procurement_workspaces are wholesale-deleted for
      // procurement (W1e, {145.6}) — [id] IS the form_instances PK now.
      const { data: bid, error: procurementError } = await supabase
        .from('form_instances')
        .select('id')
        .eq('id', id)
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Upload to Supabase Storage
      const storagePath = `${id}/${file.name}`;
      const arrayBuffer = await file.arrayBuffer();

      // Validate magic bytes match declared MIME type
      if (!validateMagicBytes(arrayBuffer, file.type)) {
        return NextResponse.json(
          {
            error:
              'File content does not match its declared type. Ensure the file is a genuine PDF, DOCX or XLSX.',
          },
          { status: 415 },
        );
      }

      // Reject password-protected .docx documents early (PDFs are not affected)
      if (file.type === DOCX_MIME && isEncryptedDocx(arrayBuffer)) {
        return NextResponse.json(
          {
            error:
              'This document is password-protected. Please remove the password and re-upload.',
          },
          { status: 400 },
        );
      }

      const buffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabase.storage
        .from('tender-documents')
        .upload(storagePath, buffer, {
          contentType: file.type,
          upsert: true,
        });

      if (uploadError) {
        logger.error({ err: uploadError }, 'Failed to upload tender document');
        return NextResponse.json(
          { error: 'Failed to upload tender document to storage.' },
          { status: 500 },
        );
      }

      // ID-145 {145.23} round-2 (mandatory extra #2, DR-056): the
      // domain_metadata.tender_document_ids write that used to live here is
      // REMOVED, not re-pointed — form_instances has no domain_metadata (or
      // any JSONB metadata bag) column, AND the read side no longer consumes
      // this field: `deriveProcurementMetadata`
      // (lib/domains/procurement/procurement-detail-shape.ts, {145.18})
      // already re-anchored `tender_document_ids` onto the live
      // `tender_documents` storage-bucket listing (GET
      // app/api/procurement/[id]/route.ts lists `tender-documents/<id>/...`
      // directly) — "no domain_metadata read... tender_document_ids is the
      // ONE surviving legacy key, sourced from tender_documents" per that
      // file's own docstring. This write was already vestigial (dead write,
      // superseded reader) and ALSO tsc-invisibly broken (workspaces row
      // doesn't exist post-W1e) — every upload was returning a false-negative
      // "File uploaded but failed to update bid metadata" 500 even though
      // the upload itself (above) succeeded and was already correctly
      // reflected via the storage-listing read path.

      return NextResponse.json({
        path: storagePath,
        filename: file.name,
        size: file.size,
        mime_type: file.type,
        extraction_status: 'pending',
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to upload tender document') },
        { status: 500 },
      );
    }
  },
);
