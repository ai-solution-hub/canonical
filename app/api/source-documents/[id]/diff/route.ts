import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { computeDocumentDiff } from '@/lib/document-diff';

export const maxDuration = 30;

/**
 * POST /api/source-documents/[id]/diff — compute a Q&A pair diff between
 * this document (old) and another document version (new).
 *
 * Stores the diff results in source_document_diffs and returns the summary.
 *
 * Auth: editor or admin.
 *
 * Request body: { new_document_id: string }
 * Response: { diff_id: string, summary: ..., entries: DiffEntry[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['editor', 'admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const { id: oldDocumentId } = await params;

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(oldDocumentId)) {
      return NextResponse.json(
        { error: 'Invalid document ID format' },
        { status: 400 },
      );
    }

    // Parse request body
    let body: { new_document_id?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }

    const { new_document_id: newDocumentId } = body;
    if (!newDocumentId || !uuidRegex.test(newDocumentId)) {
      return NextResponse.json(
        { error: 'new_document_id is required and must be a valid UUID' },
        { status: 400 },
      );
    }

    if (oldDocumentId === newDocumentId) {
      return NextResponse.json(
        { error: 'Cannot diff a document with itself' },
        { status: 400 },
      );
    }

    // Fetch both source documents
    const { data: oldDoc, error: oldErr } = await supabase
      .from('source_documents')
      .select('id, extracted_text, filename')
      .eq('id', oldDocumentId)
      .single();

    if (oldErr || !oldDoc) {
      return NextResponse.json(
        { error: 'Old source document not found' },
        { status: 404 },
      );
    }

    const { data: newDoc, error: newErr } = await supabase
      .from('source_documents')
      .select('id, extracted_text, filename')
      .eq('id', newDocumentId)
      .single();

    if (newErr || !newDoc) {
      return NextResponse.json(
        { error: 'New source document not found' },
        { status: 404 },
      );
    }

    // Compute the diff
    const diffResult = computeDocumentDiff(
      oldDocumentId,
      newDocumentId,
      oldDoc.extracted_text ?? '',
      newDoc.extracted_text ?? '',
    );

    // Store diff entries in the database
    if (diffResult.entries.length > 0) {
      const rows = diffResult.entries.map((entry) => ({
        old_document_id: oldDocumentId,
        new_document_id: newDocumentId,
        diff_type: entry.diff_type,
        old_content: entry.old_content ?? null,
        new_content: entry.new_content ?? null,
        old_question: entry.old_question ?? null,
        new_question: entry.new_question ?? null,
        similarity_score: entry.similarity_score ?? null,
        status: 'pending_review' as const,
      }));

      const { error: insertError } = await supabase
        .from('source_document_diffs')
        .insert(rows);

      if (insertError) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              insertError,
              'Failed to store diff results',
            ),
          },
          { status: 500 },
        );
      }
    }

    return NextResponse.json({
      old_document_id: oldDocumentId,
      new_document_id: newDocumentId,
      summary: diffResult.summary,
      entries: diffResult.entries,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to compute document diff') },
      { status: 500 },
    );
  }
}
