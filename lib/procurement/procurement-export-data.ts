/**
 * Shared data-fetching logic for bid export API routes.
 *
 * Extracts bid metadata and questions with responses from Supabase,
 * transforming them into the ExportBidMetadata / ExportQuestion types
 * consumed by the DOCX and XLSX generation libraries.
 *
 * @module bid-export-data
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { safeErrorMessage } from '@/lib/error';
import type {
  ExportQuestion,
  ExportBidMetadata,
  ExportCitation,
} from '@/lib/procurement/procurement-export-types';
import type { ProcurementResponseMetadata } from '@/types/procurement-metadata';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** @public */
export interface ProcurementExportData {
  metadata: ExportBidMetadata;
  questions: ExportQuestion[];
  procurementName: string;
}

/**
 * Fetch and transform bid data for export.
 *
 * Returns either the structured export data or a NextResponse error.
 * Callers should check: if result is a NextResponse, return it directly.
 */
export async function fetchProcurementExportData(
  supabase: SupabaseClient<Database>,
  procurementId: string,
): Promise<ProcurementExportData | NextResponse> {
  // Validate UUID
  if (!UUID_RE.test(procurementId)) {
    return NextResponse.json(
      { error: 'Invalid bid ID — must be a valid UUID' },
      { status: 400 },
    );
  }

  // Fetch bid workspace (post-T2: discriminator is application_types.key via
  // JOIN, not the dropped workspaces.type col). 'bid' maps to 'procurement'.
  const { data: bid, error: procurementError } = await supabase
    .from('workspaces')
    .select('id, name, status, domain_metadata, application_types!inner(key)')
    .eq('id', procurementId)
    .eq('application_types.key', 'procurement')
    .single();

  if (procurementError || !bid) {
    return NextResponse.json({ error: 'Procurement not found' }, { status: 404 });
  }

  // Fetch questions with responses
  const { data: questions, error: questionsError } = await supabase
    .from('bid_questions')
    .select(
      `
      id,
      section_name,
      section_sequence,
      question_sequence,
      question_text,
      word_limit,
      evaluation_weight,
      confidence_posture,
      status,
      bid_responses (
        id,
        response_text,
        response_text_advanced,
        review_status,
        metadata,
        source_content_ids
      )
    `,
    )
    .eq('workspace_id', procurementId)
    .order('section_sequence', { ascending: true })
    .order('question_sequence', { ascending: true });

  if (questionsError) {
    return NextResponse.json(
      {
        error: safeErrorMessage(questionsError, 'Failed to fetch questions'),
      },
      { status: 500 },
    );
  }

  if (!questions || questions.length === 0) {
    return NextResponse.json(
      { error: 'No questions found for this bid' },
      { status: 404 },
    );
  }

  // Transform to export types
  const procurementMetadata = (bid.domain_metadata ?? {}) as Record<string, unknown>;
  const exportMetadata: ExportBidMetadata = {
    bid_name: bid.name,
    buyer: (procurementMetadata.buyer as string) || 'Unknown Buyer',
    reference_number: (procurementMetadata.reference_number as string) || null,
    deadline: (procurementMetadata.deadline as string) || null,
    status: (bid.status as string) || 'draft',
    estimated_value: (procurementMetadata.estimated_value as string) || null,
    notes: (procurementMetadata.notes as string) || null,
  };

  const exportQuestions: ExportQuestion[] = questions.map((q) => {
    const response = Array.isArray(q.bid_responses)
      ? q.bid_responses[0]
      : q.bid_responses;

    const metadata = response?.metadata as ProcurementResponseMetadata | null;
    const citations: ExportCitation[] = [];

    if (metadata?.citations_data?.citations) {
      const seen = new Set<string>();
      for (const c of metadata.citations_data.citations) {
        if (!seen.has(c.source_id)) {
          seen.add(c.source_id);
          citations.push({
            source_index: citations.length + 1,
            source_title: c.source_title,
            source_id: c.source_id,
          });
        }
      }
    }

    return {
      question_id: q.id,
      section_name: q.section_name || 'General Questions',
      section_sequence: q.section_sequence,
      question_sequence: q.question_sequence,
      question_text: q.question_text,
      word_limit: q.word_limit,
      evaluation_weight: q.evaluation_weight,
      confidence_posture: q.confidence_posture,
      status: q.status,
      response_text: response?.response_text || null,
      response_text_advanced: response?.response_text_advanced || null,
      review_status: response?.review_status || null,
      citations,
    };
  });

  return {
    metadata: exportMetadata,
    questions: exportQuestions,
    procurementName: bid.name,
  };
}

/** Sanitise a bid name for use as a download filename */
export function sanitiseFilename(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase()
    .slice(0, 50);
}
