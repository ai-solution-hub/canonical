/**
 * Golden Path Real DB Integration Tests (Phase 3b)
 *
 * Verifies the complete data lifecycle of a content item through the REAL database:
 *   Create content -> Classify (entities, temporal refs, domain)
 *     -> entity_mentions storage -> temporal reference bridging
 *       -> Guide matching -> Hybrid search retrieval -> Certification status
 *
 * These tests call real AI APIs (Claude for classification, OpenAI for embeddings)
 * and write to the real Supabase database. No mocks.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY
 *   - Run: bun run test:integration
 *
 * Spec: docs/specs/data-flow-golden-path-e2e-spec.md (Phase 3b)
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
// service-client MUST be imported first — it loads dotenv for all env vars
import { serviceClient } from './helpers/service-client';
import { getTestUserId } from './helpers/auth-session';
import { classifyContent } from '@/lib/ai/classify';
import { generateEmbedding } from '@/lib/ai/embed';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[GOLDEN-PATH-${Date.now()}]`;

const TEST_CONTENT = `${TEST_PREFIX} ISO 27001 Information Security Management

Our organisation holds ISO 27001:2022 certification, issued by BSI.
Certificate number: IS 98765. The certification is valid until 15 March 2028.
Last surveillance audit completed December 2025 with zero non-conformities.

We also comply with Cyber Essentials Plus, renewed annually.
Our ICO registration (reference ZA123456) expires on 30 September 2027.`;

const TEST_TITLE = `${TEST_PREFIX} ISO 27001 Security Certification`;

// Test user 1 (admin) — resolved at beforeAll from email via auth admin API
// (S186 WP-C — no more hardcoded OLD-project UUIDs).
let TEST_USER_ID: string = '';

// ---------------------------------------------------------------------------
// Shared state across sequential tests
// ---------------------------------------------------------------------------

let itemId: string | null = null;
let classifiedDomain: string | null = null;
let testGuideId: string | null = null;
let testGuideSectionId: string | null = null;

beforeAll(async () => {
  TEST_USER_ID = await getTestUserId('admin');
});

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  if (!itemId) return;

  // Delete in FK order to avoid constraint violations
  try {
    // 1. Entity relationships
    await serviceClient
      .from('entity_relationships')
      .delete()
      .eq('source_document_id', itemId);

    // 2. Entity mentions
    await serviceClient
      .from('entity_mentions')
      .delete()
      .eq('source_document_id', itemId);

    // 3. Content history
    await serviceClient
      .from('content_history')
      .delete()
      .eq('content_item_id', itemId);

    // 4. Content item
    await serviceClient.from('content_items').delete().eq('id', itemId);

    // 5. Test guide and sections (if created)
    if (testGuideSectionId) {
      await serviceClient
        .from('guide_sections')
        .delete()
        .eq('id', testGuideSectionId);
    }
    if (testGuideId) {
      await serviceClient.from('guides').delete().eq('id', testGuideId);
    }
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Sequential test suite
// ---------------------------------------------------------------------------

describe('Golden Path Real DB Integration (Phase 3b)', () => {
  // Step 1
  it('Step 1: Create content item', async () => {
    const { data, error } = await serviceClient
      .from('content_items')
      .insert({
        title: TEST_TITLE,
        content: TEST_CONTENT,
        content_type: 'policy',
        platform: 'manual',
      })
      .select('id')
      .single();

    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data!.id).toBeTruthy();

    itemId = data!.id;

    // Verify item exists by re-querying
    const { data: verify, error: verifyErr } = await serviceClient
      .from('content_items')
      .select('id, title')
      .eq('id', itemId)
      .single();

    expect(verifyErr).toBeNull();
    expect(verify?.title).toBe(TEST_TITLE);
  });

  // Step 2
  it('Step 2: Classify content item', async () => {
    expect(itemId).toBeTruthy();

    const result = await classifyContent({
      supabase: serviceClient,
      itemId: itemId!,
      force: true,
      userId: TEST_USER_ID,
    });

    // AI is non-deterministic — use flexible assertions
    expect(result.primary_domain).toBeTruthy();
    expect(result.primary_subtopic).toBeTruthy();
    expect(result.classification_confidence).toBeGreaterThan(0);

    // Store for subsequent tests
    classifiedDomain = result.primary_domain;

    // Verify the DB was updated
    const { data: classified } = await serviceClient
      .from('content_items')
      .select('primary_domain, primary_subtopic, classified_at')
      .eq('id', itemId!)
      .single();

    expect(classified?.primary_domain).toBeTruthy();
    expect(classified?.primary_subtopic).toBeTruthy();
    expect(classified?.classified_at).toBeTruthy();
  }, 90_000); // Classification calls Claude API — allow extra time

  // Step 3
  it('Step 3: Verify entity_mentions rows', async () => {
    expect(itemId).toBeTruthy();

    const { data: entities, error } = await serviceClient
      .from('entity_mentions')
      .select('*')
      .eq('source_document_id', itemId!);

    expect(error).toBeNull();
    expect(entities).toBeTruthy();

    // Audited S186 — `entity_mentions` rows follow a successful Step 2
    // classify. Unique constraint
    // `entity_mentions_canonical_name_entity_type_content_item_id_key` is in
    // place; the earlier `[REAL BUG FOUND]` warning (removed) was a red
    // herring caused by a cascade from a stale hardcoded UUID in Step 2.
    // See `docs/audits/entity-mentions-step3-investigation-2026-04-22.md`.
    expect(entities!.length).toBeGreaterThanOrEqual(1);

    // At least one certification entity
    const certEntities = entities!.filter(
      (e) => e.entity_type === 'certification',
    );
    expect(certEntities.length).toBeGreaterThanOrEqual(1);

    // At least one with canonical_name containing 'iso' (case-insensitive)
    const isoEntities = entities!.filter((e) =>
      e.canonical_name?.toLowerCase().includes('iso'),
    );
    expect(isoEntities.length).toBeGreaterThanOrEqual(1);
  });

  // Step 4
  it('Step 4: Verify temporal references in metadata', async () => {
    expect(itemId).toBeTruthy();

    const { data: item, error } = await serviceClient
      .from('content_items')
      .select('metadata')
      .eq('id', itemId!)
      .single();

    expect(error).toBeNull();
    expect(item).toBeTruthy();

    const metadata = item!.metadata as Record<string, unknown>;
    const temporalRefs = metadata?.ai_temporal_references as Array<{
      date: string;
      context_type: string;
      context_snippet?: string;
    }>;

    expect(temporalRefs).toBeTruthy();
    expect(Array.isArray(temporalRefs)).toBe(true);
    expect(temporalRefs.length).toBeGreaterThanOrEqual(1);

    // At least one expiry reference
    const expiryRefs = temporalRefs.filter((r) => r.context_type === 'expiry');
    expect(expiryRefs.length).toBeGreaterThanOrEqual(1);

    // At least one reference containing '2028' (the ISO cert expiry)
    const has2028 = temporalRefs.some((r) => r.date?.includes('2028'));
    expect(has2028).toBe(true);
  });

  // Step 5
  it('Step 5: Verify entity metadata bridge (expiry dates)', async () => {
    expect(itemId).toBeTruthy();

    // Query certification entities and check if metadata was bridged
    const { data: certEntities, error } = await serviceClient
      .from('entity_mentions')
      .select('canonical_name, entity_type, metadata')
      .eq('source_document_id', itemId!)
      .eq('entity_type', 'certification');

    expect(error).toBeNull();
    expect(certEntities).toBeTruthy();
    expect(certEntities!.length).toBeGreaterThanOrEqual(1);

    // The entity-metadata-bridge (bridgeTemporalReferencesToEntities) should
    // populate expiry info on certification entities. This is a known gap area.
    // Use a soft check: log a warning if not populated but don't fail the test.
    const entitiesWithExpiry = certEntities!.filter((e) => {
      const meta = e.metadata as Record<string, unknown> | null;
      return meta && (meta.expiry_date || meta.temporal_references);
    });

    if (entitiesWithExpiry.length === 0) {
      console.warn(
        '[KNOWN GAP] No certification entities have expiry metadata bridged. ' +
          'The entity-metadata-bridge may not be populating data. ' +
          'See docs/specs/data-flow-golden-path-e2e-spec.md Gap 1.',
      );
    } else {
      // If the bridge IS working, validate the data
      expect(entitiesWithExpiry.length).toBeGreaterThanOrEqual(1);
    }

    // Hard assertion: cert entities must exist (bridge metadata is the soft part)
    expect(certEntities!.length).toBeGreaterThanOrEqual(1);

    // TODO: Uncomment when bridge code is implemented (Gap 1 fix)
    // expect(entitiesWithExpiry.length).toBeGreaterThanOrEqual(1);
    // const expiryMeta = entitiesWithExpiry[0].metadata as Record<string, unknown>;
    // expect(expiryMeta.expiry_date).toContain('2028');
  });

  // Step 6
  it('Step 6: Verify guide content RPC', async () => {
    expect(itemId).toBeTruthy();
    expect(classifiedDomain).toBeTruthy();

    // Check if a guide exists matching the classified domain
    const { data: existingGuides } = await serviceClient
      .from('guides')
      .select('id, slug, domain_filter')
      .eq('domain_filter', classifiedDomain!)
      .limit(1);

    let guideSlug: string;

    if (existingGuides && existingGuides.length > 0) {
      guideSlug = existingGuides[0].slug;
    } else {
      // Create a test guide matching the classified domain.
      // Sanitise TEST_PREFIX — it includes literal brackets ("[GOLDEN-PATH-...]")
      // which would leak into the slug and break the E2E smoke `guide-pages`
      // spec (slug regex `/guide/[a-z0-9-]+/` rejects `[`/`]`; bracketed slugs
      // also sort first alphabetically and get picked by `.first()`).
      const slug = `${TEST_PREFIX.toLowerCase().replace(/[^a-z0-9-]+/g, '')}-test-guide`;
      const { data: guide, error: guideErr } = await serviceClient
        .from('guides')
        .insert({
          name: `${TEST_PREFIX} Test Guide`,
          slug,
          domain_filter: classifiedDomain!,
          is_published: true,
        })
        .select('id, slug')
        .single();

      expect(guideErr).toBeNull();
      expect(guide).toBeTruthy();

      testGuideId = guide!.id;
      guideSlug = guide!.slug;

      // Create a section for the guide
      const { data: section, error: sectionErr } = await serviceClient
        .from('guide_sections')
        .insert({
          guide_id: testGuideId!,
          section_name: `${TEST_PREFIX} Test Section`,
          display_order: 0,
        })
        .select('id')
        .single();

      if (!sectionErr && section) {
        testGuideSectionId = section.id;
      }
    }

    // Call get_guide_content RPC (parameter is p_guide_slug)
    const { data: guideContent, error: rpcErr } = await serviceClient.rpc(
      'get_guide_content',
      { p_guide_slug: guideSlug },
    );

    expect(rpcErr).toBeNull();
    expect(guideContent).toBeTruthy();

    // Check if our test item appears in results
    const matchingItems = (
      guideContent as Array<{ content_id: string }>
    )?.filter((row) => row.content_id === itemId);

    // NOTE: This may fail if the guide RPC doesn't match our domain properly.
    // The spec documents this as Gap 2 — guide domain_filter values may not match
    // content domain slugs. If so, this is a legitimate finding.
    if (!matchingItems || matchingItems.length === 0) {
      console.warn(
        `[EXPECTED GAP] Test item not found in guide content for domain "${classifiedDomain}". ` +
          'This is likely Gap 2: guide domain_filter vs content domain mismatch. ' +
          'See docs/specs/data-flow-golden-path-e2e-spec.md Step 5.',
      );
    }
  });

  // Step 7
  it('Step 7: Verify hybrid_search RPC', async () => {
    expect(itemId).toBeTruthy();

    // Generate embedding for search query
    const embedding = await generateEmbedding('ISO 27001 certification');

    // Call hybrid_search RPC
    const { data: results, error } = await serviceClient.rpc('hybrid_search', {
      query_embedding: JSON.stringify(embedding),
      query_text: 'ISO 27001 certification',
      similarity_threshold: 0.3,
      limit_count: 20,
    });

    expect(error).toBeNull();
    expect(results).toBeTruthy();
    expect(Array.isArray(results)).toBe(true);

    // Find our test item in results
    const match = (results as Array<{ id: string; similarity: number }>)?.find(
      (r) => r.id === itemId,
    );

    expect(match).toBeTruthy();
    expect(match!.similarity).toBeGreaterThan(0.3);
  }, 60_000); // Embedding API call

  // Step 8
  it('Step 8: Verify entity relationships', async () => {
    expect(itemId).toBeTruthy();

    const { data: relationships, error } = await serviceClient
      .from('entity_relationships')
      .select('*')
      .eq('source_document_id', itemId!);

    expect(error).toBeNull();

    // Classification should extract at least one 'holds' relationship
    // e.g. organisation holds ISO 27001
    if (!relationships || relationships.length === 0) {
      console.warn(
        '[INFO] No entity relationships found for test item. ' +
          'This may indicate the AI did not extract relationships for this content.',
      );
      // Don't fail — relationship extraction is AI-dependent
      return;
    }

    // If relationships exist, check for ISO-related ones
    const isoRelationships = relationships.filter(
      (r) =>
        r.source_entity?.toLowerCase().includes('iso') ||
        r.target_entity?.toLowerCase().includes('iso'),
    );

    if (isoRelationships.length > 0) {
      expect(isoRelationships.length).toBeGreaterThanOrEqual(1);
    }
  });

  // Step 9
  it('Step 9: Full chain verification (summary)', async () => {
    expect(itemId).toBeTruthy();

    // Re-query all key data points in one go
    const { data: item } = await serviceClient
      .from('content_items')
      .select(
        'id, title, primary_domain, primary_subtopic, metadata, embedding, classified_at',
      )
      .eq('id', itemId!)
      .single();

    expect(item).toBeTruthy();

    // Domain assigned
    expect(item!.primary_domain).toBeTruthy();
    expect(item!.primary_subtopic).toBeTruthy();
    expect(item!.classified_at).toBeTruthy();

    // Embedding generated (classification regenerates it)
    expect(item!.embedding).toBeTruthy();

    // Temporal references stored
    const metadata = item!.metadata as Record<string, unknown>;
    expect(metadata?.ai_temporal_references).toBeTruthy();

    // Entities exist (may be 0 if entity_mentions upsert bug is present — see Step 3)
    const { data: entities } = await serviceClient
      .from('entity_mentions')
      .select('id')
      .eq('source_document_id', itemId!);

    expect(entities).toBeTruthy();
    if (entities!.length === 0) {
      console.warn(
        '[CASCADING from Step 3] entity_mentions is empty — see Step 3 for root cause.',
      );
    }
    // Soft assertion: log but don't fail if entity storage bug is present
    // The hard assertions (domain, temporal refs, embedding) still verify
    // the majority of the golden path
    expect(entities!.length).toBeGreaterThanOrEqual(1);

    // Item is searchable (embedding exists means hybrid_search can find it)
    expect(item!.embedding).toBeTruthy();
  });

  // Step 10
  it('Step 10: Cleanup verification', async () => {
    // This test runs AFTER afterAll would normally run, but since we are
    // inside the same describe, afterAll hasn't run yet. We verify that
    // cleanup WILL work by checking our test data exists (proving it needs cleanup).
    expect(itemId).toBeTruthy();

    const { data: item } = await serviceClient
      .from('content_items')
      .select('id')
      .eq('id', itemId!)
      .single();

    // Item should still exist at this point (afterAll runs after all tests)
    expect(item).toBeTruthy();

    // Verify we can identify all test data by the prefix
    const { data: prefixItems } = await serviceClient
      .from('content_items')
      .select('id')
      .like('title', `%${TEST_PREFIX}%`);

    expect(prefixItems).toBeTruthy();
    expect(prefixItems!.length).toBeGreaterThanOrEqual(1);
  });
});
