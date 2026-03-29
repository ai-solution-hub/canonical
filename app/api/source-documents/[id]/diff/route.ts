import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  getAuthorisedClient,
  authFailureResponse,
  unauthorisedResponse,
} from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { DiffRequestBodySchema, DiffReviewUpdateBodySchema } from '@/lib/validation/schemas';
import { computeDocumentDiff } from '@/lib/source-documents/document-diff';

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
        'id, diff_type, diff_mode, old_question, new_question, old_content, new_content, similarity_score, section_header, affected_content_item_id, status, reviewer_note',
      )
      .eq('old_document_id', oldDoc.id)
      .eq('new_document_id', newDoc.id)
      .order('diff_type') as unknown as {
        data: Array<{
          id: string;
          diff_type: string;
          diff_mode: string | null;
          old_question: string | null;
          new_question: string | null;
          old_content: string | null;
          new_content: string | null;
          similarity_score: number | null;
          section_header: string | null;
          affected_content_item_id: string | null;
          status: string;
          reviewer_note: string | null;
        }> | null;
        error: { message: string; code?: string } | null;
      };

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
      diff_mode: (entry.diff_mode ?? 'qa') as 'qa' | 'full_text',
      old_question: entry.old_question ?? undefined,
      new_question: entry.new_question ?? undefined,
      old_content: entry.old_content ?? undefined,
      new_content: entry.new_content ?? undefined,
      similarity_score: entry.similarity_score ?? undefined,
      section_header: entry.section_header ?? undefined,
      affected_item: entry.affected_content_item_id
        ? {
            id: entry.affected_content_item_id,
            title:
              affectedTitles[entry.affected_content_item_id] ?? 'Untitled',
          }
        : undefined,
      status: entry.status,
      reviewer_note: entry.reviewer_note ?? undefined,
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

    // Parse and validate request body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }
    const parsed = parseBody(DiffRequestBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { new_document_id: newDocumentId } = parsed.data;

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
        diff_mode: entry.diff_mode ?? diffResult.diff_mode,
        old_content: entry.old_content ?? null,
        new_content: entry.new_content ?? null,
        old_question: entry.old_question ?? null,
        new_question: entry.new_question ?? null,
        similarity_score: entry.similarity_score ?? null,
        section_header: entry.section_header ?? null,
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

/**
 * PATCH /api/source-documents/[id]/diff — update review status for diff entries.
 *
 * Allows editors/admins to mark diff entries as applied, dismissed, or
 * reset them back to pending_review.
 *
 * Auth: editor or admin.
 *
 * Request body: { entries: Array<{ id: string, status: 'applied' | 'dismissed' | 'pending_review' }> }
 * Response: { updated: Array<{ id, status, updated_at }>, summary: { pending_review, applied, dismissed } }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await getAuthorisedClient(['editor', 'admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

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

    // Parse and validate request body
    let raw: unknown;
    try {
      raw = await request.json();
    } catch {
      return NextResponse.json(
        { error: 'Invalid JSON body' },
        { status: 400 },
      );
    }
    const parsed = parseBody(DiffReviewUpdateBodySchema, raw);
    if (!parsed.success) return parsed.response;
    const { entries } = parsed.data;

    const entryIds = entries.map((e) => e.id);

    // Verify all entry IDs belong to this document's diff pair
    const { data: matchingEntries } = await supabase
      .from('source_document_diffs')
      .select('id')
      .or(`old_document_id.eq.${documentId},new_document_id.eq.${documentId}`)
      .in('id', entryIds);

    const matchingIds = new Set((matchingEntries ?? []).map((e) => e.id));
    const missingIds = entryIds.filter((id) => !matchingIds.has(id));

    if (missingIds.length > 0) {
      return NextResponse.json(
        { error: `Entry IDs do not belong to this document: ${missingIds.join(', ')}` },
        { status: 404 },
      );
    }

    // Separate entries with notes (need individual updates) from those without
    const entriesWithNotes = entries.filter((e) => e.note !== undefined);
    const entriesWithoutNotes = entries.filter((e) => e.note === undefined);

    // Group note-free entries by target status for batch updates
    const byStatus: Record<string, string[]> = {};
    for (const entry of entriesWithoutNotes) {
      const status = entry.status;
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(entry.id);
    }

    const now = new Date().toISOString();
    const updatedResults: Array<{ id: string; status: string; updated_at: string }> = [];

    for (const [status, ids] of Object.entries(byStatus)) {
      const isReviewed = status !== 'pending_review';
      const updatePayload = {
        status,
        updated_at: now,
        reviewed_at: isReviewed ? now : null,
        reviewed_by: isReviewed ? user.id : null,
      };

      const { error: updateErr } = await supabase
        .from('source_document_diffs')
        .update(updatePayload)
        .in('id', ids);

      if (updateErr) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              updateErr,
              'Failed to update diff entry status',
            ),
          },
          { status: 500 },
        );
      }

      for (const id of ids) {
        updatedResults.push({ id, status, updated_at: now });
      }
    }

    // Handle entries with notes individually (notes are per-entry)
    for (const entry of entriesWithNotes) {
      const status = entry.status;
      const isReviewed = status !== 'pending_review';
      const updatePayload = {
        status,
        updated_at: now,
        reviewed_at: isReviewed ? now : null,
        reviewed_by: isReviewed ? user.id : null,
        reviewer_note: entry.note ?? null,
      };

      const { error: updateErr } = await supabase
        .from('source_document_diffs')
        .update(updatePayload)
        .eq('id', entry.id);

      if (updateErr) {
        return NextResponse.json(
          {
            error: safeErrorMessage(
              updateErr,
              'Failed to update diff entry status',
            ),
          },
          { status: 500 },
        );
      }

      updatedResults.push({ id: entry.id, status, updated_at: now });
    }

    // Fetch summary counts for the entire diff pair
    const { data: allEntries } = await supabase
      .from('source_document_diffs')
      .select('status')
      .or(`old_document_id.eq.${documentId},new_document_id.eq.${documentId}`);

    const summary = { pending_review: 0, applied: 0, dismissed: 0 };
    for (const entry of allEntries ?? []) {
      const s = entry.status as keyof typeof summary;
      if (s in summary) {
        summary[s]++;
      }
    }

    return NextResponse.json({ updated: updatedResults, summary });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to update diff entry status') },
      { status: 500 },
    );
  }
}
