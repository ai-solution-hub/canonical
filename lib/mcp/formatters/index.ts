/**
 * Barrel re-export for MCP formatters.
 *
 * All domain formatter files are re-exported here so that existing imports
 * from '@/lib/mcp/formatters' continue to work without any path changes.
 */

export { CHARACTER_LIMIT, truncate, truncateResponse, formatDeadline, formatProgress } from './shared';
export { type SearchResult, formatSearchResults, formatQASearchResults, type SimilarItem, type SimilarItemsResult, formatSimilarItems } from './search';
export { type ContentItemDetail, formatContentItem, type CreatedItem, formatCreatedItem, type UpdatedItemResult, formatUpdatedItem, type BatchContentItemsResult, formatBatchContentItems } from './content';
export { formatDashboardSummary, formatActiveBids, type FreshnessReport, formatFreshnessReport, formatReorientation } from './dashboard';
export { type BidQuestionSummary, type BidSection, type BidDetail, formatBidDetail, type BidQuestionDetail, formatBidQuestion, type CitationResult, formatCitation, type ContentEffectiveness, formatContentEffectiveness } from './bids';
export { type QualitySummary, formatQualitySummary, type CoverageGapResult, formatCoverageGaps, type AuditItem, type AuditResult, formatAuditResult, type DuplicatePair, type DuplicatePairsResult, formatDuplicatePairs } from './quality';
export { type EntitySummaryResult, type EntityRelationship, type EntityOverview, formatEntitySummary, formatEntityOverview, type CertificationReportEntry, type CertificationReportData, formatCertificationReport } from './entities';
export { type DeleteContentResult, formatDeleteContent, type GovernanceStatusItemResult, type GovernanceStatusUpdateResult, formatGovernanceStatusUpdate } from './governance';
export { type TemplateCoverageRequirement, type TemplateCoverageSection, type TemplateCoverageData, formatTemplateCoverage, type TemplateListItem, type TemplateListData, formatTemplateList, type TemplateGapsData, formatTemplateGaps } from './templates';
export { formatClassification, formatSummaryResult } from './ai';
export { type CoverageMatrixData, formatCoverageMatrix, type BidDashboardData, formatBidDashboard } from './apps';
export { type DocumentDiffData, formatDocumentDiff } from './documents';
export { type BelowThresholdItem, type ScoreDropItem, type FreshnessTransitionItem, type QualityFlagNotification, type CoverageAlertNotification, type CertificationWarning, type QualityBriefingData, formatQualityBriefing } from './briefing';
