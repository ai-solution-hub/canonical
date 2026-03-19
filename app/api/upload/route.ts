import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import { extractPdfText as sharedExtractPdf } from '@/lib/extraction/pdf';
import path from 'path';
import mammoth from 'mammoth';

export const maxDuration = 60;

/** Maximum file size: 50 MB */
const MAX_FILE_SIZE = 52_428_800;

/** Total steps in the upload pipeline */
const TOTAL_STEPS = 5;

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
 * Extract text from a PDF using the shared extraction module.
 * Returns { text, page_count, tables, table_count }.
 */
async function extractPdfText(
  buffer: Buffer,
): Promise<PdfExtractionResult> {
  const result = await sharedExtractPdf(buffer);
  return {
    text: result.text,
    page_count: result.pageCount,
    tables: [],      // unpdf does not support table extraction
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

/**
 * Update pipeline run progress. Uses service client to bypass RLS.
 * Silently catches errors to avoid disrupting the upload pipeline.
 */
async function updatePipelineProgress(
  pipelineRunId: string,
  update: {
    step: string;
    steps_completed: number;
    steps_total: number;
    detail: string;
  },
  extraFields?: Record<string, unknown>,
): Promise<void> {
  try {
    const serviceClient = createServiceClient();
    await serviceClient
      .from('pipeline_runs')
      .update({
        progress: update,
        ...extraFields,
      })
      .eq('id', pipelineRunId);
  } catch (err) {
    console.error('Failed to update pipeline progress:', err);
  }
}

export async function POST(request: NextRequest) {
  let pipelineRunId: string | null = null;

  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
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
    const workspaceId = formData.get('workspace_id') as string | null;

    const filename = file.name;
    const title = titleOverride || titleFromFilename(filename);
    const contentType = contentTypeOverride || ALLOWED_MIME_TYPES[mimeType];

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Create pipeline_run record to track progress
    const serviceClient = createServiceClient();
    const { data: pipelineRun } = await serviceClient
      .from('pipeline_runs')
      .insert({
        pipeline_name: 'file_upload',
        status: 'running',
        source_filename: filename,
        created_by: user.id,
        items_created: [],
        ...(workspaceId ? { workspace_id: workspaceId } : {}),
        progress: {
          step: 'uploading',
          steps_completed: 0,
          steps_total: TOTAL_STEPS,
          detail: 'Creating content record and uploading file...',
        },
      })
      .select('id')
      .single();

    pipelineRunId = pipelineRun?.id ?? null;

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
      if (pipelineRunId) {
        await updatePipelineProgress(pipelineRunId, {
          step: 'failed',
          steps_completed: 0,
          steps_total: TOTAL_STEPS,
          detail: 'Failed to create content item record.',
        }, {
          status: 'failed',
          error_message: 'Failed to create content item record.',
          completed_at: new Date().toISOString(),
        });
      }
      return NextResponse.json(
        { error: 'Failed to create content item record.' },
        { status: 500 },
      );
    }

    const itemId = newItem.id;
    const storagePath = `${itemId}/${filename}`;

    // Update pipeline run with the created item ID
    if (pipelineRunId) {
      await serviceClient
        .from('pipeline_runs')
        .update({ items_created: [itemId] })
        .eq('id', pipelineRunId);
    }

    // 2. Upload file to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, buffer, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      console.error('Failed to upload to storage:', uploadError);
      // Clean up the content_item record (use service client to bypass RLS for editors)
      await serviceClient.from('content_items').delete().eq('id', itemId);
      if (pipelineRunId) {
        await updatePipelineProgress(pipelineRunId, {
          step: 'failed',
          steps_completed: 0,
          steps_total: TOTAL_STEPS,
          detail: 'Failed to upload file to storage.',
        }, {
          status: 'failed',
          error_message: 'Failed to upload file to storage.',
          completed_at: new Date().toISOString(),
          items_created: [],
        });
      }
      return NextResponse.json(
        { error: 'Failed to upload file to storage.' },
        { status: 500 },
      );
    }

    // Step 1 complete: file uploaded
    if (pipelineRunId) {
      await updatePipelineProgress(pipelineRunId, {
        step: 'extracting',
        steps_completed: 1,
        steps_total: TOTAL_STEPS,
        detail: 'Extracting text from document...',
      });
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

    // Record initial version in content_history
    await supabase.from('content_history').insert({
      content_item_id: itemId,
      version: 1,
      title: title,
      content: extractedText || '',
      change_type: 'create',
      change_summary: 'Initial upload',
      created_by: user.id,
    });

    // Step 2 complete: text extracted
    if (pipelineRunId) {
      await updatePipelineProgress(pipelineRunId, {
        step: 'embedding',
        steps_completed: 2,
        steps_total: TOTAL_STEPS,
        detail: 'Generating embedding vector...',
      });
    }

    // 5. AI processing — awaited before response to avoid serverless truncation
    const warnings: string[] = [];

    if (extractedText) {
      // Embedding
      try {
        const { generateEmbedding } = await import('@/lib/ai/embed');
        const embeddingText = `${title}\n\n${extractedText}`;
        const embedding = await generateEmbedding(embeddingText);
        await serviceClient
          .from('content_items')
          .update({ embedding: JSON.stringify(embedding) })
          .eq('id', itemId);
      } catch (embedErr) {
        console.error(`Embedding generation failed for ${itemId}:`, embedErr);
        warnings.push('Embedding generation failed');
      }

      // Step 3 complete: embedding done
      if (pipelineRunId) {
        await updatePipelineProgress(pipelineRunId, {
          step: 'classifying',
          steps_completed: 3,
          steps_total: TOTAL_STEPS,
          detail: 'Running AI classification...',
        });
      }

      // Dedup check (non-blocking — warn only)
      try {
        const { checkForDuplicates, formatDedupWarning } = await import('@/lib/dedup');
        const dedupResult = await checkForDuplicates(
          serviceClient,
          extractedText,
          undefined,
          { excludeId: itemId },
        );
        if (dedupResult.has_duplicates) {
          const warning = formatDedupWarning(dedupResult);
          if (warning) warnings.push(warning);
        }
      } catch (dedupErr) {
        console.error('Dedup check failed:', dedupErr);
      }

      // Classification (also regenerates embedding with suggested title)
      try {
        await classifyUpload(itemId, user.id);
      } catch (classifyErr) {
        const msg = classifyErr instanceof Error ? classifyErr.message : 'Unknown error';
        console.error(`Classification failed for ${itemId}:`, classifyErr);
        warnings.push(`Classification failed: ${msg}`);
      }

      // Step 4 complete: classification done
      if (pipelineRunId) {
        await updatePipelineProgress(pipelineRunId, {
          step: 'summarising',
          steps_completed: 4,
          steps_total: TOTAL_STEPS,
          detail: 'Generating AI summary...',
        });
      }

      // Summary
      try {
        await summariseUpload(itemId, user.id);
      } catch (summaryErr) {
        const msg = summaryErr instanceof Error ? summaryErr.message : 'Unknown error';
        console.error(`Summary generation failed for ${itemId}:`, summaryErr);
        warnings.push(`Summary generation failed: ${msg}`);
      }
    } else {
      warnings.push('Text extraction failed — classification, embedding, and summary skipped');
    }

    // Step 5 complete: all done
    if (pipelineRunId) {
      await updatePipelineProgress(pipelineRunId, {
        step: 'complete',
        steps_completed: TOTAL_STEPS,
        steps_total: TOTAL_STEPS,
        detail: warnings.length > 0
          ? `Completed with ${warnings.length} warning(s).`
          : 'All processing steps completed successfully.',
      }, {
        status: 'completed',
        items_processed: 1,
        completed_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      id: itemId,
      title,
      file_path: storagePath,
      content_length: extractedText.length,
      warnings,
      pipeline_run_id: pipelineRunId,
      message: extractedText
        ? 'File uploaded, text extracted, and AI processing complete.'
        : 'File uploaded but text extraction failed. The file is stored and available for manual processing.',
    });
  } catch (err) {
    // Mark pipeline run as failed if it exists
    if (pipelineRunId) {
      await updatePipelineProgress(pipelineRunId, {
        step: 'failed',
        steps_completed: 0,
        steps_total: TOTAL_STEPS,
        detail: 'Upload pipeline failed unexpectedly.',
      }, {
        status: 'failed',
        error_message: err instanceof Error ? err.message : 'Unknown error',
        completed_at: new Date().toISOString(),
      });
    }
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to process file upload') },
      { status: 500 },
    );
  }
}

/**
 * Awaited classification step for uploaded files.
 * Delegates to the shared classifyContent() service.
 */
async function classifyUpload(
  itemId: string,
  userId: string,
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();

  const { classifyContent } = await import('@/lib/ai/classify');
  await classifyContent({ supabase, itemId, force: true, userId });
}

/**
 * Awaited summary generation step for uploaded files.
 * Delegates to the shared generateSummary() service.
 */
async function summariseUpload(
  itemId: string,
  userId: string,
): Promise<void> {
  const { createServiceClient } = await import('@/lib/supabase/server');
  const supabase = createServiceClient();

  const { generateSummary } = await import('@/lib/ai/summarise');
  await generateSummary({ supabase, itemId, force: true, userId });
}
