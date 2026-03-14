import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { isEncryptedDocx } from '@/lib/docx-utils';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

/** Allowed MIME types for tender documents */
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

/**
 * Validate file magic bytes match the declared MIME type.
 * Prevents spoofed file extensions from reaching storage.
 */
function validateMagicBytes(buffer: ArrayBuffer, mimeType: string): boolean {
  const bytes = new Uint8Array(buffer).slice(0, 4);
  if (mimeType === 'application/pdf') {
    // %PDF (hex: 25 50 44 46)
    return bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // PK\x03\x04 — ZIP archive signature (DOCX is a ZIP container)
    return bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04;
  }
  return false;
}

/** POST /api/bids/:id/tender -- upload a tender document */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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
      return NextResponse.json(
        { error: 'File is empty.' },
        { status: 400 },
      );
    }

    // Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(file.type)) {
      return NextResponse.json(
        {
          error: `Unsupported file type "${file.type}". Accepted: PDF (.pdf) and DOCX (.docx).`,
        },
        { status: 400 },
      );
    }

    // Verify bid exists
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, domain_metadata')
      .eq('id', id)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json(
        { error: 'Bid not found' },
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
            'File content does not match its declared type. Ensure the file is a genuine PDF or DOCX.',
        },
        { status: 415 },
      );
    }

    // Reject password-protected .docx documents early (PDFs are not affected)
    if (
      file.type ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document' &&
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

    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await supabase.storage
      .from('tender-documents')
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
      });

    if (uploadError) {
      console.error('Failed to upload tender document:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload tender document to storage.' },
        { status: 500 },
      );
    }

    // Update bid's domain_metadata.tender_document_ids array
    const currentMetadata = (bid.domain_metadata ?? {}) as Record<string, unknown>;
    const existingDocIds = Array.isArray(currentMetadata.tender_document_ids)
      ? (currentMetadata.tender_document_ids as string[])
      : [];

    // Append the storage path if not already present
    const updatedDocIds = existingDocIds.includes(storagePath)
      ? existingDocIds
      : [...existingDocIds, storagePath];

    const { error: updateError } = await supabase
      .from('workspaces')
      .update({
        domain_metadata: {
          ...currentMetadata,
          tender_document_ids: updatedDocIds,
        },
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('type', 'bid');

    if (updateError) {
      console.error('Failed to update bid metadata:', updateError);
      return NextResponse.json(
        { error: 'File uploaded but failed to update bid metadata.' },
        { status: 500 },
      );
    }

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
}
