/**
 * Certification Bridge Flow — Real DB Integration Tests
 *
 * Replaces the T2.3b, T2.4b, T2.5b it.todo stubs from
 * classification-entity-certification-flow.test.ts with real DB tests.
 *
 * Tests the bridge function that populates entity_mentions.metadata with
 * expiry dates from temporal references, then verifies certification status
 * derivation works correctly against real DB data.
 *
 * Prerequisites:
 *   - .env with NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
 *   - Run: bun run test:integration
 *
 * @vitest-environment node
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { serviceClient } from './helpers/service-client';
import { bridgeTemporalReferencesToEntities } from '@/lib/entities/entity-metadata-bridge';
import {
  deriveExpiryStatus,
  type ExpiryStatus,
} from '@/lib/certification-status';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_PREFIX = `[CERT-BRIDGE-${Date.now()}]`;

// Future date for "valid" status — well beyond 30 days from now
const FUTURE_EXPIRY_DATE = '2029-06-15';
// Past date for "expired" status
const PAST_EXPIRY_DATE = '2023-01-01';

// ---------------------------------------------------------------------------
// Shared state across sequential tests
// ---------------------------------------------------------------------------

const createdItemIds: string[] = [];
const createdSourceDocumentIds: string[] = [];
const createdEntityMentionIds: string[] = [];

/**
 * content_items.id -> its linked source_documents.id (ID-131.26). The
 * bridge — and entity_mentions/entity_relationships in general — are keyed
 * off source_document_id, NOT content_items.id (M2 rename), so every
 * fixture content item in this suite needs a real linked source_documents
 * row for `bridgeTemporalReferencesToEntities` to find any rows to bridge.
 */
const sourceDocumentIdByItemId = new Map<string, string>();

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(async () => {
  try {
    // Delete entity mentions first (FK to source_documents)
    if (createdEntityMentionIds.length > 0) {
      await serviceClient
        .from('entity_mentions')
        .delete()
        .in('id', createdEntityMentionIds);
    }

    // Also clean any entity mentions not individually tracked (e.g. created
    // by the bridge itself), scoped by the linked source_document_id.
    if (createdSourceDocumentIds.length > 0) {
      await serviceClient
        .from('entity_mentions')
        .delete()
        .in('source_document_id', createdSourceDocumentIds);
    }

    for (const itemId of createdItemIds) {
      await serviceClient.from('content_items').delete().eq('id', itemId);
    }

    if (createdSourceDocumentIds.length > 0) {
      await serviceClient
        .from('source_documents')
        .delete()
        .in('id', createdSourceDocumentIds);
    }
  } catch (err) {
    console.error('Cleanup failed:', err);
  }
});

// ---------------------------------------------------------------------------
// Helper: create a content item with temporal references in metadata,
// linked to a real source_documents row (ID-131.26 — entity_mentions is
// keyed off source_document_id, not content_items.id).
// ---------------------------------------------------------------------------

async function createContentItemWithTemporalRefs(
  title: string,
  temporalRefs: Array<{
    date: string;
    context: string;
    context_type: string;
    /**
     * Canonical name of the entity this temporal reference relates to.
     * Populated by Claude during co-extraction (see
     * `.planning/.archive/.specs/temporal-entity-co-extraction-spec.md`)
     * and used by the bridge as the authoritative match. Realistic
     * post-co-extraction fixtures should always set this where the
     * reference clearly belongs to a single entity.
     */
    related_entity?: string;
  }>,
): Promise<string> {
  const { data: sourceDoc, error: sourceDocError } = await serviceClient
    .from('source_documents')
    .insert({
      filename: `${TEST_PREFIX} ${title}.txt`,
      mime_type: 'text/plain',
      file_size: 1,
      content_hash: `${TEST_PREFIX}-${title}`,
      storage_path: `test-fixtures/${TEST_PREFIX}/${title}.txt`,
      status: 'processed',
    })
    .select('id')
    .single();

  if (sourceDocError)
    throw new Error(
      `Failed to create source document: ${sourceDocError.message}`,
    );
  createdSourceDocumentIds.push(sourceDoc!.id);

  const { data, error } = await serviceClient
    .from('content_items')
    .insert({
      title: `${TEST_PREFIX} ${title}`,
      content: `${TEST_PREFIX} Test content for ${title}`,
      content_type: 'policy',
      platform: 'manual',
      source_document_id: sourceDoc!.id,
      metadata: {
        ai_temporal_references: temporalRefs,
      },
    })
    .select('id')
    .single();

  if (error) throw new Error(`Failed to create content item: ${error.message}`);
  createdItemIds.push(data!.id);
  sourceDocumentIdByItemId.set(data!.id, sourceDoc!.id);
  return data!.id;
}

// ---------------------------------------------------------------------------
// Helper: create an entity mention for a content item
// ---------------------------------------------------------------------------

async function createEntityMention(
  contentItemId: string,
  canonicalName: string,
  entityType: string,
  contextSnippet?: string,
): Promise<string> {
  // entity_mentions.source_document_id is an FK to source_documents, NOT
  // content_items (ID-131 M2 / ID-131.26) — resolve via the map populated
  // by createContentItemWithTemporalRefs.
  const sourceDocumentId = sourceDocumentIdByItemId.get(contentItemId);
  if (!sourceDocumentId) {
    throw new Error(
      `createEntityMention: no linked source_document_id for content item ${contentItemId} — call createContentItemWithTemporalRefs first`,
    );
  }

  const { data, error } = await serviceClient
    .from('entity_mentions')
    .insert({
      source_document_id: sourceDocumentId,
      entity_name: canonicalName,
      canonical_name: canonicalName.toLowerCase(),
      entity_type: entityType,
      confidence: 0.95,
      context_snippet: contextSnippet ?? `Mention of ${canonicalName}`,
      metadata: {},
    })
    .select('id')
    .single();

  if (error)
    throw new Error(`Failed to create entity mention: ${error.message}`);
  createdEntityMentionIds.push(data!.id);
  return data!.id;
}

// ---------------------------------------------------------------------------
// Sequential test suite
// ---------------------------------------------------------------------------

describe('Certification Bridge Flow — Real DB Integration', () => {
  // Pin Date.now() to 2026-06-15T12:00:00Z — mid-year, well away from all
  // test expiry dates (2023, 2024, 2025, 2027, 2029). Prevents boundary
  // flakiness if tests run near year-end or month-end.
  beforeAll(() => {
    vi.spyOn(Date, 'now').mockReturnValue(
      new Date('2026-06-15T12:00:00Z').getTime(),
    );
  });

  afterAll(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // T2.3b: After bridge populates entity metadata, verify expiry_status
  // is derived correctly (not "unknown").
  //
  // Design decision: This test verifies data correctness end-to-end against
  // a real DB — the bridge populates metadata, and deriveExpiryStatus returns
  // the correct status from that metadata. The API route handler layer
  // (GET /api/certifications) is separately tested in
  // __tests__/api/certifications.test.ts with mock data. Combined coverage
  // is adequate: this test covers data correctness, the API test covers
  // route wiring. Testing the API route against a real DB would require
  // standing up Next.js route handlers in the integration test environment,
  // which is out of scope for this test infrastructure.
  // ---------------------------------------------------------------------------
  it('T2.3b: bridge populates expiry_date and deriveExpiryStatus returns correct status', async () => {
    // 1. Create content item with ISO 27001 expiry temporal reference
    const itemId = await createContentItemWithTemporalRefs(
      'ISO 27001 Certification Status',
      [
        {
          date: FUTURE_EXPIRY_DATE,
          context: 'ISO 27001 certification valid until this date',
          context_type: 'expiry',
        },
      ],
    );

    // 2. Create certification entity mention
    const mentionId = await createEntityMention(
      itemId,
      'ISO 27001',
      'certification',
      'Our organisation holds ISO 27001 certification',
    );

    // 3. Run bridge function
    await bridgeTemporalReferencesToEntities(serviceClient, itemId);

    // 4. Re-query the entity mention to check metadata was populated
    const { data: updatedMention, error } = await serviceClient
      .from('entity_mentions')
      .select('metadata')
      .eq('id', mentionId)
      .single();

    expect(error).toBeNull();
    expect(updatedMention).toBeTruthy();

    const metadata = updatedMention!.metadata as Record<string, unknown>;
    expect(metadata.expiry_date).toBe(FUTURE_EXPIRY_DATE);

    // 5. Derive expiry status — should be "valid" (well in the future)
    const status: ExpiryStatus = deriveExpiryStatus(
      metadata.expiry_date as string,
    );
    expect(status).toBe('valid');
    expect(status).not.toBe('unknown');

    // 6. Explicit DB-to-status derivation: query entity_mentions directly,
    //    extract the expiry_date from metadata, and pass it through
    //    deriveExpiryStatus to make the full data-to-status pipeline visible.
    const { data: dbMentions, error: dbError } = await serviceClient
      .from('entity_mentions')
      .select('entity_name, entity_type, metadata')
      .eq('source_document_id', sourceDocumentIdByItemId.get(itemId)!)
      .eq('entity_type', 'certification');

    expect(dbError).toBeNull();
    expect(dbMentions).toBeTruthy();
    expect(dbMentions!.length).toBeGreaterThanOrEqual(1);

    for (const mention of dbMentions!) {
      const mentionMeta = mention.metadata as Record<string, unknown>;
      if (mentionMeta.expiry_date) {
        const derivedStatus = deriveExpiryStatus(
          mentionMeta.expiry_date as string,
        );
        expect(['valid', 'expiring_soon', 'expired']).toContain(derivedStatus);
        expect(derivedStatus).not.toBe('unknown');
      }
    }
  });

  // T2.4b: Create multiple certification entities with different temporal
  // references, run bridge, verify each has correct metadata and expiry_status.
  //
  // Note: Fixture refs set `related_entity` to match production data shape
  // after co-extraction (commit 39b6556b added this field to the classifier
  // output; the bridge uses it as the authoritative link). Without
  // `related_entity`, tokenMatch's 2-token short-name rule would false-match
  // ISO 27001's temporal ref to the ISO 9001 entity (both share the "iso"
  // token → 0.5 coverage → 0.6 confidence).
  it('T2.4b: multiple certification entities get correct metadata and expiry_status', async () => {
    // 1. Create content item with temporal references for multiple certifications
    const itemId = await createContentItemWithTemporalRefs(
      'Multiple Certifications',
      [
        {
          date: FUTURE_EXPIRY_DATE,
          context: 'ISO 27001 certification valid until this date',
          context_type: 'expiry',
          related_entity: 'ISO 27001',
        },
        {
          date: PAST_EXPIRY_DATE,
          context: 'Cyber Essentials Plus expired on this date',
          context_type: 'expiry',
          related_entity: 'Cyber Essentials Plus',
        },
        {
          date: '2024-06-01',
          context: 'ISO 9001 certification obtained on this date',
          context_type: 'effective',
          related_entity: 'ISO 9001',
        },
      ],
    );

    // 2. Create three certification entity mentions
    const iso27001Id = await createEntityMention(
      itemId,
      'ISO 27001',
      'certification',
      'ISO 27001 information security certification',
    );

    const cyberEssentialsId = await createEntityMention(
      itemId,
      'Cyber Essentials Plus',
      'certification',
      'Cyber Essentials Plus government-backed scheme',
    );

    const iso9001Id = await createEntityMention(
      itemId,
      'ISO 9001',
      'certification',
      'ISO 9001 quality management system',
    );

    // 3. Run bridge function
    await bridgeTemporalReferencesToEntities(serviceClient, itemId);

    // 4. Re-query all entity mentions
    const { data: mentions, error } = await serviceClient
      .from('entity_mentions')
      .select('id, canonical_name, metadata')
      .in('id', [iso27001Id, cyberEssentialsId, iso9001Id]);

    expect(error).toBeNull();
    expect(mentions).toBeTruthy();
    expect(mentions!.length).toBe(3);

    // 5. Verify ISO 27001 — should have expiry_date = FUTURE_EXPIRY_DATE, status = "valid"
    const iso27001 = mentions!.find((m) => m.canonical_name === 'iso 27001');
    expect(iso27001).toBeTruthy();
    const iso27001Meta = iso27001!.metadata as Record<string, unknown>;
    expect(iso27001Meta.expiry_date).toBe(FUTURE_EXPIRY_DATE);
    expect(deriveExpiryStatus(iso27001Meta.expiry_date as string)).toBe(
      'valid',
    );

    // 6. Verify Cyber Essentials Plus — should have expiry_date = PAST_EXPIRY_DATE, status = "expired"
    const cyberEssentials = mentions!.find(
      (m) => m.canonical_name === 'cyber essentials plus',
    );
    expect(cyberEssentials).toBeTruthy();
    const cyberMeta = cyberEssentials!.metadata as Record<string, unknown>;
    expect(cyberMeta.expiry_date).toBe(PAST_EXPIRY_DATE);
    expect(deriveExpiryStatus(cyberMeta.expiry_date as string)).toBe('expired');

    // 7. Verify ISO 9001 — should have date_obtained (effective type), no expiry_date
    const iso9001 = mentions!.find((m) => m.canonical_name === 'iso 9001');
    expect(iso9001).toBeTruthy();
    const iso9001Meta = iso9001!.metadata as Record<string, unknown>;
    expect(iso9001Meta.date_obtained).toBe('2024-06-01');
    // No expiry date set, so status should be "unknown"
    expect(
      deriveExpiryStatus(iso9001Meta.expiry_date as string | undefined),
    ).toBe('unknown');
  });

  // T2.5b: Create item with temporal references, bridge them, then update
  // temporal references (simulating reclassification) and re-bridge, verify
  // old dates are replaced.
  it('T2.5b: reclassification replaces old temporal references after re-bridge', async () => {
    // 1. Create content item with initial temporal reference
    const itemId = await createContentItemWithTemporalRefs(
      'ISO 27001 Reclassification Test',
      [
        {
          date: '2025-06-30',
          context: 'ISO 27001 certification expires June 2025',
          context_type: 'expiry',
        },
      ],
    );

    // 2. Create certification entity mention
    const mentionId = await createEntityMention(
      itemId,
      'ISO 27001',
      'certification',
      'ISO 27001 information security management',
    );

    // 3. Run bridge — should set expiry_date to 2025-06-30
    await bridgeTemporalReferencesToEntities(serviceClient, itemId);

    // 4. Verify initial bridge result
    const { data: firstBridge } = await serviceClient
      .from('entity_mentions')
      .select('metadata')
      .eq('id', mentionId)
      .single();

    const firstMeta = firstBridge!.metadata as Record<string, unknown>;
    expect(firstMeta.expiry_date).toBe('2025-06-30');

    // 5. Simulate reclassification: update temporal references in metadata
    //    (this is what classifyContent does when force=true)
    const { error: updateError } = await serviceClient
      .from('content_items')
      .update({
        metadata: {
          ai_temporal_references: [
            {
              date: '2027-12-31',
              context: 'ISO 27001 certification renewed until December 2027',
              context_type: 'expiry',
            },
          ],
        },
      })
      .eq('id', itemId);

    expect(updateError).toBeNull();

    // 6. Re-run bridge (simulating post-reclassification bridge call)
    await bridgeTemporalReferencesToEntities(serviceClient, itemId);

    // 7. Verify the entity metadata was REPLACED with new date
    const { data: secondBridge } = await serviceClient
      .from('entity_mentions')
      .select('metadata')
      .eq('id', mentionId)
      .single();

    const secondMeta = secondBridge!.metadata as Record<string, unknown>;
    expect(secondMeta.expiry_date).toBe('2027-12-31');
    // Old date must not be present
    expect(secondMeta.expiry_date).not.toBe('2025-06-30');

    // 8. Verify derived status reflects the new date
    const status = deriveExpiryStatus(secondMeta.expiry_date as string);
    expect(status).toBe('valid'); // 2027-12-31 is well in the future
  });
});
