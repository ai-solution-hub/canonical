import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  unauthorisedResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { computeDocumentDiff } from '@/lib/document-diff';

export const maxDuration = 30;

/**
 * GET /api/source-documents/[id]/diff — retrieve stored diff results
 * for a source document pair.
 *
 * Finds the diff pair by looking at the document's version chain
 * (parent_id or child relationship) and returns all stored diff entries
 * with affected content item titles.
 *
 * Auth: any authenticated user (read-only).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const { id: documentId } = await params;

    // Validate UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(documentId)) {
      return NextResponse.json(
        { error: 'Invalid document ID format' },
        { status: 400 },
      );
    }

    // Fetch the document
    const { data: doc, error: docErr } = await supabase
      .from('source_documents')
      .select('id, filename, version, created_at, parent_id')
      .eq('id', documentId)
      .single();

    if (docErr || !doc) {
      return NextResponse.json(
        { error: 'Source document not found' },
        { status: 404 },
      );
    }

    // Determine the diff pair: this document could be either the old or new side.
    // Try as old_document_id first (this is the parent, looking for diffs with a child).
    type DocInfo = { id: string; filename: string; version: number; created_at: string };
    let oldDoc: DocInfo = doc;
    let newDoc: DocInfo | null = null;

    const { data: diffAsOld } = await supabase
      .from('source_document_diffs')
      .select('new_document_id')
      .eq('old_document_id', documentId)
      .limit(1);

    if (diffAsOld && diffAsOld.length > 0) {
      // This document is the old side — fetch the new document
      const { data: child } = await supabase
        .from('source_documents')
        .select('id, filename, version, created_at')
        .eq('id', diffAsOld[0].new_document_id)
        .single();

      if (child) {
        newDoc = child;
      }
    }

    // If not found as old, try as new_document_id (this is the child, looking for diffs with parent)
    if (!newDoc) {
      const { data: diffAsNew } = await supabase
        .from('source_document_diffs')
        .select('old_document_id')
        .eq('new_document_id', documentId)
        .limit(1);

      if (diffAsNew && diffAsNew.length > 0) {
        // This document is the new side — fetch the old document
        const { data: parent } = await supabase
          .from('source_documents')
          .select('id, filename, version, created_at')
          .eq('id', diffAsNew[0].old_document_id)
          .single();

        if (parent) {
          newDoc = { ...doc };
          oldDoc = parent;
        }
      }
    }

    if (!newDoc) {
      return NextResponse.json(
        { error: 'No diff results found for this document' },
        { status: 404 },
      );
    }

    // Fetch all diff entries for this document pair
    const { data: entries, error: entriesErr } = await supabase
      .from('source_document_diffs')
      .select(
        'id, diff_type, old_question, new_question, old_content, new_content, similarity_score, affected_content_item_id, status',
      )
      .eq('old_document_id', oldDoc.id)
      .eq('new_document_id', newDoc.id)
      .order('diff_type');

    if (entriesErr) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            entriesErr,
            'Failed to fetch diff entries',
          ),
        },
        { status: 500 },
      );
    }

    // Collect affected content item IDs to fetch titles in bulk
    const affectedIds = (entries ?? [])
      .map((e) => e.affected_content_item_id)
      .filter((id): id is string => id !== null);

    let affectedTitles: Record<string, string> = {};
    if (affectedIds.length > 0) {
      const { data: items } = await supabase
        .from('content_items')
        .select('id, title')
        .in('id', affectedIds);

      if (items) {
        affectedTitles = Object.fromEntries(
          items.map((item) => [item.id, item.title ?? 'Untitled']),
        );
      }
    }

    // Build summary counts
    const summary = {
      added: 0,
      removed: 0,
      modified: 0,
      unchanged: 0,
    };
    for (const entry of entries ?? []) {
      const type = entry.diff_type as keyof typeof summary;
      if (type in summary) {
        summary[type]++;
      }
    }

    // Build response entries with affected item details
    const responseEntries = (entries ?? []).map((entry) => ({
      id: entry.id,
      diff_type: entry.diff_type,
      old_question: entry.old_question ?? undefined,
      new_question: entry.new_question ?? undefined,
      old_content: entry.old_content ?? undefined,
      new_content: entry.new_content ?? undefined,
      similarity_score: entry.similarity_score ?? undefined,
      affected_item: entry.affected_content_item_id
        ? {
            id: entry.affected_content_item_id,
            title:
              affectedTitles[entry.affected_content_item_id] ?? 'Untitled',
          }
        : undefined,
      status: entry.status,
    }));

    return NextResponse.json({
      old_document: {
        id: oldDoc.id,
        filename: oldDoc.filename,
        version: oldDoc.version,
        uploaded_at: oldDoc.created_at,
      },
      new_document: {
        id: newDoc.id,
        filename: newDoc.filename,
        version: newDoc.version,
        uploaded_at: newDoc.created_at,
      },
      summary,
      entries: responseEntries,
    });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch diff results') },
      { status: 500 },
    );
  }
}

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
