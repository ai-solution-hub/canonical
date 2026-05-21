/**
 * AI digest generation.
 * Generates periodic content digests (daily, weekly, custom) using Claude.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import { ChangeReportResponseSchema } from '@/lib/validation/ai-schemas';
import type { ChangeReportResponse } from '@/lib/validation/ai-schemas';
import { toJson } from '@/lib/validation/jsonb';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import type {
  ChangeReportDomainSummary,
  ChangeReportFilters,
  ChangeReportGovernanceSummary,
  ChangeReport,
} from '@/types/change-reports';
import { AIServiceError } from '@/lib/ai/errors';
import { generateContentSuggestions } from '@/lib/content/content-suggestions';
import type { ContentSuggestion } from '@/lib/content/content-suggestions';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
import { logger } from '@/lib/logger';

// ──────────────────────────────────────────
// Constants
// ──────────────────────────────────────────

/**
 * Maximum number of content items allowed for automatic digest generation.
 *
 * Rationale: ~250 tokens/item x 150 = 37.5K input tokens. At Sonnet 4-6
 * pricing that is ~$0.11 per call — well under rate-limit concern. A 7-day
 * window on a steady-state KB rarely exceeds this; first-ingestion days
 * (e.g. 500+ items with recent captured_date) easily do.
 *
 * Exported so the client can display the threshold in the "too many items"
 * empty state and so tests can reference it.
 */
export const CHANGE_REPORT_AUTO_GEN_MAX_ITEMS = 150;

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

interface ContentItemRow {
  id: string;
  title: string;
  suggested_title: string | null;
  summary: string | null;
  primary_domain: string | null;
  primary_subtopic: string | null;
  content_type: string;
  ai_keywords: string[] | null;
  captured_date: string | null;
  summary_data: {
    executive?: string;
    detailed?: string;
    takeaways?: string[];
  } | null;
}

/** @public */
export interface ChangeReportParams {
  supabase: SupabaseClient<Database>;
  periodDays: number;
  digestType: string;
  filterDomain?: string | null;
  filterKeywords?: string[] | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  userId: string;
}

/** @public */
export interface ChangeReportResult {
  digest: ChangeReport;
}

// ──────────────────────────────────────────
// Prompt builders
// ──────────────────────────────────────────

/**
 * Build the Claude prompt for a standard (weekly/custom period) digest.
 */
function buildStandardPrompt(
  periodLabel: string,
  itemCount: number,
  itemsByDomainText: string,
  crossDomainSection: string,
  filterContext: string,
  suggestionsSection: string,
): string {
  return `You are generating a content digest for a knowledge base.
Period: ${periodLabel}
Total items: ${itemCount}
${filterContext}
Items by domain:
${itemsByDomainText}
${crossDomainSection}${suggestionsSection}
Rules:
- narrative_summary: 2-3 paragraphs summarising the period's content themes and highlights. Write in second person ("you captured", "your focus was on").
- domain_summaries: one per domain that has items, with a concise 2-3 sentence summary
- key_themes: 2-5 themes per domain
- top_items: the 3 most interesting/important items per domain with a brief explanation of why each stands out this period. Use the exact UUIDs from the item list above. If a domain has fewer than 3 items, include all of them.
- content_opportunities: if content suggestions are provided above, include 1-3 actionable suggestions for content to create. Each should have a domain, subtopic, a short suggestion sentence, and priority level. If no suggestions are provided, return an empty array.
- Use UK English throughout`;
}

/**
 * Build a lighter Claude prompt for daily digests.
 * Fewer items highlighted, shorter summaries, focus on "what's new today".
 */
function buildDailyPrompt(
  periodLabel: string,
  itemCount: number,
  itemsByDomainText: string,
  filterContext: string,
  suggestionsSection: string,
): string {
  return `You are generating a brief daily digest for a knowledge base.
Date: ${periodLabel}
Total new items: ${itemCount}
${filterContext}
Items by domain:
${itemsByDomainText}
${suggestionsSection}
Rules:
- narrative_summary: 1 short paragraph (2-4 sentences) summarising what was captured today. Write in second person ("you added", "today's captures focus on"). Keep it punchy.
- domain_summaries: one per domain that has items, with a single concise sentence
- key_themes: 1-3 themes per domain (keep it brief)
- top_items: highlight the 1-2 most interesting items per domain. Use the exact UUIDs from the item list above. If a domain has only 1 item, include it.
- content_opportunities: if content suggestions are provided above, include 1-2 actionable suggestions. If none provided, return an empty array.
- Use UK English throughout
- Be concise — this is a daily snapshot, not a deep analysis`;
}

// ──────────────────────────────────────────
// Content suggestions section builder
// ──────────────────────────────────────────

/**
 * Build a text section describing content suggestions for inclusion in the
 * digest prompt. Returns an empty string if no suggestions are available.
 */
function buildSuggestionsSection(suggestions: ContentSuggestion[]): string {
  if (suggestions.length === 0) return '';

  let text =
    '\nContent Opportunities (gaps and suggestions for new content):\n';
  for (const s of suggestions) {
    text += `- [${s.priority}] ${s.domain} / ${s.subtopic}: ${s.title} — ${s.description}\n`;
  }
  return text;
}

// ──────────────────────────────────────────
// Main function
// ──────────────────────────────────────────

/**
 * Generate an AI digest for a period of KB content.
 * Fetches items, calls Claude, collects governance data, stores the digest.
 *
 * @throws AIServiceError for domain errors (400, 413, 500)
 */
export async function generateChangeReport(
  params: ChangeReportParams,
): Promise<ChangeReportResult> {
  const {
    supabase,
    periodDays,
    digestType,
    filterDomain,
    filterKeywords,
    dateFrom,
    dateTo,
    userId,
  } = params;

  // Calculate period — custom date range overrides period_days
  const now = new Date();
  let periodEnd: Date;
  let periodStart: Date;

  if (dateFrom && dateTo) {
    periodStart = startOfDay(new Date(dateFrom));
    periodEnd = endOfDay(new Date(dateTo));
  } else if (digestType === 'daily') {
    periodEnd = endOfDay(now);
    periodStart = startOfDay(now);
  } else {
    periodEnd = endOfDay(now);
    periodStart = startOfDay(subDays(now, periodDays));
  }

  const periodStartISO = periodStart.toISOString();
  const periodEndISO = periodEnd.toISOString();

  // Build the query with optional filters
  let query = supabase
    .from('content_items')
    .select(
      'id, title, suggested_title, summary, primary_domain, primary_subtopic, content_type, ai_keywords, captured_date, summary_data',
    )
    .gte('captured_date', periodStartISO)
    .lte('captured_date', periodEndISO)
    .order('captured_date', { ascending: false });

  // Apply domain filter
  if (filterDomain) {
    query = query.eq('primary_domain', filterDomain);
  }

  // Apply keyword filter (items must contain at least one of the keywords)
  if (filterKeywords && filterKeywords.length > 0) {
    query = query.overlaps('ai_keywords', filterKeywords);
  }

  const { data: items, error: fetchError } = await query;

  if (fetchError) {
    logger.error(
      { err: fetchError, op: 'digest.fetch-items' },
      'Failed to fetch content items',
    );
    throw new AIServiceError('Failed to fetch content items for digest', 500);
  }

  const typedItems = (items ?? []) as ContentItemRow[];

  if (typedItems.length === 0) {
    throw new AIServiceError(
      'No content items found for the selected filters and period',
      400,
    );
  }

  // Pre-flight cost guard (OPS-23): reject before calling Claude when
  // the item count reaches the threshold. The API route catches the 413
  // and returns a structured error the client renders as actionable UX.
  // `CHANGE_REPORT_AUTO_GEN_MAX_ITEMS` is the first rejected value (>= not >).
  if (typedItems.length >= CHANGE_REPORT_AUTO_GEN_MAX_ITEMS) {
    const message = `Your KB has ${typedItems.length} items in the selected period — that reaches the ${CHANGE_REPORT_AUTO_GEN_MAX_ITEMS}-item limit for automatic summaries. Use Custom filter to narrow the date range or apply a domain filter.`;
    throw new AIServiceError(message, 413, {
      code: 'DIGEST_TOO_MANY_ITEMS',
      data: {
        item_count: typedItems.length,
        max: CHANGE_REPORT_AUTO_GEN_MAX_ITEMS,
      },
    });
  }

  // Group items by domain
  const domainGroups = new Map<string, ContentItemRow[]>();
  for (const item of typedItems) {
    const domain = item.primary_domain || 'UNCATEGORISED';
    if (!domainGroups.has(domain)) {
      domainGroups.set(domain, []);
    }
    domainGroups.get(domain)!.push(item);
  }

  // Build the Claude prompt
  const periodLabel = `${format(periodStart, 'd MMM yyyy')} to ${format(periodEnd, 'd MMM yyyy')}`;

  // Build filter context string for the prompt
  const filterParts: string[] = [];
  if (filterDomain) filterParts.push(`Filtered to domain: ${filterDomain}`);
  if (filterKeywords && filterKeywords.length > 0) {
    filterParts.push(`Filtered to keywords: ${filterKeywords.join(', ')}`);
  }
  const filterContext =
    filterParts.length > 0 ? filterParts.join('\n') + '\n' : '';

  // Pre-compute cross-domain keyword frequency for theme clustering hints
  const keywordDomainMap = new Map<string, Set<string>>();
  for (const item of typedItems) {
    for (const kw of item.ai_keywords ?? []) {
      const normalised = kw.toLowerCase().trim();
      if (!normalised) continue;
      if (!keywordDomainMap.has(normalised))
        keywordDomainMap.set(normalised, new Set());
      keywordDomainMap
        .get(normalised)!
        .add(item.primary_domain || 'UNCATEGORISED');
    }
  }
  const crossDomainKeywords = [...keywordDomainMap.entries()]
    .filter(([, domains]) => domains.size > 1)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 15)
    .map(([kw, domains]) => `${kw} (appears in: ${[...domains].join(', ')})`);

  // For daily digests, limit detail per item to save tokens
  const isDaily = digestType === 'daily';
  const summaryMaxLen = isDaily ? 120 : 200;
  const maxKeywords = isDaily ? 3 : 5;
  const maxTakeaways = isDaily ? 0 : 3;

  let itemsByDomainText = '';
  for (const [domain, domainItems] of domainGroups) {
    itemsByDomainText += `\n## ${domain} (${domainItems.length} items)\n`;
    for (const item of domainItems) {
      const displayTitle = item.suggested_title || item.title || 'Untitled';
      // Prefer summary_data.executive (full-content summary) over summary (classification-time)
      const summary =
        item.summary_data?.executive ??
        (item.summary
          ? item.summary.slice(0, summaryMaxLen)
          : 'No summary available');
      const keywords = item.ai_keywords?.slice(0, maxKeywords).join(', ') ?? '';

      itemsByDomainText += `- [${item.id}] "${displayTitle}" (${item.content_type}) - ${summary}`;
      if (keywords) {
        itemsByDomainText += ` [keywords: ${keywords}]`;
      }
      itemsByDomainText += '\n';

      // Include takeaways if available (skip for daily to save tokens)
      if (maxTakeaways > 0) {
        const takeaways = item.summary_data?.takeaways?.slice(0, maxTakeaways);
        if (takeaways && takeaways.length > 0) {
          for (const takeaway of takeaways) {
            itemsByDomainText += `    - ${takeaway}\n`;
          }
        }
      }
    }
  }

  const crossDomainSection =
    crossDomainKeywords.length > 0
      ? `\nCross-domain keywords (these keywords appear across multiple domains — use them as hints for theme clustering):\n${crossDomainKeywords.map((k) => `- ${k}`).join('\n')}\n`
      : '';

  // Fetch content suggestions for the "Suggested Actions" digest section
  let contentSuggestions: ContentSuggestion[] = [];
  try {
    contentSuggestions = await generateContentSuggestions({
      supabase,
      maxSuggestions: 5,
      domainFilter: filterDomain ?? undefined,
    });
  } catch (suggestionsErr) {
    logger.warn(
      { err: suggestionsErr, op: 'digest.fetch-suggestions' },
      'Failed to fetch content suggestions for digest',
    );
  }

  const suggestionsSection = buildSuggestionsSection(contentSuggestions);

  // Choose prompt based on digest type
  const prompt = isDaily
    ? buildDailyPrompt(
        periodLabel,
        typedItems.length,
        itemsByDomainText,
        filterContext,
        suggestionsSection,
      )
    : buildStandardPrompt(
        periodLabel,
        typedItems.length,
        itemsByDomainText,
        crossDomainSection,
        filterContext,
        suggestionsSection,
      );

  // Call Claude API — daily digests use fewer tokens
  const client = getAnthropicClient();
  const model = getAIModel();

  const response = await client.messages.create({
    model,
    max_tokens: isDaily ? 2000 : 4000,
    tools: [
      {
        name: 'return_digest',
        description: 'Return the generated digest',
        input_schema: {
          type: 'object' as const,
          properties: {
            domain_summaries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  summary: { type: 'string' },
                  key_themes: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                  top_items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'string' },
                        why_notable: { type: 'string' },
                      },
                      required: ['id', 'why_notable'],
                    },
                  },
                },
                required: ['domain', 'summary', 'key_themes', 'top_items'],
              },
            },
            narrative_summary: { type: 'string' },
            content_opportunities: {
              type: 'array',
              description: 'Suggested content to create based on coverage gaps',
              items: {
                type: 'object',
                properties: {
                  domain: { type: 'string' },
                  subtopic: { type: 'string' },
                  suggestion: { type: 'string' },
                  priority: {
                    type: 'string',
                    enum: ['critical', 'high', 'medium', 'low'],
                  },
                },
                required: ['domain', 'subtopic', 'suggestion', 'priority'],
              },
            },
          },
          required: ['domain_summaries', 'narrative_summary'],
        },
      },
    ],
    tool_choice: { type: 'tool' as const, name: 'return_digest' },
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  // Extract and parse the response
  if (response.stop_reason === 'max_tokens') {
    throw new AIServiceError(
      'Content too long for digest generation — response was truncated',
      413,
    );
  }

  const parsed = extractToolResult<ChangeReportResponse>(
    response,
    'return_digest',
    ChangeReportResponseSchema,
  );

  // Validate the parsed response
  if (!Array.isArray(parsed.domain_summaries) || !parsed.narrative_summary) {
    throw new AIServiceError(
      'Invalid change report structure returned by Claude',
      500,
    );
  }

  // Build an item lookup for merging top items with actual data
  const itemMap = new Map<string, ContentItemRow>();
  for (const item of typedItems) {
    itemMap.set(item.id, item);
  }

  // Merge Claude output with actual item data for domain_summaries
  const domainSummaries: ChangeReportDomainSummary[] = parsed.domain_summaries.map(
    (ds) => {
      const domainItems = domainGroups.get(ds.domain) ?? [];
      const topItems = ds.top_items
        .map((topItem) => {
          const item = itemMap.get(topItem.id);
          if (!item) return null;
          return {
            id: item.id,
            title: item.suggested_title || item.title || 'Untitled',
            content_type: item.content_type,
            why_notable: topItem.why_notable,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return {
        domain: ds.domain,
        item_count: domainItems.length,
        summary: ds.summary,
        top_items: topItems,
        key_themes: ds.key_themes,
      };
    },
  );

  // Calculate tokens used
  const tokensUsed =
    (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0);

  // Build filter metadata to store alongside the change report
  const filters: ChangeReportFilters | null =
    filterDomain || (filterKeywords && filterKeywords.length > 0) || dateFrom
      ? {
          ...(filterDomain ? { domain: filterDomain } : {}),
          ...(filterKeywords && filterKeywords.length > 0
            ? { keywords: filterKeywords }
            : {}),
          ...(dateFrom ? { date_from: dateFrom } : {}),
          ...(dateTo ? { date_to: dateTo } : {}),
        }
      : null;

  // Collect governance data for the period
  let governanceSummary: ChangeReportGovernanceSummary | null = null;
  try {
    // Count modified items in period
    const { count: modifiedCount } = await supabase
      .from('content_history')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStartISO)
      .lte('created_at', periodEndISO);

    // Count verified items in period
    const { count: verifiedCount } = await supabase
      .from('content_items')
      .select('*', { count: 'exact', head: true })
      .gte('verified_at', periodStartISO)
      .lte('verified_at', periodEndISO);

    // Count flagged items in period
    const { count: flaggedCount } = await supabase
      .from('ingestion_quality_log')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStartISO)
      .lte('created_at', periodEndISO)
      .eq('resolved', false);

    // Freshness breakdown via server-side aggregation RPC.
    // Treat failure as zero counts (degrade-not-fail).
    const freshnessCounts = { fresh: 0, aging: 0, stale: 0, expired: 0 };
    const freshnessResult = await tryQuery(
      supabase.rpc('get_freshness_breakdown'),
      'rpc.freshness_breakdown',
    );
    if (!freshnessResult.ok) {
      logBestEffortWarn(
        'digest.governance.freshness',
        'freshness breakdown unavailable — defaulting to zero counts',
        {
          err: freshnessResult.error.message,
          code: freshnessResult.error.code,
        },
      );
    } else if (freshnessResult.data) {
      for (const row of freshnessResult.data as Array<{
        freshness: string;
        count: number;
      }>) {
        const f = row.freshness as keyof typeof freshnessCounts;
        if (f in freshnessCounts) freshnessCounts[f] = Number(row.count);
      }
    }

    governanceSummary = {
      items_modified: modifiedCount ?? 0,
      items_verified: verifiedCount ?? 0,
      items_flagged: flaggedCount ?? 0,
      freshness_breakdown: freshnessCounts,
    };
  } catch (govErr) {
    logger.error(
      { err: govErr, op: 'digest.collect-governance' },
      'Failed to collect governance data for digest',
    );
  }

  // Extract content opportunities from Claude response
  const contentOpportunities = parsed.content_opportunities ?? [];

  // Store in the change_reports table
  const digestRow = {
    frequency: digestType,
    period_start: periodStartISO,
    period_end: periodEndISO,
    item_count: typedItems.length,
    domain_summaries: toJson(domainSummaries),
    narrative_summary: parsed.narrative_summary,
    generated_at: new Date().toISOString(),
    generated_by: model,
    tokens_used: tokensUsed,
    metadata: toJson({
      ...(filters ?? {}),
      ...(governanceSummary ? { governance_summary: governanceSummary } : {}),
      ...(contentOpportunities.length > 0
        ? { content_opportunities: contentOpportunities }
        : {}),
    }),
    created_by: userId,
  };

  const { data: insertedDigest, error: insertError } = await supabase
    .from('change_reports')
    .insert(digestRow)
    .select()
    .single();

  if (insertError || !insertedDigest) {
    logger.error(
      { err: insertError, op: 'digest.store' },
      'Failed to store digest',
    );
    throw new AIServiceError('Digest generated but failed to store', 500);
  }

  // Build the full ChangeReport response
  const digest: ChangeReport = {
    id: insertedDigest.id,
    frequency: insertedDigest.frequency,
    period_start: insertedDigest.period_start,
    period_end: insertedDigest.period_end,
    item_count: insertedDigest.item_count,
    domain_summaries: domainSummaries,
    narrative_summary: parsed.narrative_summary,
    generated_at: insertedDigest.generated_at,
    generated_by: insertedDigest.generated_by,
    tokens_used: insertedDigest.tokens_used,
    filters,
    governance_summary: governanceSummary,
    created_at: insertedDigest.created_at,
  };

  return { digest };
}
