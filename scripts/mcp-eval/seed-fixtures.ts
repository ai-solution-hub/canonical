#!/usr/bin/env bun
/**
 * Seed deterministic MCP evaluation Q&A fixtures.
 *
 * These rows are persistent staging fixtures, not per-run test artifacts.
 * They are identified by their fixed, deterministic `id`s
 * (MCP_EVAL_SEED_ITEMS) and are intentionally not removed by MCP eval
 * cleanup. The eval matrix consumes them after this script runs once before
 * L1/L3/L4 fan-out.
 *
 * ID-139.1 (M6 re-point): content_items/content_history were dropped
 * (20260706110000_id131_drops.sql). Fixture storage moves onto the
 * surviving model — q_a_pairs (question/answer text) + record_embeddings
 * (polymorphic vector store, owner_kind='q_a_pair') + record_lifecycle
 * (governance/domain facet) — mirroring the re-point precedents in
 * lib/domains/procurement/form-templating/template-coverage.ts
 * (fetchContentForMatching) and lib/q-a-pairs/promote-corpus.ts
 * (embedAndPublish). q_a_pairs carries no metadata/title/content/keywords/
 * layer/freshness/lifecycle_type columns — those content_items-era fields
 * have no home in the new model and are dropped from the write path (the
 * deterministic seed `id`s are the idempotency key instead of a
 * metadata.mcp_eval_seed flag); `domain` is the one classification field
 * record_lifecycle preserves for a q_a_pair (BI-18/19 — subtopic has no
 * facet equivalent, explicit drift not fabricated). record_lifecycle's
 * freshness axis (freshness/lifecycle_type/expiry_date/review_cadence_days)
 * is source_document-only (record_lifecycle_freshness_axis_chk) so is never
 * written for a q_a_pair owner.
 */
import { type SupabaseClient } from '@supabase/supabase-js';

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import type { Database } from '@/supabase/types/database.types';
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
  MCP_EVAL_SEED_TITLE_PREFIX,
  type McpEvalSeedItem,
} from './seed-data.js';

/** A previously-seeded record_embeddings row for a q_a_pair owner. */
interface ExistingEmbeddingRow {
  owner_id: string;
  embedding: string | number[] | null;
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

/**
 * record_embeddings carries no seed-version marker (unlike the retired
 * content_items.metadata.mcp_eval_seed_version) — the only signal available
 * post-M6 is presence/absence of a row for this owner+model. A content edit
 * to MCP_EVAL_SEED_ITEMS therefore now requires deleting the stale
 * record_embeddings row (or bumping AI_EMBEDDING_MODEL) to force a
 * regeneration; this is a real, accepted behaviour narrowing versus the
 * dropped content_items version-comparison — see the module header.
 */
function needsEmbedding(existing: ExistingEmbeddingRow | null): boolean {
  return !existing?.embedding;
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

  const supabase = createScriptClient(supabaseUrl, serviceRoleKey, {
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
    // Existence/reuse check moves onto record_embeddings (the sole vector
    // store post-M6) keyed by (owner_kind, owner_id, model) — see module
    // header.
    const { data: existing, error: existingError } = await supabase
      .from('record_embeddings')
      .select('owner_id, embedding')
      .eq('owner_kind', 'q_a_pair')
      .eq('owner_id', item.id)
      .eq('model', embeddingModel)
      .maybeSingle();

    if (existingError) {
      throw new Error(
        `Failed to inspect existing seed embedding ${item.key}: ${existingError.message}`,
      );
    }

    let embedding =
      (existing as ExistingEmbeddingRow | null)?.embedding ?? null;
    if (needsEmbedding(existing as ExistingEmbeddingRow | null)) {
      embedding = JSON.stringify(
        await generateEmbedding(embeddingInputForSeed(item)),
      );
      regeneratedEmbeddings++;
    } else {
      reusedEmbeddings++;
      embedding =
        typeof embedding === 'string' ? embedding : JSON.stringify(embedding);
    }

    // q_a_pairs: question/answer text only — no title/content/metadata/
    // keywords/layer columns survive M6 (see module header).
    const { error: pairError } = await supabase.from('q_a_pairs').upsert(
      {
        id: item.id,
        question_text: item.question,
        answer_standard: item.answerStandard,
        answer_advanced: item.answerAdvanced ?? item.answerStandard,
        origin_kind: 'manually_authored',
        publication_status: 'published',
      },
      { onConflict: 'id' },
    );

    if (pairError) {
      throw new Error(
        `Failed to upsert seed q_a_pair ${item.key}: ${pairError.message}`,
      );
    }

    // record_embeddings: the polymorphic vector store (BI-17/{131.21}
    // precedent — lib/q-a-pairs/promote-corpus.ts embedAndPublish).
    const { error: embeddingError } = await supabase
      .from('record_embeddings')
      .upsert(
        {
          owner_kind: 'q_a_pair',
          owner_id: item.id,
          model: embeddingModel,
          embedding,
        },
        { onConflict: 'owner_kind,owner_id,model' },
      );

    if (embeddingError) {
      throw new Error(
        `Failed to upsert seed record_embeddings ${item.key}: ${embeddingError.message}`,
      );
    }

    // record_lifecycle: governance/domain facet only — the freshness axis
    // (freshness/lifecycle_type/expiry_date/review_cadence_days) is
    // source_document-only (record_lifecycle_freshness_axis_chk) and is
    // never written for a q_a_pair owner; primary_subtopic/secondary_domain/
    // secondary_subtopic have no facet equivalent (BI-18/19 explicit drift).
    // `freshness`/`lifecycle_type` DEFAULT to 'fresh'/'evergreen' at the
    // column level (a content_items-era default retained on the table) —
    // MUST be explicitly nulled here or the axis CHECK
    // (record_lifecycle_freshness_axis_chk) rejects the insert for a
    // non-source_document owner (confirmed empirically against staging).
    const { error: lifecycleError } = await supabase
      .from('record_lifecycle')
      .upsert(
        {
          owner_kind: 'q_a_pair',
          q_a_pair_id: item.id,
          domain: item.primaryDomain,
          governance_review_status: 'approved',
          freshness: null,
          lifecycle_type: null,
        },
        { onConflict: 'owner_kind,owner_id' },
      );

    if (lifecycleError) {
      throw new Error(
        `Failed to upsert seed record_lifecycle ${item.key}: ${lifecycleError.message}`,
      );
    }

    createdOrUpdated++;
    console.log(`  ✓ ${item.key}`);
  }

  // Verification re-pointed onto the deterministic seed `id`s (the
  // idempotency key in the new model — see module header) rather than a
  // metadata.mcp_eval_seed flag content_items no longer has.
  const seedIds = MCP_EVAL_SEED_ITEMS.map((seedItem) => seedItem.id);

  const { count, error: countError } = await supabase
    .from('q_a_pairs')
    .select('id', { count: 'exact', head: true })
    .in('id', seedIds)
    .eq('publication_status', 'published');

  if (countError) {
    throw new Error(`Failed to verify seed count: ${countError.message}`);
  }

  if ((count ?? 0) < MCP_EVAL_SEED_ITEMS.length) {
    throw new Error(
      `Expected at least ${MCP_EVAL_SEED_ITEMS.length} seeded Q&A item(s), found ${count ?? 0}`,
    );
  }

  const { count: embeddingCount, error: embeddingCountError } = await supabase
    .from('record_embeddings')
    .select('id', { count: 'exact', head: true })
    .eq('owner_kind', 'q_a_pair')
    .in('owner_id', seedIds)
    .eq('model', embeddingModel);

  if (embeddingCountError) {
    throw new Error(
      `Failed to verify seed embedding count: ${embeddingCountError.message}`,
    );
  }

  if ((embeddingCount ?? 0) < MCP_EVAL_SEED_ITEMS.length) {
    throw new Error(
      `Expected at least ${MCP_EVAL_SEED_ITEMS.length} seeded Q&A embedding(s), found ${embeddingCount ?? 0}`,
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
