/**
 * Barrel re-export for MCP formatters.
 *
 * All domain formatter files are re-exported here so that existing imports
 * from '@/lib/mcp/formatters' continue to work without any path changes.
 */

export { truncateResponse } from './shared';
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
export { formatSummaryResult } from './ai';
export { formatIntelligenceSummary } from './intelligence';
