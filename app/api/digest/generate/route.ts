import { NextRequest, NextResponse } from 'next/server';
import { getAnthropicClient, getAIModel } from '@/lib/anthropic';
import { extractToolResult } from '@/lib/ai-parse';
import {
  getAuthorisedClient,
  forbiddenResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';
import { subDays, startOfDay, endOfDay, format } from 'date-fns';
import { parseBody } from '@/lib/validation';
import { DigestGenerateBodySchema } from '@/lib/validation/schemas';
import { DigestResponseSchema } from '@/lib/validation/ai-schemas';
import type { DigestResponse } from '@/lib/validation/ai-schemas';
import { toJson } from '@/lib/validation/jsonb';
import type {
  DigestDomainSummary,
  DigestFilters,
  DigestGovernanceSummary,
  Digest,
} from '@/types/digest';

export const maxDuration = 60;

interface ContentItemRow {
  id: string;
  title: string;
  suggested_title: string | null;
  ai_summary: string | null;
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

// ClaudeDigestResponse type is now derived from DigestResponseSchema
// in lib/validation/ai-schemas.ts (DigestResponse).

/**
 * Build the Claude prompt for a standard (weekly/custom period) digest.
 */
function buildStandardPrompt(
  periodLabel: string,
  itemCount: number,
  itemsByDomainText: string,
  crossDomainSection: string,
  filterContext: string,
): string {
  return `You are generating a content digest for a knowledge base.
Period: ${periodLabel}
Total items: ${itemCount}
${filterContext}
Items by domain:
${itemsByDomainText}
${crossDomainSection}
Rules:
- narrative_summary: 2-3 paragraphs summarising the period's content themes and highlights. Write in second person ("you captured", "your focus was on").
- domain_summaries: one per domain that has items, with a concise 2-3 sentence summary
- key_themes: 2-5 themes per domain
- top_items: the 3 most interesting/important items per domain with a brief explanation of why each stands out this period. Use the exact UUIDs from the item list above. If a domain has fewer than 3 items, include all of them.
- theme_clusters: cross-domain themes that span multiple domains (3-7 clusters)
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
): string {
  return `You are generating a brief daily digest for a knowledge base.
Date: ${periodLabel}
Total new items: ${itemCount}
${filterContext}
Items by domain:
${itemsByDomainText}

Rules:
- narrative_summary: 1 short paragraph (2-4 sentences) summarising what was captured today. Write in second person ("you added", "today's captures focus on"). Keep it punchy.
- domain_summaries: one per domain that has items, with a single concise sentence
- key_themes: 1-3 themes per domain (keep it brief)
- top_items: highlight the 1-2 most interesting items per domain. Use the exact UUIDs from the item list above. If a domain has only 1 item, include it.
- theme_clusters: 1-3 cross-domain themes only if genuinely applicable. If items are few and unrelated, return an empty array.
- Use UK English throughout
- Be concise — this is a daily snapshot, not a deep analysis`;
}

export async function POST(request: NextRequest) {
  try {
    // Auth + role check
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth) return forbiddenResponse();
    const { user, supabase } = auth;

    // Rate limit: 3 requests per 5 minutes
    const { allowed } = checkRateLimit(`digest:${user.id}`, 3, 5 * 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const raw = await request.json();
    const validated = parseBody(DigestGenerateBodySchema, raw);
    if (!validated.success) return validated.response;
    const {
      period_days: periodDays,
      digest_type: digestType,
      domain: filterDomain,
      keywords: filterKeywords,
      date_from: dateFrom,
      date_to: dateTo,
    } = validated.data;

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
        'id, title, suggested_title, ai_summary, primary_domain, primary_subtopic, content_type, ai_keywords, captured_date, summary_data',
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
      console.error('Failed to fetch content items:', fetchError);
      return NextResponse.json(
        { error: 'Failed to fetch content items for digest' },
        { status: 500 },
      );
    }

    const typedItems = (items ?? []) as ContentItemRow[];

    if (typedItems.length === 0) {
      return NextResponse.json(
        { error: 'No content items found for the selected filters and period' },
        { status: 400 },
      );
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
      .map(
        ([kw, domains]) =>
          `${kw} (appears in: ${[...domains].join(', ')})`,
      );

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
        // Prefer summary_data.executive (full-content summary) over ai_summary (classification-time)
        const summary =
          item.summary_data?.executive ??
          (item.ai_summary
            ? item.ai_summary.slice(0, summaryMaxLen)
            : 'No summary available');
        const keywords =
          item.ai_keywords?.slice(0, maxKeywords).join(', ') ?? '';

        itemsByDomainText += `- [${item.id}] "${displayTitle}" (${item.content_type}) - ${summary}`;
        if (keywords) {
          itemsByDomainText += ` [keywords: ${keywords}]`;
        }
        itemsByDomainText += '\n';

        // Include takeaways if available (skip for daily to save tokens)
        if (maxTakeaways > 0) {
          const takeaways = item.summary_data?.takeaways?.slice(
            0,
            maxTakeaways,
          );
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

    // Choose prompt based on digest type
    const prompt = isDaily
      ? buildDailyPrompt(
          periodLabel,
          typedItems.length,
          itemsByDomainText,
          filterContext,
        )
      : buildStandardPrompt(
          periodLabel,
          typedItems.length,
          itemsByDomainText,
          crossDomainSection,
          filterContext,
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
              theme_clusters: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    theme: { type: 'string' },
                    description: { type: 'string' },
                    item_count: { type: 'number' },
                  },
                  required: ['theme', 'description', 'item_count'],
                },
              },
            },
            required: [
              'domain_summaries',
              'narrative_summary',
              'theme_clusters',
            ],
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
      return NextResponse.json(
        {
          error:
            'Content too long for digest generation — response was truncated',
        },
        { status: 413 },
      );
    }

    const parsed = extractToolResult<DigestResponse>(
      response,
      'return_digest',
      DigestResponseSchema,
    );

    // Validate the parsed response
    if (
      !Array.isArray(parsed.domain_summaries) ||
      !parsed.narrative_summary ||
      !Array.isArray(parsed.theme_clusters)
    ) {
      return NextResponse.json(
        { error: 'Invalid digest structure returned by Claude' },
        { status: 500 },
      );
    }

    // Build an item lookup for merging top items with actual data
    const itemMap = new Map<string, ContentItemRow>();
    for (const item of typedItems) {
      itemMap.set(item.id, item);
    }

    // Merge Claude output with actual item data for domain_summaries
    const domainSummaries: DigestDomainSummary[] = parsed.domain_summaries.map(
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
      (response.usage?.input_tokens ?? 0) +
      (response.usage?.output_tokens ?? 0);

    // Build filter metadata to store alongside the digest
    const filters: DigestFilters | null =
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
    let governanceSummary: DigestGovernanceSummary | null = null;
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

      // Freshness breakdown for all items
      const { data: freshnessData } = await supabase
        .from('content_items')
        .select('freshness');

      const freshnessCounts = { fresh: 0, aging: 0, stale: 0, expired: 0 };
      if (freshnessData) {
        for (const item of freshnessData) {
          const f = item.freshness as keyof typeof freshnessCounts;
          if (f in freshnessCounts) freshnessCounts[f]++;
        }
      }

      governanceSummary = {
        items_modified: modifiedCount ?? 0,
        items_verified: verifiedCount ?? 0,
        items_flagged: flaggedCount ?? 0,
        freshness_breakdown: freshnessCounts,
      };
    } catch (govErr) {
      console.error('Failed to collect governance data for digest:', govErr);
    }

    // Store in the digests table
    const digestRow = {
      digest_type: digestType,
      period_start: periodStartISO,
      period_end: periodEndISO,
      item_count: typedItems.length,
      domain_summaries: toJson(domainSummaries),
      theme_clusters: toJson(parsed.theme_clusters),
      narrative_summary: parsed.narrative_summary,
      generated_at: new Date().toISOString(),
      generated_by: model,
      tokens_used: tokensUsed,
      metadata: toJson({
        ...(filters ?? {}),
        ...(governanceSummary ? { governance_summary: governanceSummary } : {}),
      }),
      created_by: user.id,
    };

    const { data: insertedDigest, error: insertError } = await supabase
      .from('digests')
      .insert(digestRow)
      .select()
      .single();

    if (insertError || !insertedDigest) {
      console.error('Failed to store digest:', insertError);
      return NextResponse.json(
        { error: 'Digest generated but failed to store' },
        { status: 500 },
      );
    }

    // Build the full Digest response
    const digest: Digest = {
      id: insertedDigest.id,
      digest_type: insertedDigest.digest_type,
      period_start: insertedDigest.period_start,
      period_end: insertedDigest.period_end,
      item_count: insertedDigest.item_count,
      domain_summaries: domainSummaries,
      theme_clusters: parsed.theme_clusters,
      narrative_summary: parsed.narrative_summary,
      generated_at: insertedDigest.generated_at,
      generated_by: insertedDigest.generated_by,
      tokens_used: insertedDigest.tokens_used,
      filters,
      governance_summary: governanceSummary,
      created_at: insertedDigest.created_at,
    };

    return NextResponse.json({ digest });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to generate digest') },
      { status: 500 },
    );
  }
}
