/**
 * JSONB structure for bid_responses.metadata column.
 * Stores citation data, quality check results, and AI generation context.
 */

/** Single citation from the Search Results Citations API */
export interface CitationEntry {
  cited_text: string;
  source_index: number;
  source_id: string;
  source_title: string;
  source_url: string;
  start_block_index: number;
  end_block_index: number;
}

/** Citation data from the drafting pipeline */
export interface CitationsData {
  citations: CitationEntry[];
  source_content_ids: string[];
}

/** Quality issue from deterministic or AI checks */
export interface QualityIssueEntry {
  type: 'word_limit' | 'unsupported_claim' | 'weak_language' | 'missing_section';
  severity: 'error' | 'warning' | 'info';
  message: string;
  location?: string;
}

/** Quality check results from Pass 3 */
export interface QualityData {
  overall_score: number;
  word_count: number;
  word_limit_compliance: boolean;
  citation_count: number;
  unsupported_claims: string[];
  suggestions: string[];
  issues: QualityIssueEntry[];
}

/** AI generation context for cost tracking and debugging */
export interface AIMetadata {
  model: string;
  tokens_input: number;
  tokens_output: number;
  cost_estimate: number;
  generated_at: string; // ISO 8601 timestamp
  analysis_model?: string;
  quality_model?: string;
  regeneration_instructions?: string;
}

/** Top-level metadata structure stored in bid_responses.metadata JSONB */
export interface BidResponseMetadata {
  citations_data?: CitationsData;
  quality_data?: QualityData;
  ai_metadata?: AIMetadata;
}
