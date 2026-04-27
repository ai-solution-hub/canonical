/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck — Standalone Bun script, not part of Next.js build
/**
 * Intelligence Classification Verification Script
 *
 * Verifies that intelligence-ingested content items have correct classification,
 * entity extraction, and embeddings. Produces a structured Markdown report.
 *
 * Usage:
 *   bun run scripts/verify-intelligence-classification.ts
 *   bun run scripts/verify-intelligence-classification.ts --workspace-id <UUID>
 *   bun run scripts/verify-intelligence-classification.ts --limit 50
 *
 * Exit codes:
 *   0 — All checks pass (or <20% unclassified)
 *   1 — >20% of items are unclassified (pipeline issue)
 */

import { createClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Env loading (standalone script — no Next.js context)
// ---------------------------------------------------------------------------

function loadEnvFile(path: string): void {
  try {
    const content = Bun.file(path).textSync();
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — fine
  }
}

loadEnvFile('.env.local');
loadEnvFile('.env');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationItem {
  content_item_id: string;
  title: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  has_embedding: boolean;
  entity_count: number;
}

export interface VerificationIssue {
  item_id: string;
  title: string;
  issue: string;
}

export interface VerificationResult {
  total_items: number;
  classified_count: number;
  unclassified_count: number;
  classification_rate: number;
  entity_coverage_count: number;
  entity_coverage_rate: number;
  embedding_coverage_count: number;
  embedding_coverage_rate: number;
  domain_distribution: Record<string, number>;
  subtopic_distribution: Record<string, number>;
  entity_type_distribution: Record<string, number>;
  average_entities_per_item: number;
  issues: VerificationIssue[];
  invalid_domains: string[];
  invalid_subtopics: string[];
}

// ---------------------------------------------------------------------------
// Core verification logic (exported for testing)
// ---------------------------------------------------------------------------

export function safePercent(count: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((count / total) * 1000) / 10; // 1 decimal place
}

export function analyseItems(
  items: VerificationItem[],
  validDomains: Set<string>,
  validSubtopics: Set<string>,
  entityTypeCounts: Record<string, number>,
): VerificationResult {
  const total = items.length;

  // Classification completeness
  const classified = items.filter(
    (i) => i.primary_domain !== null && i.primary_subtopic !== null,
  );
  const unclassified = items.filter(
    (i) => i.primary_domain === null || i.primary_subtopic === null,
  );

  // Entity coverage
  const withEntities = items.filter((i) => i.entity_count > 0);

  // Embedding coverage
  const withEmbeddings = items.filter((i) => i.has_embedding);

  // Domain distribution
  const domainDist: Record<string, number> = {};
  for (const item of items) {
    if (item.primary_domain) {
      domainDist[item.primary_domain] =
        (domainDist[item.primary_domain] ?? 0) + 1;
    }
  }

  // Subtopic distribution
  const subtopicDist: Record<string, number> = {};
  for (const item of items) {
    if (item.primary_subtopic) {
      subtopicDist[item.primary_subtopic] =
        (subtopicDist[item.primary_subtopic] ?? 0) + 1;
    }
  }

  // Total entities across all items
  const totalEntities = items.reduce((sum, i) => sum + i.entity_count, 0);
  const avgEntities = total > 0 ? totalEntities / total : 0;

  // Identify issues
  const issues: VerificationIssue[] = [];
  const invalidDomains: string[] = [];
  const invalidSubtopics: string[] = [];

  for (const item of items) {
    if (item.primary_domain === null) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: 'Missing primary_domain',
      });
    } else if (!validDomains.has(item.primary_domain)) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: `Invalid domain: "${item.primary_domain}"`,
      });
      if (!invalidDomains.includes(item.primary_domain)) {
        invalidDomains.push(item.primary_domain);
      }
    }

    if (item.primary_subtopic === null) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: 'Missing primary_subtopic',
      });
    } else if (!validSubtopics.has(item.primary_subtopic)) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: `Invalid subtopic: "${item.primary_subtopic}"`,
      });
      if (!invalidSubtopics.includes(item.primary_subtopic)) {
        invalidSubtopics.push(item.primary_subtopic);
      }
    }

    if (!item.has_embedding) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: 'Missing embedding',
      });
    }

    if (item.entity_count === 0) {
      issues.push({
        item_id: item.content_item_id,
        title: item.title,
        issue: 'No entity mentions extracted',
      });
    }
  }

  return {
    total_items: total,
    classified_count: classified.length,
    unclassified_count: unclassified.length,
    classification_rate: safePercent(classified.length, total),
    entity_coverage_count: withEntities.length,
    entity_coverage_rate: safePercent(withEntities.length, total),
    embedding_coverage_count: withEmbeddings.length,
    embedding_coverage_rate: safePercent(withEmbeddings.length, total),
    domain_distribution: domainDist,
    subtopic_distribution: subtopicDist,
    entity_type_distribution: entityTypeCounts,
    average_entities_per_item: Math.round(avgEntities * 10) / 10,
    issues: issues.slice(0, 50), // Cap at 50 issues
    invalid_domains: invalidDomains,
    invalid_subtopics: invalidSubtopics,
  };
}

export function formatReport(result: VerificationResult): string {
  const lines: string[] = [
    '# Intelligence Classification Verification Report',
    '',
    `**Total items analysed:** ${result.total_items}`,
    '',
    '## Coverage Summary',
    '',
    '| Metric | Count | Rate |',
    '| --- | --- | --- |',
    `| Classification (domain + subtopic) | ${result.classified_count}/${result.total_items} | ${result.classification_rate}% |`,
    `| Entity extraction | ${result.entity_coverage_count}/${result.total_items} | ${result.entity_coverage_rate}% |`,
    `| Embeddings | ${result.embedding_coverage_count}/${result.total_items} | ${result.embedding_coverage_rate}% |`,
    '',
    `**Average entities per item:** ${result.average_entities_per_item}`,
  ];

  // Domain distribution
  const domainEntries = Object.entries(result.domain_distribution).sort(
    ([, a], [, b]) => b - a,
  );
  if (domainEntries.length > 0) {
    lines.push(
      '',
      '## Domain Distribution',
      '',
      '| Domain | Count |',
      '| --- | --- |',
    );
    for (const [domain, count] of domainEntries) {
      lines.push(`| ${domain} | ${count} |`);
    }
  }

  // Subtopic distribution
  const subtopicEntries = Object.entries(result.subtopic_distribution).sort(
    ([, a], [, b]) => b - a,
  );
  if (subtopicEntries.length > 0) {
    lines.push(
      '',
      '## Subtopic Distribution',
      '',
      '| Subtopic | Count |',
      '| --- | --- |',
    );
    for (const [subtopic, count] of subtopicEntries) {
      lines.push(`| ${subtopic} | ${count} |`);
    }
  }

  // Entity type distribution
  const entityEntries = Object.entries(result.entity_type_distribution).sort(
    ([, a], [, b]) => b - a,
  );
  if (entityEntries.length > 0) {
    lines.push(
      '',
      '## Entity Type Distribution',
      '',
      '| Entity Type | Count |',
      '| --- | --- |',
    );
    for (const [entityType, count] of entityEntries) {
      lines.push(`| ${entityType} | ${count} |`);
    }
  }

  // Invalid domains/subtopics
  if (result.invalid_domains.length > 0) {
    lines.push(
      '',
      '## Invalid Domains',
      '',
      ...result.invalid_domains.map((d) => `- ${d}`),
    );
  }

  if (result.invalid_subtopics.length > 0) {
    lines.push(
      '',
      '## Invalid Subtopics',
      '',
      ...result.invalid_subtopics.map((s) => `- ${s}`),
    );
  }

  // Issues table
  if (result.issues.length > 0) {
    lines.push(
      '',
      `## Issues (${result.issues.length} shown, max 50)`,
      '',
      '| Item ID | Title | Issue |',
      '| --- | --- | --- |',
    );
    for (const issue of result.issues) {
      const shortId = issue.item_id.slice(0, 8) + '...';
      const truncTitle =
        issue.title.length > 40
          ? issue.title.slice(0, 40) + '...'
          : issue.title;
      lines.push(`| ${shortId} | ${truncTitle} | ${issue.issue} |`);
    }
  } else {
    lines.push('', '## Issues', '', '_No issues found._');
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI execution
// ---------------------------------------------------------------------------

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/verify-intelligence-classification.ts --env=prod`,
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  // Parse CLI args
  const args = process.argv.slice(2);
  let workspaceId: string | undefined;
  let limit = 200;
  let env = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--workspace-id' && args[i + 1]) {
      workspaceId = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    } else if (args[i].startsWith('--env=')) {
      env = args[i].slice('--env='.length);
    }
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl);

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. Get intelligence-ingested content items via feed_articles junction
  let articlesQuery = supabase
    .from('feed_articles')
    .select('content_item_id')
    .not('content_item_id', 'is', null);

  if (workspaceId) {
    articlesQuery = articlesQuery.eq('workspace_id', workspaceId);
  }

  const { data: feedArticles, error: feedError } =
    await articlesQuery.limit(limit);

  if (feedError) {
    console.error(`Failed to query feed_articles: ${feedError.message}`);
    process.exit(1);
  }

  const contentItemIds = [
    ...new Set(
      (feedArticles ?? [])
        .map((a: { content_item_id: string | null }) => a.content_item_id)
        .filter(Boolean) as string[],
    ),
  ];

  if (contentItemIds.length === 0) {
    console.log('No intelligence-ingested content items found.');
    process.exit(0);
  }

  // 2. Fetch content items with classification data
  const { data: contentItems, error: itemsError } = await supabase
    .from('content_items')
    .select('id, title, primary_domain, primary_subtopic, embedding')
    .in('id', contentItemIds);

  if (itemsError) {
    console.error(`Failed to query content_items: ${itemsError.message}`);
    process.exit(1);
  }

  // 3. Fetch entity mention counts per item
  const { data: entityCounts, error: entityError } = await supabase
    .from('entity_mentions')
    .select('content_item_id, entity_type')
    .in('content_item_id', contentItemIds);

  if (entityError) {
    console.error(`Failed to query entity_mentions: ${entityError.message}`);
    process.exit(1);
  }

  // Count entities per item and entity type distribution
  const entityCountMap = new Map<string, number>();
  const entityTypeDist: Record<string, number> = {};
  for (const em of entityCounts ?? []) {
    const itemId = (em as { content_item_id: string }).content_item_id;
    const entityType = (em as { entity_type: string }).entity_type;
    entityCountMap.set(itemId, (entityCountMap.get(itemId) ?? 0) + 1);
    entityTypeDist[entityType] = (entityTypeDist[entityType] ?? 0) + 1;
  }

  // 4. Fetch valid taxonomy domains and subtopics
  const [domainsResult, subtopicsResult] = await Promise.all([
    supabase.from('taxonomy_domains').select('name'),
    supabase.from('taxonomy_subtopics').select('name'),
  ]);

  const validDomains = new Set(
    (domainsResult.data ?? []).map((d: { name: string }) => d.name),
  );
  const validSubtopics = new Set(
    (subtopicsResult.data ?? []).map((s: { name: string }) => s.name),
  );

  // 5. Build verification items
  const items: VerificationItem[] = (contentItems ?? []).map(
    (ci: {
      id: string;
      title: string;
      primary_domain: string | null;
      primary_subtopic: string | null;
      embedding: unknown;
    }) => ({
      content_item_id: ci.id,
      title: ci.title,
      primary_domain: ci.primary_domain,
      primary_subtopic: ci.primary_subtopic,
      has_embedding: ci.embedding !== null,
      entity_count: entityCountMap.get(ci.id) ?? 0,
    }),
  );

  // 6. Analyse and format report
  const result = analyseItems(
    items,
    validDomains,
    validSubtopics,
    entityTypeDist,
  );
  const report = formatReport(result);

  console.log(report);

  // 7. Exit with non-zero if >20% unclassified
  if (
    result.total_items > 0 &&
    result.unclassified_count / result.total_items > 0.2
  ) {
    console.error(
      `\nWARNING: ${result.classification_rate}% classification rate is below the 80% threshold.`,
    );
    process.exit(1);
  }
}

// Only execute when run directly (not when imported by tests)
const isDirectExecution =
  typeof Bun !== 'undefined' && Bun.main === import.meta.path;

if (isDirectExecution) {
  main().catch((err) => {
    console.error('Verification script failed:', err);
    process.exit(1);
  });
}
