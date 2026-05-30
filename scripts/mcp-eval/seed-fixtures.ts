#!/usr/bin/env bun
/**
 * Seed deterministic MCP evaluation Q&A fixtures.
 *
 * These rows are persistent staging fixtures, not per-run test artifacts. They
 * are identified by `metadata.mcp_eval_seed = true` and are intentionally not
 * removed by MCP eval cleanup. The eval matrix consumes them after this script
 * runs once before L1/L3/L4 fan-out.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import type { Database, Json } from '@/supabase/types/database.types';
import {
  generateEmbedding,
  getEmbeddingModel,
  MAX_EMBEDDING_CHARS,
} from '../../lib/ai/embed';
import { loadEnv } from './fixtures.js';
import {
  MCP_EVAL_SEED_GUIDE_ID,
  MCP_EVAL_SEED_GUIDE_SECTIONS,
  MCP_EVAL_SEED_GUIDE_SLUG,
  MCP_EVAL_SEED_ITEMS,
  MCP_EVAL_SEED_METADATA,
  MCP_EVAL_SEED_METADATA_FLAG,
  MCP_EVAL_SEED_TITLE_PREFIX,
  MCP_EVAL_SEED_VERSION,
  type McpEvalSeedItem,
} from './seed-data.js';

interface ExistingSeedRow {
  id: string;
  embedding: string | number[] | null;
  metadata: Record<string, unknown> | null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function titleForSeed(item: McpEvalSeedItem): string {
  return `${MCP_EVAL_SEED_TITLE_PREFIX} ${item.question}`;
}

function contentForSeed(item: McpEvalSeedItem): string {
  return [
    `Question: ${item.question}`,
    '',
    `Standard answer: ${item.answerStandard}`,
    '',
    `Advanced answer: ${item.answerAdvanced ?? item.answerStandard}`,
    '',
    `Domains: ${item.primaryDomain}/${item.primarySubtopic}` +
      (item.secondaryDomain
        ? `; ${item.secondaryDomain}/${item.secondarySubtopic ?? 'general'}`
        : ''),
    `Keywords: ${item.keywords.join(', ')}`,
  ].join('\n');
}

function embeddingInputForSeed(item: McpEvalSeedItem): string {
  return [
    titleForSeed(item),
    item.question,
    item.answerStandard,
    item.answerAdvanced ?? '',
    item.primaryDomain,
    item.primarySubtopic,
    item.secondaryDomain ?? '',
    item.secondarySubtopic ?? '',
    item.keywords.join(' '),
  ]
    .join('\n\n')
    .slice(0, MAX_EMBEDDING_CHARS);
}

function needsEmbedding(existing: ExistingSeedRow | null): boolean {
  if (!existing?.embedding) return true;
  return existing.metadata?.mcp_eval_seed_version !== MCP_EVAL_SEED_VERSION;
}

async function seedGuideFixture(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  const { error: guideError } = await supabase.from('guides').upsert(
    {
      id: MCP_EVAL_SEED_GUIDE_ID,
      slug: MCP_EVAL_SEED_GUIDE_SLUG,
      name: 'MCP Eval Guide',
      description:
        'Deterministic guide fixture for MCP response-quality evaluation.',
      guide_type: 'custom',
      domain_filter: 'security',
      icon: 'shield',
      color: 'blue',
      display_order: 9000,
      is_published: true,
    },
    { onConflict: 'id' },
  );

  if (guideError) {
    throw new Error(`Failed to upsert seed guide: ${guideError.message}`);
  }

  const sectionRows = MCP_EVAL_SEED_GUIDE_SECTIONS.map((section) => ({
    id: section.id,
    guide_id: MCP_EVAL_SEED_GUIDE_ID,
    section_name: section.sectionName,
    description: section.description,
    expected_layer: section.expectedLayer,
    subtopic_filter: section.subtopicFilter,
    content_type_filter: 'q_a_pair',
    display_order: section.displayOrder,
    is_required: true,
  }));

  const { error: sectionError } = await supabase
    .from('guide_sections')
    .upsert(sectionRows, { onConflict: 'id' });

  if (sectionError) {
    throw new Error(
      `Failed to upsert seed guide sections: ${sectionError.message}`,
    );
  }
}

async function main(): Promise<void> {
  loadEnv();

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error('Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL');
  }

  const serviceRoleKey = getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY');
  getRequiredEnv('OPENAI_API_KEY');

  const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const embeddingModel = getEmbeddingModel();
  let createdOrUpdated = 0;
  let reusedEmbeddings = 0;
  let regeneratedEmbeddings = 0;

  console.log(
    `Seeding ${MCP_EVAL_SEED_ITEMS.length} MCP eval Q&A fixture(s) using ${embeddingModel}...`,
  );

  await seedGuideFixture(supabase);
  console.log(`  ✓ guide:${MCP_EVAL_SEED_GUIDE_SLUG}`);

  for (const item of MCP_EVAL_SEED_ITEMS) {
    const { data: existing, error: existingError } = await supabase
      .from('content_items')
      .select('id, embedding, metadata')
      .eq('id', item.id)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Failed to inspect existing seed item ${item.key}: ${existingError.message}`,
      );
    }

    let embedding = (existing as ExistingSeedRow | null)?.embedding ?? null;
    if (needsEmbedding(existing as ExistingSeedRow | null)) {
      embedding = JSON.stringify(
        await generateEmbedding(embeddingInputForSeed(item)),
      );
      regeneratedEmbeddings++;
    } else {
      reusedEmbeddings++;
      embedding =
        typeof embedding === 'string' ? embedding : JSON.stringify(embedding);
    }

    const title = titleForSeed(item);
    const content = contentForSeed(item);
    const isPresent = (v: string | undefined): v is string => Boolean(v);
    const metadata: Json = {
      ...MCP_EVAL_SEED_METADATA,
      mcp_eval_seed_key: item.key,
      mcp_eval_seed_role: item.role ?? null,
      domains: [item.primaryDomain, item.secondaryDomain].filter(isPresent),
      subtopics: [item.primarySubtopic, item.secondarySubtopic].filter(
        isPresent,
      ),
      keywords: item.keywords,
    };

    const { error: upsertError } = await supabase.from('content_items').upsert(
      {
        id: item.id,
        title,
        suggested_title: title,
        content,
        content_type: 'q_a_pair',
        platform: 'manual',
        captured_date: '2026-01-01T00:00:00.000Z',
        metadata,
        embedding,
        embedding_model: embeddingModel,
        answer_standard: item.answerStandard,
        answer_advanced: item.answerAdvanced ?? item.answerStandard,
        summary: item.summary,
        ai_keywords: item.keywords,
        primary_domain: item.primaryDomain,
        primary_subtopic: item.primarySubtopic,
        secondary_domain: item.secondaryDomain ?? null,
        secondary_subtopic: item.secondarySubtopic ?? null,
        layer: item.layer,
        freshness: 'fresh',
        lifecycle_type: 'evergreen',
        publication_status: 'published',
        governance_review_status: 'approved',
        archived_at: null,
        archive_reason: null,
      },
      { onConflict: 'id' },
    );

    if (upsertError) {
      throw new Error(
        `Failed to upsert seed item ${item.key}: ${upsertError.message}`,
      );
    }

    createdOrUpdated++;
    console.log(`  ✓ ${item.key}`);
  }

  const { count, error: countError } = await supabase
    .from('content_items')
    .select('id', { count: 'exact', head: true })
    .contains('metadata', { [MCP_EVAL_SEED_METADATA_FLAG]: true })
    .eq('content_type', 'q_a_pair')
    .eq('publication_status', 'published')
    .not('embedding', 'is', null)
    .is('archived_at', null);

  if (countError) {
    throw new Error(`Failed to verify seed count: ${countError.message}`);
  }

  if ((count ?? 0) < MCP_EVAL_SEED_ITEMS.length) {
    throw new Error(
      `Expected at least ${MCP_EVAL_SEED_ITEMS.length} seeded Q&A item(s), found ${count ?? 0}`,
    );
  }

  console.log(
    `MCP eval seed complete: ${createdOrUpdated} upserted, ` +
      `${reusedEmbeddings} embedding(s) reused, ` +
      `${regeneratedEmbeddings} embedding(s) generated.`,
  );
}

main().catch((err) => {
  console.error(
    'MCP eval seed failed:',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
});
