import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { toJson } from '@/lib/validation/jsonb';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';
import { promisify } from 'util';
import { execFile as execFileCb } from 'child_process';

const execFile = promisify(execFileCb);

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ExtractedImageMeta {
  page: number;
  index: number;
  path: string;
  width: number;
  height: number;
  format: string;
}

interface ExtractedImageOutput {
  page: number;
  index: number;
  width: number;
  height: number;
  format: string;
  data_base64: string;
}

/**
 * POST /api/items/:id/images — Extract and store images from a PDF item.
 *
 * Downloads the PDF from Supabase Storage (file_path) or source_url,
 * runs the Python extraction script, uploads each image to Storage,
 * and persists metadata via merge_item_metadata.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase, user } = auth;

    const { allowed } = checkRateLimit(`images:${user.id}`, 3, 60_000);
    if (!allowed) return rateLimitResponse();

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch item
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select(
        'id, content_type, file_path, source_url, metadata',
      )
      .eq('id', id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    if (item.content_type !== 'pdf') {
      return NextResponse.json(
        { error: 'Image extraction is only available for PDF items' },
        { status: 400 },
      );
    }

    // Get PDF data
    let pdfBuffer: Buffer;

    if (item.file_path) {
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('documents')
        .download(item.file_path);

      if (downloadError || !fileData) {
        return NextResponse.json(
          { error: 'Failed to download PDF from storage' },
          { status: 500 },
        );
      }

      pdfBuffer = Buffer.from(await fileData.arrayBuffer());
    } else if (item.source_url) {
      const response = await fetch(item.source_url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) {
        return NextResponse.json(
          {
            error: `Failed to fetch PDF from source URL (HTTP ${response.status})`,
          },
          { status: 502 },
        );
      }

      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('pdf')) {
        return NextResponse.json(
          { error: 'Source URL does not appear to be a PDF' },
          { status: 400 },
        );
      }

      pdfBuffer = Buffer.from(await response.arrayBuffer());
    } else {
      return NextResponse.json(
        { error: 'No PDF file or source URL available for this item' },
        { status: 400 },
      );
    }

    // Write PDF to temp file and run extraction script
    const tmpPath = path.join(
      os.tmpdir(),
      `ims-pdf-images-${Date.now()}.pdf`,
    );

    try {
      await fs.writeFile(tmpPath, pdfBuffer);

      const scriptPath = path.resolve(
        process.cwd(),
        'scripts',
        'extract_pdf_images.py',
      );

      const { stdout } = await execFile('python3', [scriptPath, tmpPath], {
        timeout: 60_000,
        maxBuffer: 100 * 1024 * 1024, // 100 MB — images can be large
      });

      const result = JSON.parse(stdout);
      if (result.error) {
        return NextResponse.json(
          { error: `Image extraction failed: ${result.error}` },
          { status: 500 },
        );
      }

      const extractedImages: ExtractedImageOutput[] = result.images || [];

      if (extractedImages.length === 0) {
        // Store empty array to indicate extraction was attempted
        await supabase.rpc('merge_item_metadata', {
          p_item_id: id,
          p_new_data: toJson({
            extracted_images: [],
            images_extracted_at: new Date().toISOString(),
          }),
        });

        return NextResponse.json({
          images: [],
          message: 'No extractable images found in this PDF.',
        });
      }

      // Upload each image to Supabase Storage and collect metadata
      const imageMetas: ExtractedImageMeta[] = [];
      const uploadErrors: string[] = [];

      for (const img of extractedImages) {
        const ext = img.format === 'png' ? 'png' : 'jpg';
        const storagePath = `${id}/images/page${img.page}_img${img.index}.${ext}`;
        const mimeType =
          img.format === 'png' ? 'image/png' : 'image/jpeg';

        const imgBuffer = Buffer.from(img.data_base64, 'base64');

        const { error: uploadError } = await supabase.storage
          .from('documents')
          .upload(storagePath, imgBuffer, {
            contentType: mimeType,
            upsert: true,
          });

        if (uploadError) {
          uploadErrors.push(
            `page${img.page}_img${img.index}: ${uploadError.message}`,
          );
          continue;
        }

        imageMetas.push({
          page: img.page,
          index: img.index,
          path: storagePath,
          width: img.width,
          height: img.height,
          format: img.format,
        });
      }

      // Store metadata via merge_item_metadata RPC
      const { error: mergeError } = await supabase.rpc(
        'merge_item_metadata',
        {
          p_item_id: id,
          p_new_data: toJson({
            extracted_images: imageMetas,
            images_extracted_at: new Date().toISOString(),
          }),
        },
      );

      return NextResponse.json({
        images: imageMetas,
        total_found: extractedImages.length,
        total_uploaded: imageMetas.length,
        ...(uploadErrors.length > 0
          ? { upload_warnings: uploadErrors }
          : {}),
        ...(mergeError
          ? {
              warning:
                'Images uploaded but failed to persist metadata',
            }
          : {}),
      });
    } finally {
      await fs.unlink(tmpPath).catch(() => {
        /* ignore cleanup errors */
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(
          err,
          'Failed to extract images from PDF',
        ),
      },
      { status: 500 },
    );
  }
}

/**
 * GET /api/items/:id/images — Get signed URLs for extracted images.
 *
 * Reads metadata.extracted_images from the item and generates
 * temporary signed URLs (1 hour expiry) for each image.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id } = await params;

    if (!UUID_RE.test(id)) {
      return NextResponse.json(
        { error: 'Invalid item ID — must be a valid UUID' },
        { status: 400 },
      );
    }

    // Fetch item metadata
    const { data: item, error: fetchError } = await supabase
      .from('content_items')
      .select('id, metadata')
      .eq('id', id)
      .single();

    if (fetchError || !item) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    }

    const metadata = (item.metadata ?? {}) as Record<string, unknown>;
    const extractedImages = metadata.extracted_images as
      | ExtractedImageMeta[]
      | undefined;

    if (!extractedImages || extractedImages.length === 0) {
      return NextResponse.json({ images: [] });
    }

    // Generate signed URLs for each image
    const imagesWithUrls = await Promise.all(
      extractedImages.map(async (img) => {
        const { data } = await supabase.storage
          .from('documents')
          .createSignedUrl(img.path, 3600); // 1 hour

        return {
          url: data?.signedUrl ?? null,
          page: img.page,
          index: img.index,
          width: img.width,
          height: img.height,
          format: img.format,
        };
      }),
    );

    // Filter out images where URL generation failed
    const validImages = imagesWithUrls.filter((img) => img.url !== null);

    return NextResponse.json({
      images: validImages,
      extracted_at: metadata.images_extracted_at ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: safeErrorMessage(
          err,
          'Failed to retrieve PDF images',
        ),
      },
      { status: 500 },
    );
  }
}
