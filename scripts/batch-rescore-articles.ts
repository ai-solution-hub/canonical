/**
 * Batch Re-Score Feed Articles
 *
 * Re-runs relevance scoring on feed_articles that have "Failed to parse" reasoning,
 * which was caused by a bug where the LLM returned JSON wrapped in markdown code fences.
 * The fix (stripping code fences) is already in lib/intelligence/relevance-scorer.ts.
 *
 * Usage:
 *   bun run scripts/batch-rescore-articles.ts
 *   bun run scripts/batch-rescore-articles.ts --dry-run
 *   bun run scripts/batch-rescore-articles.ts --limit 10
 */

import { createClient } from '@supabase/supabase-js';
import { scoreRelevance } from '@/lib/intelligence/relevance-scorer';
import type { CompanyContext } from '@/lib/intelligence/types';

// ── Env loading ──

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
    // File doesn't exist -- that's fine
  }
}

const PROJECT_ROOT = new URL('..', import.meta.url).pathname;
loadEnvFile(`${PROJECT_ROOT}.env.local`);
loadEnvFile(`${PROJECT_ROOT}.env`);

// ── CLI args ──

function parseArgs(): { limit: number; dryRun: boolean; env: string } {
  const args = process.argv.slice(2);
  let limit = 0; // 0 = no limit
  let dryRun = false;
  let env = '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--dry-run') {
      dryRun = true;
    } else if (args[i] === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    } else if (args[i].startsWith('--env=')) {
      env = args[i].slice('--env='.length);
    }
  }

  return { limit, dryRun, env };
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/batch-rescore-articles.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ── Main ──

async function main() {
  const { limit, dryRun, env } = parseArgs();

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars');
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY env var');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // 1. Query articles that need re-scoring
  let query = supabase
    .from('feed_articles')
    .select(
      'id, title, raw_content, workspace_id, relevance_score, relevance_category, relevance_reasoning',
    )
    .like('relevance_reasoning', 'Failed to parse%')
    .order('created_at', { ascending: true });

  if (limit > 0) {
    query = query.limit(limit);
  }

  const { data: articles, error: queryError } = await query;

  if (queryError) {
    console.error('Failed to query articles:', queryError.message);
    process.exit(1);
  }

  if (!articles || articles.length === 0) {
    console.log('No articles found with "Failed to parse" reasoning.');
    return;
  }

  console.log(`Found ${articles.length} articles to re-score`);
  if (dryRun) {
    console.log('DRY RUN -- no changes will be made');
    for (const article of articles) {
      console.log(`  - ${article.title}`);
    }
    return;
  }

  // 2. Load company context and active prompt per workspace (cache for reuse)
  const contextCache = new Map<
    string,
    { company: CompanyContext | null; promptText: string | null }
  >();

  async function getContext(workspaceId: string) {
    if (contextCache.has(workspaceId)) {
      return contextCache.get(workspaceId)!;
    }

    // Load company context via workspace -> company_profiles
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('domain_metadata')
      .eq('id', workspaceId)
      .single();

    const profileId = (workspace?.domain_metadata as Record<string, unknown>)
      ?.company_profile_id as string | undefined;

    let company: CompanyContext | null = null;
    if (profileId) {
      const { data: profile } = await supabase
        .from('company_profiles')
        .select(
          'name, sectors, services, key_topics, target_customers, value_proposition',
        )
        .eq('id', profileId)
        .single();

      if (profile) {
        company = {
          name: profile.name,
          sectors: profile.sectors ?? [],
          services: profile.services ?? [],
          keyTopics: profile.key_topics ?? [],
          targetCustomers: profile.target_customers,
          valueProposition: profile.value_proposition,
        };
      }
    }

    // Load active prompt
    const { data: promptData } = await supabase
      .from('feed_prompts')
      .select('prompt_text')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .limit(1);

    const promptText = promptData?.[0]?.prompt_text ?? null;

    const ctx = { company, promptText };
    contextCache.set(workspaceId, ctx);
    return ctx;
  }

  // 3. Re-score each article
  const distribution: Record<string, number> = {
    high: 0,
    medium: 0,
    low: 0,
    irrelevant: 0,
  };
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < articles.length; i++) {
    const article = articles[i];
    const { company, promptText } = await getContext(article.workspace_id);

    if (!company) {
      console.log(
        `  [${i + 1}/${articles.length}] SKIP (no company profile): ${article.title}`,
      );
      failCount++;
      continue;
    }

    if (!article.raw_content) {
      console.log(
        `  [${i + 1}/${articles.length}] SKIP (no content): ${article.title}`,
      );
      failCount++;
      continue;
    }

    try {
      const result = await scoreRelevance(
        article.title,
        article.raw_content,
        company,
        undefined, // default threshold
        promptText ?? undefined,
      );

      // Update the article
      const { error: updateError } = await supabase
        .from('feed_articles')
        .update({
          relevance_score: result.score,
          relevance_category: result.category,
          relevance_reasoning: result.reasoning,
          matched_categories: result.matchedCategories,
          ai_summary: result.reasoning || null,
          passed: result.passed,
        })
        .eq('id', article.id);

      if (updateError) {
        console.log(
          `  [${i + 1}/${articles.length}] UPDATE ERROR: ${article.title} -- ${updateError.message}`,
        );
        failCount++;
        continue;
      }

      distribution[result.category]++;
      successCount++;

      const arrow =
        `${article.relevance_category}(${article.relevance_score})` +
        ` -> ${result.category}(${result.score.toFixed(2)})`;
      console.log(
        `  [${i + 1}/${articles.length}] ${result.passed ? 'PASS' : 'FAIL'} ${arrow}: ${article.title}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(
        `  [${i + 1}/${articles.length}] ERROR: ${article.title} -- ${msg}`,
      );
      failCount++;
    }

    // Rate limiting: 500ms delay between API calls
    if (i < articles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  // 4. Summary
  console.log('\n--- Re-Scoring Summary ---');
  console.log(`Total articles: ${articles.length}`);
  console.log(`Successfully re-scored: ${successCount}`);
  console.log(`Failed/skipped: ${failCount}`);
  console.log('\nScoring distribution:');
  console.log(`  HIGH:       ${distribution.high}`);
  console.log(`  MEDIUM:     ${distribution.medium}`);
  console.log(`  LOW:        ${distribution.low}`);
  console.log(`  IRRELEVANT: ${distribution.irrelevant}`);

  const passRate = (
    ((distribution.high + distribution.medium) / successCount) *
    100
  ).toFixed(1);
  console.log(`\nPass rate (HIGH+MEDIUM): ${passRate}%`);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
