/**
 * Shared types for the AI evaluation framework.
 *
 * These types are used across all eval suites (classification, search,
 * summarisation, bid drafting) for gold standards, scoring, baselines,
 * and regression detection.
 */

/** Base shape for any gold standard item */
export interface GoldStandardBase {
  content_item_id: string;
  title: string;
  domain: string;
  content_type: string;
}

/**
 * Per-item score from any eval suite
 * @public
 */
export interface ItemScoreBase {
  content_item_id: string;
  title: string;
  passed: boolean;
}

/** Aggregate result from any eval suite */
export interface EvalResult {
  suite_name: string;
  timestamp: string;
  total_items: number;
  metrics: Record<string, number>;
  passed: boolean;
  failures: string[];
}

/** Stored baseline for regression comparison */
export interface EvalBaseline {
  suite_name: string;
  created_at: string;
  metrics: Record<string, number>;
  thresholds: Record<string, { min?: number; max_drop?: number }>;
}

/** Regression check result */
export interface RegressionResult {
  metric_name: string;
  baseline_value: number;
  current_value: number;
  threshold: number;
  passed: boolean;
  delta: number;
}

/**
 * Search eval test case
 * @public
 */
export interface SearchTestCase {
  id: string;
  category: string;
  query: string;
  expectations: {
    min_results: number;
    max_results?: number;
    expected_domains: string[];
    expected_subtopics?: string[];
    expected_content_types?: string[];
    must_include_titles: string[];
    notes: string;
  };
}

/**
 * Classification gold standard item
 * @public
 */
export interface ClassificationGoldItem extends GoldStandardBase {
  expected_domain: string;
  expected_subtopic: string;
  expected_secondary_domain?: string;
  expected_confidence_min?: number;
}

/** Summarisation gold standard item */
export interface SummarisationGoldItem extends GoldStandardBase {
  reference_executive: string;
  reference_detailed: string;
  reference_takeaways: string[];
  source_text_snippet: string;
  notes: string;
}

/**
 * Procurement drafting gold standard item
 * @public
 */
export interface ProcurementDraftingGoldItem {
  question_id: string;
  question_text: string;
  word_limit: number;
  section_name: string;
  reference_response: string;
  human_scores: {
    completeness: number;
    evidence_strength: number;
    compliance_language: number;
    structure: number;
    overall: number;
  };
  expected_kb_items_used: string[];
  notes: string;
}
