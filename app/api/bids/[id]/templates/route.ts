import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { isEncryptedDocx } from '@/lib/docx-utils';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { createServiceClient } from '@/lib/supabase/server';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

/** Only .docx files are supported for template completion */
const ALLOWED_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * Validate file magic bytes match a DOCX (ZIP archive) signature.
 * Prevents spoofed file extensions from reaching storage.
 */
function isValidDocx(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer).slice(0, 4);
  // PK\x03\x04 -- ZIP archive signature (DOCX is a ZIP container)
  return (
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Terminal bid statuses that should not accept new templates */
const TERMINAL_BID_STATUSES = new Set(['won', 'lost', 'withdrawn']);

// ──────────────────────────────────────────
// POST /api/bids/:id/templates -- upload a template
// ──────────────────────────────────────────

export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { user, supabase } = auth;

    const { id: bidId } = await params;
    if (!UUID_RE.test(bidId)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    const { allowed } = checkRateLimit(`template-upload:${user.id}`, 5, 60_000);
    if (!allowed) return rateLimitResponse();

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file');
    const name = formData.get('name') as string | null;
    const description = formData.get('description') as string | null;

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
    if (file.type !== ALLOWED_MIME_TYPE) {
      return NextResponse.json(
        {
          error:
            'Invalid file type. Only .docx files are supported for template completion.',
        },
        { status: 400 },
      );
    }

    // Read file into buffer and validate magic bytes
    const arrayBuffer = await file.arrayBuffer();
    if (!isValidDocx(arrayBuffer)) {
      return NextResponse.json(
        {
          error:
            'File content does not match its declared type. Ensure the file is a genuine .docx document.',
        },
        { status: 415 },
      );
    }

    // Reject password-protected documents early
    if (isEncryptedDocx(arrayBuffer)) {
      return NextResponse.json(
        {
          error:
            'This document is password-protected. Please remove the password and re-upload.',
        },
        { status: 400 },
      );
    }

    // Verify bid exists and is not in a terminal state
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id, status, domain_metadata')
      .eq('id', bidId)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    const bidStatus = bid.status as string | undefined;
    if (bidStatus && TERMINAL_BID_STATUSES.has(bidStatus)) {
      return NextResponse.json(
        { error: 'Cannot add templates to a completed bid.' },
        { status: 409 },
      );
    }

    // Validate template name
    const templateName = name?.trim() || file.name.replace(/\.docx$/i, '');
    if (!templateName || templateName.length > 200) {
      return NextResponse.json(
        { error: 'Template name must be between 1 and 200 characters.' },
        { status: 400 },
      );
    }

    // Create template record with a pre-generated ID for storage path
    const templateId = crypto.randomUUID();
    const storagePath = `${bidId}/${templateId}/original.docx`;

    // Upload to Supabase Storage using service client (bypasses RLS for storage)
    const serviceClient = createServiceClient();
    const buffer = Buffer.from(arrayBuffer);

    const { error: uploadError } = await serviceClient.storage
      .from('templates')
      .upload(storagePath, buffer, {
        contentType: ALLOWED_MIME_TYPE,
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload template to storage:', uploadError);
      return NextResponse.json(
        { error: 'Failed to upload template to storage.' },
        { status: 500 },
      );
    }

    // Insert template record
    const { data: template, error: insertError } = await supabase
      .from('templates')
      .insert({
        id: templateId,
        project_id: bidId,
        name: templateName,
        description: description?.trim() || null,
        filename: file.name,
        storage_path: storagePath,
        file_size: file.size,
        mime_type: ALLOWED_MIME_TYPE,
        status: 'uploaded',
        created_by: user.id,
      })
      .select(
        'id, project_id, name, description, filename, storage_path, file_size, mime_type, status, field_count, mapped_count, created_by, created_at, updated_at',
      )
      .single();

    if (insertError) {
      // Clean up uploaded file on insert failure
      await serviceClient.storage.from('templates').remove([storagePath]);
      console.error('Failed to create template record:', insertError);
      return NextResponse.json(
        { error: 'Failed to create template record.' },
        { status: 500 },
      );
    }

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to upload template') },
      { status: 500 },
    );
  }
}

// ──────────────────────────────────────────
// GET /api/bids/:id/templates -- list templates for a bid
// ──────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: bidId } = await params;
    if (!UUID_RE.test(bidId)) {
      return NextResponse.json(
        { error: 'Invalid bid ID -- must be a valid UUID' },
        { status: 400 },
      );
    }

    // Verify bid exists
    const { data: bid, error: bidError } = await supabase
      .from('workspaces')
      .select('id')
      .eq('id', bidId)
      .eq('type', 'bid')
      .single();

    if (bidError || !bid) {
      return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
    }

    // Fetch templates with completion count
    const { data: templates, error } = await supabase
      .from('templates')
      .select(
        'id, name, filename, status, field_count, mapped_count, file_size, created_at, updated_at',
      )
      .eq('project_id', bidId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch templates:', error);
      return NextResponse.json(
        { error: 'Failed to fetch templates' },
        { status: 500 },
      );
    }

    // Fetch completion counts per template
    const templateIds = (templates ?? []).map((t) => t.id);
    const completionCounts = new Map<string, number>();

    if (templateIds.length > 0) {
      const { data: completions } = await supabase
        .from('template_completions')
        .select('template_id')
        .in('template_id', templateIds);

      if (completions) {
        for (const c of completions) {
          const current = completionCounts.get(c.template_id) ?? 0;
          completionCounts.set(c.template_id, current + 1);
        }
      }
    }

    const enriched = (templates ?? []).map((t) => ({
      ...t,
      completions_count: completionCounts.get(t.id) ?? 0,
    }));

    return NextResponse.json({ templates: enriched });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch templates') },
      { status: 500 },
    );
  }
}
