// ---- State Machine ----

export const PROCUREMENT_WORKFLOW_STATES = [
  'draft',
  'questions_extracted',
  'matching',
  'drafting',
  'in_review',
  'ready_for_export',
  'submitted',
  'won',
  'lost',
  'withdrawn',
] as const;

export type ProcurementWorkflowState =
  (typeof PROCUREMENT_WORKFLOW_STATES)[number];

// ---- Procurement Container ----

// NOTE: ProcurementMetadata defines the TypeScript shape for domain_metadata JSONB.
// The `status` field is enforced at the database level via a dedicated `status`
// column on `workspaces` with a CHECK constraint (synced to JSONB via trigger).
// Other fields are validated at the API layer via `parseProcurementMetadata()` in
// `lib/validation/schemas.ts`. Always validate domain_metadata at read boundaries.

export interface ProcurementMetadata {
  buyer: string;
  status: ProcurementWorkflowState;
  deadline: string | null;
  reference_number: string | null;
  estimated_value: string | null;
  tender_source: 'upload' | 'manual' | null;
  tender_document_ids: string[];
  submission_date: string | null;
  outcome: 'won' | 'lost' | 'withdrawn' | null;
  outcome_notes: string | null;
  notes: string | null;
  outcome_recorded_at?: string;
  outcome_recorded_by?: string;
}

export interface Procurement {
  id: string;
  name: string;
  description: string | null;
  status?: ProcurementWorkflowState;
  domain_metadata: ProcurementMetadata;
  question_stats?: ProcurementQuestionStats;
  tender_documents?: TenderDocument[];
  created_by: string | null;
  created_by_name?: string;
  created_at: string;
  updated_at: string;
}

export interface ProcurementQuestionStats {
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

// ---- Procurement Questions ----

export type ConfidencePosture =
  | 'strong_match'
  | 'partial_match'
  | 'needs_sme'
  | 'no_content';
export type QuestionStatus =
  | 'not_started'
  | 'ai_drafted'
  | 'in_progress'
  | 'needs_review'
  | 'complete';
type ResponseReviewStatus =
  | 'draft'
  | 'ai_drafted'
  | 'edited'
  | 'approved'
  | 'needs_review';

export interface ProcurementQuestion {
  id: string;
  workspace_id: string;
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
  response?: ProcurementResponseSummary;
}

interface ProcurementResponseSummary {
  id: string;
  review_status: ResponseReviewStatus;
  word_count: number;
}

// ---- Confidence Posture Display ----

export const CONFIDENCE_POSTURE_CONFIG: Record<
  ConfidencePosture,
  {
    label: string;
    colour: string;
    icon: string;
    description: string;
  }
> = {
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

interface ExtractedQuestion {
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

// ---- KB Integration Candidates ----

export interface KBCandidate {
  question_id: string;
  question_text: string;
  response_text: string | null;
  source_content_ids: string[] | null;
  recommendation: 'new_entry' | 'update_existing' | 'skip';
}

// ---- Response Versioning ----

export interface ProcurementResponseVersion {
  id: string;
  version: number;
  response_text: string | null;
  response_text_advanced: string | null;
  review_status: ResponseReviewStatus;
  edited_by: string | null;
  edited_by_name?: string;
  change_reason: string | null;
  created_at: string;
}
