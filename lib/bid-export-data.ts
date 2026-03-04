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
} from '@/lib/bid-export-types';
import type { BidResponseMetadata } from '@/types/bid-metadata';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BidExportData {
  metadata: ExportBidMetadata;
  questions: ExportQuestion[];
  bidName: string;
}

/**
 * Fetch and transform bid data for export.
 *
 * Returns either the structured export data or a NextResponse error.
 * Callers should check: if result is a NextResponse, return it directly.
 */
export async function fetchBidExportData(
  supabase: SupabaseClient<Database>,
  bidId: string,
): Promise<BidExportData | NextResponse> {
  // Validate UUID
  if (!UUID_RE.test(bidId)) {
    return NextResponse.json(
      { error: 'Invalid bid ID — must be a valid UUID' },
      { status: 400 },
    );
  }

  // Fetch bid project
  const { data: bid, error: bidError } = await supabase
    .from('projects')
    .select('id, name, type, domain_metadata')
    .eq('id', bidId)
    .eq('type', 'bid')
    .single();

  if (bidError || !bid) {
    return NextResponse.json({ error: 'Bid not found' }, { status: 404 });
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
    .eq('project_id', bidId)
    .order('section_sequence', { ascending: true })
    .order('question_sequence', { ascending: true });

  if (questionsError) {
    return NextResponse.json(
      {
        error: safeErrorMessage(
          questionsError,
          'Failed to fetch questions',
        ),
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
  const bidMetadata = (bid.domain_metadata ?? {}) as Record<string, unknown>;
  const exportMetadata: ExportBidMetadata = {
    bid_name: bid.name,
    buyer: (bidMetadata.buyer as string) || 'Unknown Buyer',
    reference_number: (bidMetadata.reference_number as string) || null,
    deadline: (bidMetadata.deadline as string) || null,
    status: (bidMetadata.status as string) || 'draft',
    estimated_value: (bidMetadata.estimated_value as string) || null,
    notes: (bidMetadata.notes as string) || null,
  };

  const exportQuestions: ExportQuestion[] = questions.map((q) => {
    const response = Array.isArray(q.bid_responses)
      ? q.bid_responses[0]
      : q.bid_responses;

    const metadata = response?.metadata as BidResponseMetadata | null;
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
    bidName: bid.name,
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
