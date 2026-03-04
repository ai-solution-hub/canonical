/**
 * CopilotKit-related type definitions for the bid workspace.
 *
 * These types define the data structures used by CopilotKit actions,
 * context hooks, and the chat sidebar.
 */

// ────────────────────────────────────────────
// Context types (useCopilotReadable)
// ────────────────────────────────────────────

/** Bid summary exposed to the AI via useCopilotReadable */
export interface CopilotBidContext {
  name: string;
  buyer: string | null;
  deadline: string | null;
  status: string;
  progress: string;
}

/** Question summary exposed to the AI via useCopilotReadable */
export interface CopilotQuestionContext {
  id: string;
  number: number;
  text: string;
  section: string | null;
  wordLimit: number | null;
  confidence: string;
  responseStatus: string;
}

/** Active response summary exposed to the AI via useCopilotReadable */
export interface CopilotResponseContext {
  wordCount: number;
  reviewStatus: string;
  qualityScore: number | null;
  sourceCount: number;
}

/** User role context exposed to the AI via useCopilotReadable */
export interface CopilotUserRoleContext {
  role: string;
  canEdit: boolean;
  canAdmin: boolean;
}

/** UI state context exposed to the AI via useCopilotReadable */
export interface CopilotUIStateContext {
  page: string;
  activeQuestionId: string | null;
  hasEditorContent: boolean;
}

// ────────────────────────────────────────────
// Action types (useCopilotAction)
// ────────────────────────────────────────────

/** Search result item returned by KB search action */
export interface CopilotSearchResultItem {
  id: string;
  title: string;
  contentType: string;
  domain: string;
  subtopic: string;
  similarity: number;
  snippet: string;
}

/** Parameters for the KB search action */
export interface CopilotSearchParams {
  query: string;
  limit?: number;
  domain?: string;
}

/** Parameters for the draft response action */
export interface CopilotDraftParams {
  questionId: string;
  additionalInstructions?: string;
}

/** Parameters for the improve response action */
export interface CopilotImproveParams {
  instruction: string;
  currentText: string;
  wordLimit?: number;
}

/** Result from an AI draft or improvement action */
export interface CopilotDraftResult {
  responseText: string;
  wordCount: number;
  sourcesUsed: number;
}
