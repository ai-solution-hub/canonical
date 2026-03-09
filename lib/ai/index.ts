/**
 * AI Service Layer — unified entry point.
 *
 * All AI integration points should import from '@/lib/ai' or from
 * specific sub-modules (e.g. '@/lib/ai/classify').
 */

// Errors
export { AIServiceError } from './errors';

// Classification
export { classifyContent } from './classify';
export type { ClassifyParams, ClassificationResult } from './classify';

// Summarisation
export { generateSummary } from './summarise';
export type { SummariseParams, SummariseResult } from './summarise';

// Digest generation
export { generateDigest } from './digest';
export type { DigestParams, DigestResult } from './digest';

// Structured content extraction
export { extractStructuredContent } from './extract-content';
export type { ExtractContentParams, ExtractContentResult } from './extract-content';

// Vision / PDF analysis
export { analyseVision } from './vision';
export type { VisionParams, VisionResult } from './vision';

// Embeddings
export { generateEmbedding, EMBEDDING_MODEL, EMBEDDING_DIMENSIONS } from './embed';

// KB matching
export {
  assessConfidence,
  deduplicateResults,
  generateQueryEmbedding,
  MATCH_THRESHOLDS,
} from './match';
export type { MatchResult } from './match';

// Bid drafting pipeline
export {
  analyseQuestion,
  draftResponse,
  draftResponseStreaming,
  runDraftingPipeline,
} from './draft';
export type {
  DraftableQuestion,
  DraftableContent,
  DraftResult,
  QuestionAnalysis,
  ResponseStructure,
} from './draft';

// Quality checks
export {
  runDeterministicChecks,
  runAIQualityCheck,
  checkResponseQuality,
  qualityCheckSchema,
} from './quality-check';
export type { QualityCheckQuestion } from './quality-check';

// Question / tender extraction
export {
  extractPDFQuestions,
  extractDOCXQuestions,
  extractTenderMetadata,
  generateSearchQueries,
  TENDER_QUESTIONS_SCHEMA,
  SEARCH_QUERIES_SCHEMA,
  TENDER_METADATA_TOOL,
} from './extract-questions';
export type {
  ExtractedPDFQuestions,
  GeneratedSearchQueries,
} from './extract-questions';

// Skills
export { loadSkill } from './skills/loader';
