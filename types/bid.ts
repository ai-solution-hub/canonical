import type { Database } from '@/supabase/types/database.types';

// Database row types
export type BidQuestionRow = Database['public']['Tables']['bid_questions']['Row'];
export type BidResponseRow = Database['public']['Tables']['bid_responses']['Row'];
export type ProjectRow = Database['public']['Tables']['projects']['Row'];

// ---- State Machine ----

export const BID_STATES = [
  'draft', 'questions_extracted', 'matching', 'drafting',
  'in_review', 'ready_for_export', 'submitted', 'won', 'lost', 'withdrawn',
] as const;

export type BidState = typeof BID_STATES[number];

// ---- Bid Container ----

// NOTE: BidMetadata defines a strict TypeScript shape for domain_metadata JSONB,
// but the database does not enforce this shape -- domain_metadata accepts any valid JSON.
// All BidMetadata must be validated at the API layer (via Zod schemas)
// before writing to the database. Never trust domain_metadata read from the DB to
// conform to BidMetadata without runtime validation.

export interface BidMetadata {
  buyer: string;
  status: BidState;
  deadline: string | null;
  reference_number: string | null;
  estimated_value: string | null;
  tender_source: 'upload' | 'manual' | null;
  tender_document_ids: string[];
  submission_date: string | null;
  outcome: 'won' | 'lost' | 'withdrawn' | null;
  outcome_notes: string | null;
  notes: string | null;
}

export interface Bid {
  id: string;
  name: string;
  description: string | null;
  domain_metadata: BidMetadata;
  question_stats?: BidQuestionStats;
  tender_documents?: TenderDocument[];
  created_by: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface BidQuestionStats {
  total_questions: number;
  strong_match_count: number;
  partial_match_count: number;
  needs_sme_count: number;
  no_content_count: number;
  unmatched_count: number;
  drafted_count: number;
  complete_count: number;
}

export interface TenderDocument {
  path: string;
  filename: string;
  size: number;
  mime_type: string;
  uploaded_at: string;
}

// ---- Bid Questions ----

export type ConfidencePosture = 'strong_match' | 'partial_match' | 'needs_sme' | 'no_content';
export type QuestionStatus = 'not_started' | 'ai_drafted' | 'in_progress' | 'needs_review' | 'complete';
export type ResponseReviewStatus = 'draft' | 'ai_drafted' | 'edited' | 'approved' | 'needs_review';

export interface BidQuestion {
  id: string;
  project_id: string;
  section_name: string | null;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  evaluation_weight: number | null;
  confidence_posture: ConfidencePosture | null;
  matched_content_ids: string[] | null;
  status: QuestionStatus;
  has_variants: boolean;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  response?: BidResponseSummary;
}

export interface BidResponseSummary {
  id: string;
  review_status: ResponseReviewStatus;
  word_count: number;
}

// ---- Confidence Posture Display ----

export const CONFIDENCE_POSTURE_CONFIG: Record<ConfidencePosture, {
  label: string;
  colour: string;
  icon: string;
  description: string;
}> = {
  strong_match: {
    label: 'Strong Match',
    colour: 'green',
    icon: 'check-circle',
    description: 'Multiple relevant KB entries found',
  },
  partial_match: {
    label: 'Partial Match',
    colour: 'amber',
    icon: 'alert-circle',
    description: 'Some relevant content found -- gaps identified',
  },
  needs_sme: {
    label: 'Needs SME',
    colour: 'blue',
    icon: 'user',
    description: 'No KB content. Route to subject matter expert.',
  },
  no_content: {
    label: 'No Content',
    colour: 'slate',
    icon: 'file-question',
    description: 'No relevant content in KB yet',
  },
};

// ---- Extraction Results ----

export interface ExtractedSection {
  section_name: string;
  section_sequence: number;
  questions: ExtractedQuestion[];
}

export interface ExtractedQuestion {
  question_text: string;
  question_sequence: number;
  word_limit: number | null;
  evaluation_weight: number | null;
  category: 'mandatory' | 'desirable' | 'informational';
}

export interface ExtractionResult {
  sections: ExtractedSection[];
  total_questions: number;
  total_sections: number;
  format: 'docx' | 'pdf';
  extraction_method: 'programmatic' | 'ai';
}
