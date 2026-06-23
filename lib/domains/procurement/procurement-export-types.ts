/**
 * Shared type definitions for bid export generation.
 *
 * These types are the "export data contract" — the API routes transform
 * database rows into these types, and the generation libraries consume them.
 * This separation keeps generation logic testable without database dependencies.
 *
 * @module bid-export-types
 */

/** Input data for a single question/response pair */
export interface ExportQuestion {
  question_id: string;
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number | null;
  evaluation_weight: number | null;
  confidence_posture: string | null;
  status: string;
  response_text: string | null;
  response_text_advanced: string | null;
  review_status: string | null;
  citations: ExportCitation[];
}

/** Citation reference for export */
export interface ExportCitation {
  source_index: number;
  source_title: string;
  source_id: string;
}

/** Procurement metadata for the cover page */
export interface ExportProcurementMetadata {
  procurement_name: string;
  buyer: string;
  reference_number: string | null;
  deadline: string | null;
  status: string;
  estimated_value: string | null;
  notes: string | null;
}

/** Options for DOCX export generation */
export interface DocxExportOptions {
  /** Include cover page (default: true) */
  includeCover?: boolean;
  /** Include table of contents (default: true) */
  includeToc?: boolean;
  /** Include citation references (default: true) */
  includeCitations?: boolean;
  /** Include questions with no response (default: true) */
  includeUnanswered?: boolean;
  /** Use advanced response variant when available (default: false) */
  useAdvancedVariant?: boolean;
  /** Company name for cover page (default: "Knowledge Hub") */
  companyName?: string;
}

/** Options for XLSX export generation */
export interface XlsxExportOptions {
  /** Include summary sheet (default: true) */
  includeSummary?: boolean;
  /** Include questions with no response (default: true) */
  includeUnanswered?: boolean;
  /** Use advanced response variant when available (default: false) */
  useAdvancedVariant?: boolean;
}
