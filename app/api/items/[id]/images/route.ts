import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { toJson } from '@/lib/validation/jsonb';
import { getDocumentProxy, extractImages } from 'unpdf';
import sharp from 'sharp';
import { createHash } from 'crypto';

export const maxDuration = 60;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Minimum pixel dimension — skip images smaller than 50x50 (decorative/icons) */
const MIN_DIMENSION = 50;

/** Maximum images to extract per PDF */
const MAX_IMAGES = 20;

/** Maximum raw pixel data size per image (5 MB) */
const MAX_IMAGE_BYTES = 5_000_000;

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
 * extracts embedded images using unpdf + sharp (no Python dependency),
 * uploads each image to Storage, and persists metadata via merge_item_metadata.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
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

    // Extract images using unpdf + sharp (no Python subprocess)
    const pdfData = new Uint8Array(pdfBuffer);
    const pdf = await getDocumentProxy(pdfData);
    const extractedImages: ExtractedImageOutput[] = [];
    const seenHashes = new Set<string>();

    try {
      for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        if (extractedImages.length >= MAX_IMAGES) break;

        let pageImages;
        try {
          pageImages = await extractImages(pdf, pageNum);
        } catch {
          // Skip pages where image extraction fails
          continue;
        }

        let imgIndex = 0;
        for (const img of pageImages) {
          if (extractedImages.length >= MAX_IMAGES) break;

          // Filter by minimum dimensions
          if (img.width < MIN_DIMENSION || img.height < MIN_DIMENSION) continue;

          // Filter by maximum raw data size
          if (img.data.byteLength > MAX_IMAGE_BYTES) continue;

          // Deduplicate by hashing first 4KB of pixel data
          const hashSlice = img.data.slice(0, 4096);
          const dataHash = createHash('md5')
            .update(Buffer.from(hashSlice))
            .digest('hex');

          if (seenHashes.has(dataHash)) continue;
          seenHashes.add(dataHash);

          // Encode raw pixel data to JPEG or PNG using sharp
          const hasAlpha = img.channels === 4;
          let encodedBuffer: Buffer;
          let format: string;

          try {
            const sharpInstance = sharp(Buffer.from(img.data), {
              raw: {
                width: img.width,
                height: img.height,
                channels: img.channels,
              },
            });

            if (hasAlpha) {
              encodedBuffer = await sharpInstance.png().toBuffer();
              format = 'png';
            } else {
              encodedBuffer = await sharpInstance
                .jpeg({ quality: 85 })
                .toBuffer();
              format = 'jpeg';
            }
          } catch {
            // Skip images that sharp cannot process
            continue;
          }

          extractedImages.push({
            page: pageNum,
            index: imgIndex,
            width: img.width,
            height: img.height,
            format,
            data_base64: encodedBuffer.toString('base64'),
          });

          imgIndex++;
        }
      }
    } finally {
      pdf.cleanup();
    }

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
