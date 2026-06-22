import {
  deleteAnthropicFile,
  getAnthropicFileMetadata,
  uploadFileToAnthropic,
} from '@/lib/anthropic-files';
import { defineRoute } from '@/lib/api/define-route';
import {
  authFailureResponse,
  getAuthorisedClient,
  rateLimitResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { checkRateLimit } from '@/lib/rate-limit';
import { toJson } from '@/lib/validation/jsonb';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

export const maxDuration = 60;

/** Maximum file size for Anthropic Files API upload (32 MB). */
const MAX_FILE_SIZE = 32 * 1024 * 1024;

// TODO(OPS-T1): author ResponseSchema
export const POST = defineRoute(
  z.unknown(),
  async (
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase, user } = auth;

      const { allowed } = checkRateLimit(`files:${user.id}`, 10, 60_000);
      if (!allowed) return rateLimitResponse();

      const { id } = await params;

      // Fetch the content item
      const { data: item, error: fetchError } = await supabase
        .from('content_items')
        .select(
          'id, content_type, file_path, source_url, suggested_title, title, metadata',
        )
        .eq('id', id)
        .single();

      if (fetchError || !item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      // Check if already uploaded
      const metadata = item.metadata as Record<string, unknown> | null;
      const existingFileId = (
        metadata?.anthropic_file as Record<string, unknown>
      )?.file_id as string | undefined;
      if (existingFileId) {
        // Verify the file still exists
        try {
          const fileInfo = await getAnthropicFileMetadata(existingFileId);
          return NextResponse.json({
            file_id: fileInfo.id,
            filename: fileInfo.filename,
            size: fileInfo.size,
            already_uploaded: true,
          });
        } catch {
          // File no longer exists, proceed to re-upload
        }
      }

      // Get the file data
      let buffer: Buffer;
      let filename: string;
      let mimeType: string;

      if (item.file_path) {
        const { data: fileData, error: downloadError } = await supabase.storage
          .from('documents')
          .download(item.file_path);

        if (downloadError || !fileData) {
          return NextResponse.json(
            { error: 'Failed to download file from storage' },
            { status: 500 },
          );
        }

        buffer = Buffer.from(await fileData.arrayBuffer());
        filename = item.file_path.split('/').pop() || 'document.pdf';
        mimeType = 'application/pdf';
      } else if (item.source_url && item.content_type === 'pdf') {
        const response = await fetch(item.source_url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          },
          signal: AbortSignal.timeout(30_000),
        });

        if (!response.ok) {
          return NextResponse.json(
            {
              error: `Failed to fetch file from source URL (HTTP ${response.status})`,
            },
            { status: 502 },
          );
        }

        buffer = Buffer.from(await response.arrayBuffer());
        filename =
          item.source_url.split('/').pop()?.split('?')[0] || 'document.pdf';
        mimeType = response.headers.get('content-type') || 'application/pdf';
      } else {
        return NextResponse.json(
          { error: 'No file or PDF source URL available for this item' },
          { status: 400 },
        );
      }

      if (buffer.length > MAX_FILE_SIZE) {
        return NextResponse.json(
          {
            error: `File too large (${(buffer.length / 1024 / 1024).toFixed(1)} MB, max 32 MB)`,
          },
          { status: 413 },
        );
      }

      // Upload to Anthropic Files API
      const result = await uploadFileToAnthropic(buffer, filename, mimeType);

      // Store the file_id in item metadata
      const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
        p_item_id: id,
        p_new_data: toJson({
          anthropic_file: {
            file_id: result.fileId,
            filename: result.filename,
            uploaded_at: new Date().toISOString(),
            size_bytes: buffer.length,
          },
        }),
      });

      return NextResponse.json({
        file_id: result.fileId,
        filename: result.filename,
        size: buffer.length,
        ...(mergeError
          ? {
              warning:
                'Upload succeeded but failed to persist file_id to metadata',
            }
          : {}),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to upload file to Anthropic') },
        { status: 500 },
      );
    }
  },
);

// TODO(OPS-T1): author ResponseSchema
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

      const { data: item, error: fetchError } = await supabase
        .from('content_items')
        .select('id, metadata')
        .eq('id', id)
        .single();

      if (fetchError || !item) {
        return NextResponse.json({ error: 'Item not found' }, { status: 404 });
      }

      const metadata = item.metadata as Record<string, unknown> | null;
      const fileId = (metadata?.anthropic_file as Record<string, unknown>)
        ?.file_id as string | undefined;

      if (!fileId) {
        return NextResponse.json(
          { error: 'No Anthropic file associated with this item' },
          { status: 404 },
        );
      }

      // Delete from Anthropic
      try {
        await deleteAnthropicFile(fileId);
      } catch {
        // File may already be deleted — proceed to clean up metadata
      }

      // Remove from metadata
      const { error: mergeError } = await supabase.rpc('merge_item_metadata', {
        p_item_id: id,
        p_new_data: toJson({ anthropic_file: null }),
      });

      return NextResponse.json({
        deleted: true,
        ...(mergeError
          ? { warning: 'File deleted but failed to update metadata' }
          : {}),
      });
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to delete Anthropic file') },
        { status: 500 },
      );
    }
  },
);
