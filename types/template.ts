import type {
  TemplateStatus,
  FieldType,
  MappingStatus,
  FillStatus,
} from '@/lib/validation/template-schemas';

// ID-145 {145.42} orphan sweep: nothing imports `Template` directly
// (knip-confirmed) — only `TemplateWithDetail` below extends it. Kept
// module-private rather than deleted since it still backs that live type.
interface Template {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  filename: string;
  storage_path: string;
  file_size: number;
  mime_type: string;
  status: TemplateStatus;
  field_count: number | null;
  mapped_count: number;
  structure_path: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface TemplateField {
  id: string;
  template_id: string;
  field_type: FieldType;
  table_index: number | null;
  row_index: number | null;
  col_index: number | null;
  question_text: string | null;
  section_name: string | null;
  word_limit: number | null;
  placeholder_text: string | null;
  question_id: string | null;
  mapping_status: MappingStatus;
  mapping_confidence: number | null;
  fill_status: FillStatus;
  fill_error: string | null;
  sequence: number;
  created_at: string;
  updated_at: string;
  /** Joined data from API -- present when the field has a mapped bid question */
  matched_question?: {
    id: string;
    question_text: string;
    status: string;
    response_preview: string | null;
  };
}

export interface TemplateCompletion {
  id: string;
  template_id: string;
  job_id: string | null;
  storage_path: string;
  fields_filled: number;
  fields_skipped: number;
  fields_failed: number;
  file_size: number | null;
  created_by: string | null;
  created_at: string;
}

export interface TemplateSummary {
  total_fields: number;
  confirmed_fields: number;
  rejected_fields: number;
  unmapped_fields: number;
  unreviewed_fields: number;
  filled_fields: number;
  pending_fields: number;
  skipped_fields: number;
  failed_fields: number;
}

export interface TemplateWithDetail extends Template {
  fields: TemplateField[];
  summary: TemplateSummary;
  completions: TemplateCompletion[];
}

export interface FillResult {
  fields_filled: number;
  fields_skipped: number;
  fields_failed: number;
  truncated: Array<{
    table_index: number;
    row_index: number;
    original_words: number;
    limit: number;
  }>;
  errors: Array<{
    table_index: number;
    row_index: number;
    error: string;
  }>;
  completion_id: string | null;
  storage_path: string;
}

export interface JobStatus {
  id: string;
  job_type: string;
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error_message: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}
