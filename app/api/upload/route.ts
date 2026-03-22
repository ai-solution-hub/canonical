import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';
import { safeErrorMessage } from '@/lib/error';
import { extractPdfText as sharedExtractPdf } from '@/lib/extraction/pdf';
import path from 'path';
import crypto from 'crypto';
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
 * Validate file magic bytes match the declared MIME type.
 * Prevents spoofed file extensions from reaching storage.
 * Only validates PDF and DOCX — Markdown/TXT have no reliable magic bytes.
 */
function validateMagicBytes(buffer: Buffer, mimeType: string): boolean {
  if (mimeType === 'application/pdf') {
    // %PDF (hex: 25 50 44 46)
    return buffer.length >= 4 &&
      buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
  }
  if (mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    // PK\x03\x04 — ZIP archive signature (DOCX is a ZIP container)
    return buffer.length >= 4 &&
      buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04;
  }
  // Markdown and plain text have no magic bytes — trust the extension
  return true;
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

    // Validate magic bytes match declared MIME type (PDF and DOCX only)
    if (!validateMagicBytes(buffer, mimeType)) {
      return NextResponse.json(
        {
          error:
            'File content does not match its declared type. Ensure the file is a genuine PDF or DOCX.',
        },
        { status: 415 },
      );
    }

    // Compute MD5 hash for re-upload detection
    const contentHash = crypto.createHash('md5').update(buffer).digest('hex');

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

    // Detect re-upload (same filename from same user)
    let reuploadInfo: {
      match_type: 'identical' | 'new_version';
      existing_document_id: string;
      existing_version: number;
    } | null = null;

    try {
      const { data: reuploadMatch } = await serviceClient.rpc('detect_reupload', {
        p_filename: filename,
        p_uploaded_by: user.id,
        p_content_hash: contentHash,
      });

      if (reuploadMatch && reuploadMatch.length > 0) {
        const match = reuploadMatch[0];
        if (match.match_type === 'identical') {
          // Identical file already uploaded — warn but continue
          reuploadInfo = {
            match_type: 'identical',
            existing_document_id: match.existing_document_id,
            existing_version: match.existing_version,
          };
        } else {
          reuploadInfo = {
            match_type: 'new_version',
            existing_document_id: match.existing_document_id,
            existing_version: match.existing_version,
          };
        }
      }
    } catch (reuploadErr) {
      console.error('Re-upload detection failed:', reuploadErr);
      // Non-fatal — continue with upload
    }

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

    // Create source_documents row for lineage tracking
    let sourceDocumentId: string | null = null;
    try {
      const newVersion = reuploadInfo ? reuploadInfo.existing_version + 1 : 1;
      const parentId = reuploadInfo?.match_type === 'new_version'
        ? reuploadInfo.existing_document_id
        : null;

      const { data: sourceDoc } = await serviceClient
        .from('source_documents')
        .insert({
          filename,
          original_filename: filename,
          mime_type: mimeType,
          file_size: file.size,
          content_hash: contentHash,
          version: newVersion,
          parent_id: parentId,
          storage_path: storagePath,
          status: 'processing' as const,
          uploaded_by: user.id,
          ...(workspaceId ? { workspace_id: workspaceId } : {}),
          ...(pipelineRunId ? { pipeline_run_id: pipelineRunId } : {}),
        })
        .select('id')
        .single();

      if (sourceDoc) {
        sourceDocumentId = sourceDoc.id;
        // Link content_item to source_document
        await serviceClient
          .from('content_items')
          .update({ source_document_id: sourceDoc.id })
          .eq('id', itemId);
      }
    } catch (srcDocErr) {
      console.error('Source document tracking failed:', srcDocErr);
      // Non-fatal — upload continues without lineage tracking
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

    // 3b. Date extraction — run after text extraction, before classification
    // Non-blocking: failures logged as warnings but do not disrupt the upload
    let expiryDate: string | null = null;
    let temporalReferences: import('@/lib/date-extraction').TemporalReference[] = [];
    if (extractedText) {
      try {
        const { extractTemporalReferences, findExpiryDate, extractDates } = await import('@/lib/date-extraction');
        temporalReferences = extractTemporalReferences(extractedText);
        const dates = extractDates(extractedText);
        expiryDate = findExpiryDate(dates);
      } catch (dateErr) {
        console.error('Date extraction failed:', dateErr);
        // Non-fatal — continue without date extraction
      }
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
    // Store temporal references from date extraction
    if (temporalReferences.length > 0) {
      metadataUpdate.temporal_references = temporalReferences;
    }
    updateData.metadata = metadataUpdate;

    // Set expiry_date and lifecycle_type if a high/medium confidence expiry date was found
    if (expiryDate) {
      updateData.expiry_date = expiryDate;
      updateData.lifecycle_type = 'date_bound';
    }

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

    // Update source_documents with extracted text
    if (sourceDocumentId) {
      try {
        const extractionMeta: Record<string, string | number | boolean> = {};
        if (pageCount !== undefined) extractionMeta.page_count = pageCount;
        if (pdfTableCount > 0) extractionMeta.table_count = pdfTableCount;
        if (!extractedText) extractionMeta.extraction_failed = true;

        await serviceClient
          .from('source_documents')
          .update({
            extracted_text: extractedText || null,
            extraction_metadata: extractionMeta,
            status: extractedText ? 'processing' : 'failed',
          })
          .eq('id', sourceDocumentId);
      } catch (srcUpdateErr) {
        console.error('Source document extraction update failed:', srcUpdateErr);
      }
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
    let duplicate_matches: { id: string; title: string; similarity: number; match_type: string }[] = [];

    // Warn if an expiry date was auto-detected and applied
    if (expiryDate) {
      const formatted = new Date(expiryDate).toLocaleDateString('en-GB');
      warnings.push(`Expiry date detected: ${formatted} — lifecycle type set to date_bound`);
    }

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
          // Provide structured matches for DedupWarning component
          duplicate_matches = dedupResult.matches.map((m) => ({
            id: m.id,
            title: m.title,
            similarity: m.similarity,
            match_type: m.match_type,
          }));
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

    // Quality score — calculate and store after AI processing (classification + summary)
    if (extractedText) {
      try {
        const { calculateAndRoundQualityScore } = await import('@/lib/quality-score');

        // Fetch the latest item state (classification and summary may have updated fields)
        const { data: latestItem } = await serviceClient
          .from('content_items')
          .select('freshness, classification_confidence, brief, detail, reference, ai_summary, metadata')
          .eq('id', itemId)
          .single();

        if (latestItem) {
          const meta = latestItem.metadata as Record<string, unknown> | null;
          const score = calculateAndRoundQualityScore({
            freshness: latestItem.freshness,
            classification_confidence: latestItem.classification_confidence,
            brief: latestItem.brief,
            detail: latestItem.detail,
            reference: latestItem.reference,
            ai_summary: latestItem.ai_summary,
            citation_count: typeof meta?.citation_count === 'number' ? meta.citation_count : 0,
          });

          await serviceClient
            .from('content_items')
            .update({
              quality_score: score,
              quality_score_updated_at: new Date().toISOString(),
            })
            .eq('id', itemId);
        }
      } catch (qualityErr) {
        console.error('Quality score calculation failed:', qualityErr);
        warnings.push('Quality score calculation failed');
      }
    }

    // Layer inference — suggest and store a layer if not explicitly provided
    let suggestedLayer: { suggestedLayer: string; reason: string; confidence: string } | undefined;
    if (extractedText) {
      try {
        const { inferLayer } = await import('@/lib/layer-inference');
        const suggestion = inferLayer({
          contentType: contentType,
          contentLength: extractedText.length,
          ingestionSource: 'upload',
          hasBrief: false,
          hasDetail: false,
          hasReference: false,
          isBidDiscovered: !!workspaceId,
          title,
        });
        suggestedLayer = suggestion;

        await serviceClient.rpc('merge_item_metadata', {
          p_item_id: itemId,
          p_new_data: { layer: suggestion.suggestedLayer },
        });
      } catch (layerErr) {
        console.error('Layer inference failed:', layerErr);
        // Non-fatal — item is still usable without a layer suggestion
      }
    }

    // Topic suggestion — after layer inference
    let topicSuggestion: { topicId: string; reason: string } | undefined;
    if (extractedText) {
      try {
        const { suggestTopic } = await import('@/lib/topic-inference');

        // Fetch domain/subtopic (set by classification above)
        const { data: classified } = await serviceClient
          .from('content_items')
          .select('primary_domain, primary_subtopic')
          .eq('id', itemId)
          .single();

        const effectiveDomain = classified?.primary_domain || '';
        const effectiveSubtopic = classified?.primary_subtopic || '';

        if (effectiveDomain && effectiveSubtopic) {
          const suggestion = await suggestTopic(serviceClient, {
            primaryDomain: effectiveDomain,
            primarySubtopic: effectiveSubtopic,
            title,
            suggestedLayer: suggestedLayer?.suggestedLayer || '',
          });

          if (suggestion) {
            topicSuggestion = { topicId: suggestion.topicId, reason: suggestion.reason };
            await serviceClient.rpc('merge_item_metadata', {
              p_item_id: itemId,
              p_new_data: { topic_id: suggestion.topicId },
            });
          }
        }
      } catch (topicErr) {
        console.error('Topic suggestion failed:', topicErr);
        // Non-fatal — item is still usable without a topic suggestion
      }
    }

    // Mark source document as processed
    if (sourceDocumentId) {
      try {
        await serviceClient
          .from('source_documents')
          .update({ status: 'processed' })
          .eq('id', sourceDocumentId);
      } catch (srcStatusErr) {
        console.error('Source document status update failed:', srcStatusErr);
      }
    }

    // Trigger diff computation for re-uploads
    let diffAvailable = false;
    if (reuploadInfo?.match_type === 'new_version' && sourceDocumentId) {
      try {
        const { computeDocumentDiff } = await import('@/lib/document-diff');
        const { analyseDocumentImpact } = await import(
          '@/lib/source-document-impact'
        );

        // Get extracted text from old document
        const { data: oldDoc } = await serviceClient
          .from('source_documents')
          .select('id, extracted_text')
          .eq('id', reuploadInfo.existing_document_id)
          .single();

        if (oldDoc?.extracted_text && extractedText) {
          // Compute diff
          const diffResult = computeDocumentDiff(
            oldDoc.id,
            sourceDocumentId,
            oldDoc.extracted_text,
            extractedText,
          );

          // Store diff results
          if (diffResult.entries.length > 0) {
            const diffRows = diffResult.entries.map((entry) => ({
              old_document_id: oldDoc.id,
              new_document_id: sourceDocumentId,
              diff_type: entry.diff_type,
              old_question: entry.old_question ?? null,
              new_question: entry.new_question ?? null,
              old_content: entry.old_content ?? null,
              new_content: entry.new_content ?? null,
              similarity_score: entry.similarity_score ?? null,
              status: 'pending_review',
            }));

            await serviceClient
              .from('source_document_diffs')
              .insert(diffRows);

            diffAvailable = true;

            // Run impact analysis
            const impact = await analyseDocumentImpact(
              serviceClient,
              sourceDocumentId,
            );

            // Send notifications to affected content owners
            if (impact.total_affected_items > 0) {
              const { sendSourceDocumentUpdateNotifications } = await import(
                '@/lib/source-document-notifications'
              );
              await sendSourceDocumentUpdateNotifications(
                serviceClient,
                impact,
                sourceDocumentId,
              );
            }
          }
        }
      } catch (diffErr) {
        console.error('Diff computation failed:', diffErr);
        warnings.push('Re-upload diff computation failed');
        // Non-fatal — upload is still successful
      }
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
      duplicate_matches,
      pipeline_run_id: pipelineRunId,
      ...(sourceDocumentId && { source_document_id: sourceDocumentId }),
      ...(reuploadInfo && {
        reupload_detection: {
          match_type: reuploadInfo.match_type,
          previous_document_id: reuploadInfo.existing_document_id,
          previous_version: reuploadInfo.existing_version,
          new_version: reuploadInfo.existing_version + 1,
        },
      }),
      ...(suggestedLayer && { suggested_layer: suggestedLayer }),
      ...(topicSuggestion && { topic_suggestion: topicSuggestion }),
      ...(diffAvailable && { diff_available: true }),
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
