import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import path from 'path';
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

/** Allowed MIME types and their corresponding content_type values */
const ALLOWED_MIME_TYPES: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'other',
  'text/markdown': 'note',
  'text/plain': 'note',
};

/** Map file extensions to MIME types (fallback when browser MIME is unreliable) */
const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.md': 'text/markdown',
  '.txt': 'text/plain',
};

function detectMimeType(filename: string, providedMime: string): string {
  const ext = path.extname(filename).toLowerCase();
  // Prefer extension-based detection if the provided MIME is generic
  if (
    providedMime === 'application/octet-stream' &&
    EXTENSION_TO_MIME[ext]
  ) {
    return EXTENSION_TO_MIME[ext];
  }
  // If provided MIME is valid, use it
  if (ALLOWED_MIME_TYPES[providedMime]) {
    return providedMime;
  }
  // Fall back to extension
  return EXTENSION_TO_MIME[ext] ?? providedMime;
}

/**
 * Derive a sensible title from the filename.
 * Strips extension, replaces hyphens/underscores with spaces, title-cases.
 */
function titleFromFilename(filename: string): string {
  const name = path.basename(filename, path.extname(filename));
  return name
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

interface PdfTable {
  page: number;
  table_index: number;
  headers: string[];
  rows: string[][];
  row_count: number;
}

interface PdfExtractionResult {
  text: string;
  page_count: number;
  tables: PdfTable[];
  table_count: number;
}

/**
 * Extract text from a PDF using unpdf (JavaScript, no Python dependency).
 * Returns { text, page_count, tables, table_count }.
 */
async function extractPdfText(
  buffer: Buffer,
): Promise<PdfExtractionResult> {
  const data = new Uint8Array(buffer);
  const pdf = await getDocumentProxy(data);
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return {
    text: (text as string[]).join('\n\n'),
    page_count: totalPages,
    tables: [],
    table_count: 0,
  };
}

/**
 * Extract text from a DOCX file using mammoth.
 */
async function extractDocxText(
  buffer: Buffer,
): Promise<{ text: string }> {
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value };
}

export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

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

    // Detect and validate MIME type
    const mimeType = detectMimeType(file.name, file.type);
    if (!ALLOWED_MIME_TYPES[mimeType]) {
      const ext = path.extname(file.name).toLowerCase();
      return NextResponse.json(
        {
          error: `Unsupported file type "${ext || file.type}". Accepted: PDF, DOCX, Markdown (.md), Text (.txt).`,
        },
        { status: 400 },
      );
    }

    // Read optional overrides from form data
    const titleOverride = formData.get('title') as string | null;
    const contentTypeOverride = formData.get('content_type') as string | null;
    const authorOverride = formData.get('author') as string | null;

    const filename = file.name;
    const title = titleOverride || titleFromFilename(filename);
    const contentType = contentTypeOverride || ALLOWED_MIME_TYPES[mimeType];

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 1. Create content_item record first (to get UUID)
    const { data: newItem, error: insertError } = await supabase
      .from('content_items')
      .insert({
        title: title,
        content: '',
        suggested_title: title,
        content_type: contentType,
        platform: 'manual',
        metadata: {
          original_filename: filename,
          file_size: file.size,
          mime_type: mimeType,
          ingestion_source: 'upload',
        },
        ...(authorOverride ? { author_name: authorOverride } : {}),
        created_by: user.id,
      })
      .select('id')
      .single();

    if (insertError || !newItem) {
      console.error('Failed to create content item:', insertError);
      return NextResponse.json(
        { error: 'Failed to create content item record.' },
        { status: 500 },
      );
    }

    const itemId = newItem.id;
    const storagePath = `${itemId}/${filename}`;

    // 2. Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload to storage:', uploadError);
      // Clean up the content_item record
      await supabase.from('content_items').delete().eq('id', itemId);
      return NextResponse.json(
        { error: 'Failed to upload file to storage.' },
        { status: 500 },
      );
    }

    // 3. Extract text based on MIME type
    let extractedText = '';
    let pageCount: number | undefined;
    let pdfTables: PdfTable[] = [];
    let pdfTableCount = 0;

    try {
      if (mimeType === 'application/pdf') {
        const result = await extractPdfText(buffer);
        extractedText = result.text;
        pageCount = result.page_count;
        pdfTables = result.tables;
        pdfTableCount = result.table_count;
      } else if (
        mimeType ===
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      ) {
        const result = await extractDocxText(buffer);
        extractedText = result.text;
      } else {
        // Markdown or plain text — direct passthrough
        extractedText = buffer.toString('utf-8');
      }
    } catch (extractErr) {
      console.error('Text extraction failed:', extractErr);
      // Update item with a note about extraction failure, but don't fail the upload
      extractedText = '';
    }

    // 4. Update the content_item with extracted content, file_path, and metadata
    const updateData: Record<string, unknown> = {
      content: extractedText || '',
      file_path: storagePath,
    };

    // Merge additional metadata (page_count, tables, extraction status)
    const metadataUpdate: Record<string, unknown> = {
      original_filename: filename,
      file_size: file.size,
      mime_type: mimeType,
      ingestion_source: 'upload',
    };
    if (pageCount !== undefined) {
      metadataUpdate.page_count = pageCount;
    }
    if (pdfTableCount > 0) {
      metadataUpdate.tables = pdfTables;
      metadataUpdate.table_count = pdfTableCount;
    }
    if (!extractedText) {
      metadataUpdate.extraction_failed = true;
    }
    updateData.metadata = metadataUpdate;

    updateData.updated_by = user.id;

    const { data: updatedItem, error: updateError } = await supabase
      .from('content_items')
      .update(updateData)
      .eq('id', itemId)
      .select('id')
      .single();

    if (updateError || !updatedItem) {
      console.error('Failed to update content item:', updateError);
      // The item and file exist, just the update failed
      return NextResponse.json(
        { error: 'File uploaded but failed to update content record.' },
        { status: 500 },
      );
    }

    return NextResponse.json({
      id: itemId,
      title,
      file_path: storagePath,
      content_length: extractedText.length,
      status: 'queued',
      message: extractedText
        ? 'File uploaded and text extracted. Item is queued for classification and embedding.'
        : 'File uploaded but text extraction failed. The file is stored and available for manual processing.',
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process file upload') },
      { status: 500 },
    );
  }
}
