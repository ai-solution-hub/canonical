/**
 * Shared utilities, types, and lazy import wrappers for MCP tool registrations.
 *
 * All heavy modules are loaded on-demand to prevent Vercel serverless cold
 * start crashes. Module-level imports of OpenAI SDK, dashboard queries, and
 * Anthropic SDK cause the function to crash at the V8/Node level before any
 * application code runs.
 */
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ServerRequest, ServerNotification } from '@modelcontextprotocol/sdk/types.js';
import type { BidQuestionSummary, BidSection } from '@/lib/mcp/formatters';
import { createMcpClient } from '@/lib/mcp/auth';

// ---------------------------------------------------------------------------
// Type alias for the extra parameter in tool callbacks
// ---------------------------------------------------------------------------

export type ToolExtra = RequestHandlerExtra<ServerRequest, ServerNotification>;

// ---------------------------------------------------------------------------
// Helper — safely convert typed objects to structuredContent
// ---------------------------------------------------------------------------

/**
 * The MCP SDK requires structuredContent to have a `[x: string]: unknown`
 * index signature. This helper performs a safe cast via JSON round-trip.
 */
export function toStructuredContent(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Lazy imports — all heavy modules are loaded on-demand to prevent Vercel
// serverless cold start crashes.
// ---------------------------------------------------------------------------

export async function getGenerateEmbedding() {
  const { generateEmbedding } = await import('@/lib/ai/embed');
  return generateEmbedding;
}
export async function getClassifyContent() {
  const { classifyContent } = await import('@/lib/ai/classify');
  return classifyContent;
}
export async function getGenerateSummary() {
  const { generateSummary } = await import('@/lib/ai/summarise');
  return generateSummary;
}
export async function getDashboardModule() {
  return await import('@/lib/dashboard');
}
export async function getBidQueriesModule() {
  return await import('@/lib/bid-queries');
}
export async function getReorientModule() {
  return await import('@/lib/reorient');
}
export async function getAIErrors() {
  const { AIServiceError } = await import('@/lib/ai/errors');
  return AIServiceError;
}
export async function getExtAppsServer() {
  return await import('@modelcontextprotocol/ext-apps/server');
}

// ---------------------------------------------------------------------------
// Shared helper: fetch questions and responses for a bid, returning
// sections grouped by section_name plus status/confidence breakdowns.
// Used by both get_bid_detail and show_bid_dashboard.
// ---------------------------------------------------------------------------

export async function fetchBidSections(
  supabase: ReturnType<typeof createMcpClient>,
  bidId: string,
): Promise<{
  sections: BidSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}> {
  // Fetch individual questions with ordering
  const { data: questions } = await supabase
    .from('bid_questions')
    .select('id, question_text, section_name, section_sequence, question_sequence, status, confidence_posture, word_limit')
    .eq('project_id', bidId)
    .order('section_sequence')
    .order('question_sequence');

  // Fetch responses for all questions in this bid (avoids N+1)
  const questionIds = (questions ?? []).map((q: { id: string }) => q.id);
  const { data: responses } = questionIds.length > 0
    ? await supabase
        .from('bid_responses')
        .select('question_id, response_text, review_status')
        .in('question_id', questionIds)
    : { data: [] as Array<{ question_id: string; response_text: string | null; review_status: string | null }> };

  // Build a response lookup map
  const responseMap = new Map<string, { response_text: string | null; review_status: string | null }>();
  for (const r of (responses ?? [])) {
    responseMap.set(r.question_id, r);
  }

  // Group questions into sections
  const sectionMap = new Map<string, BidQuestionSummary[]>();
  for (const q of (questions ?? [])) {
    const sectionName = q.section_name ?? 'Ungrouped';
    if (!sectionMap.has(sectionName)) {
      sectionMap.set(sectionName, []);
    }
    const resp = responseMap.get(q.id);
    sectionMap.get(sectionName)!.push({
      id: q.id,
      question_text: q.question_text,
      status: q.status ?? 'not_started',
      confidence_posture: q.confidence_posture ?? null,
      word_limit: q.word_limit ?? null,
      has_response: !!resp?.response_text,
      review_status: resp?.review_status ?? null,
    });
  }

  const sections: BidSection[] = [];
  for (const [name, qs] of sectionMap) {
    sections.push({ name, questions: qs });
  }

  // Compute breakdowns
  const status_breakdown: Record<string, number> = {};
  const confidence_breakdown: Record<string, number> = {};
  for (const q of (questions ?? [])) {
    const s = q.status ?? 'not_started';
    status_breakdown[s] = (status_breakdown[s] ?? 0) + 1;
    const c = q.confidence_posture ?? 'unmatched';
    confidence_breakdown[c] = (confidence_breakdown[c] ?? 0) + 1;
  }

  return { sections, status_breakdown, confidence_breakdown };
}
