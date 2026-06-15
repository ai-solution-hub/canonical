/**
 * Barrel re-export for MCP formatters.
 *
 * All domain formatter files are re-exported here so that existing imports
 * from '@/lib/mcp/formatters' continue to work without any path changes.
 */

export { CHARACTER_LIMIT, truncateResponse } from './shared';
export {
  type SearchResult,
  formatSearchResults,
  formatQASearchResults,
  type SimilarItem,
  type SimilarItemsResult,
  formatSimilarItems,
  type ChunkSearchResult,
  formatChunkSearchResults,
} from './search';
export {
  type ContentItemDetail,
  formatContentItem,
  type CreatedItem,
  formatCreatedItem,
  type UpdatedItemResult,
  formatUpdatedItem,
  type BatchContentItemsResult,
  formatBatchContentItems,
  type ContentItemChunk,
  formatContentItemChunks,
} from './content';
export {
  formatActiveBids,
  type FreshnessReport,
  formatReorientation,
  type ExposureResolution,
  type ExposureLayer,
  type WhereAreWeExposedData,
  formatWhereAreWeExposed,
} from './dashboard';
export {
  type ProcurementQuestionSummary,
  type ProcurementSection,
  type ProcurementDetail,
  formatProcurementDetail,
  type ProcurementQuestionDetail,
  formatProcurementQuestion,
  type CitationResult,
  formatCitation,
  type ContentEffectiveness,
  formatContentEffectiveness,
} from './procurements';
export {
  type CoverageGapResult,
  formatCoverageGaps,
  type AuditItem,
  type AuditResult,
  formatAuditResult,
  type DuplicatePairsResult,
  DuplicatePairsResponseSchema,
  formatDuplicatePairs,
} from './quality';
export {
  type EntitySummaryResult,
  type EntityRelationship,
  type EntityOverview,
  formatEntitySummary,
  formatEntityOverview,
} from './entities';
export {
  type DeleteContentResult,
  formatDeleteContent,
  type GovernanceStatusItemResult,
  type GovernanceStatusUpdateResult,
  formatGovernanceStatusUpdate,
  type GovernanceReviewAction,
  type GovernanceReviewActionResult,
  formatGovernanceReviewAction,
  type PublicationStatusUpdateResult,
  formatPublicationStatusUpdate,
} from './governance';
export {
  type CreateReviewAssignmentResult,
  formatCreateReviewAssignment,
  type QueueFacet,
  type QueueItem,
  type WhatsInMyQueueData,
  formatWhatsInMyQueue,
} from './review';
export {
  type TemplateCoverageData,
  formatTemplateCoverage,
  type TemplateListData,
  formatTemplateList,
  type TemplateGapsData,
  formatTemplateGaps,
} from './templates';
export { formatClassification, formatSummaryResult } from './ai';
export {
  type CoverageMatrixData,
  formatCoverageMatrix,
  type ProcurementDashboardData,
  formatProcurementDashboard,
} from './apps';
export { type DocumentDiffData, formatDocumentDiff } from './documents';
export { formatIntelligenceSummary } from './intelligence';
export {
  type ChangeReportItem,
  type ChangeReportData,
  formatChangeReport,
} from './change-report';
