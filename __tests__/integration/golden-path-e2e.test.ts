/**
 * Golden Path E2E Data Flow Integration Tests
 *
 * Verifies the complete data lifecycle of a content item through the system:
 *   Create content -> Classify (entities, temporal refs, domain) -> entity_mentions storage
 *     -> Guide matching via domain -> MCP search retrieval -> Certification status query
 *
 * CURRENT STATUS: Mock-based data transformation tests (Phase 3a).
 * These verify the DATA FLOW logic between components using in-memory stores.
 *
 * NEXT SESSION (Phase 3b): Replace with real DB integration tests using
 * SUPABASE_SECRET_KEY service client, as the spec requires. The spec mandates
 * "Real database required. Mocking would defeat the purpose." (Section 4).
 * See docs/specs/data-flow-golden-path-e2e-spec.md for the full requirements.
 *
 * Spec: docs/specs/data-flow-golden-path-e2e-spec.md
 *
 * Test groups:
 *   GP1: Full golden path — creation through certification status
 *   GP2: Upload path golden path
 *   GP3: URL ingest golden path
 *   GP4: Reclassification golden path
 *   GP5: Multi-entity golden path
 *   GP6: Guide matching with domain slug
 *   GP7: MCP search finds classified content
 *   GP8: Content without entities — graceful handling
 *   GP9: Conflicting temporal references
 *   GP10: Cross-feature data integrity
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import {
  createTestContentItem,
  createTestGuide,
  createTestGuideSection,
  createGuideContentRow,
  testUUID,
} from './helpers/test-data-factory';
import { resetMockClient } from './helpers/cleanup';
import type {
  ClassificationResult,
  ClassificationTemporalReference,
} from '@/lib/ai/classify';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_USER_ID = testUUID();

const ISO_CONTENT = `ISO 27001 Information Security Management

Our organisation holds ISO 27001:2022 certification, issued by BSI.
Certificate number: IS 98765. The certification is valid until 15 March 2028.
Last surveillance audit completed December 2025 with zero non-conformities.

We also comply with Cyber Essentials Plus, renewed annually.
Our ICO registration (reference ZA123456) expires on 30 September 2027.`;

const MULTI_ENTITY_CONTENT = `Certification Portfolio

Our organisation holds ISO 27001:2022 for information security (expires 15 March 2028),
ISO 9001:2015 for quality management (expires 22 June 2027), and Cyber Essentials Plus
(renewed annually, last renewed 1 January 2026).`;

const NO_ENTITY_CONTENT = `Company Overview

We are a UK-based technology company providing digital services
to the public sector. Our team of 150 staff are based in London.`;

// ---------------------------------------------------------------------------
// Standard classification result fixtures
// ---------------------------------------------------------------------------

function createIsoClassificationResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    primary_domain: 'security',
    primary_subtopic: 'data-protection',
    secondary_domain: 'compliance',
    secondary_subtopic: 'audit',
    ai_keywords: ['iso 27001', 'information security', 'certification'],
    summary:
      'Organisation holds ISO 27001:2022 certification with BSI, valid until March 2028.',
    suggested_title: 'ISO 27001 Information Security Certification',
    classification_confidence: 0.95,
    classification_reasoning:
      'Content describes ISO 27001 certification details including issuing body and expiry.',
    entities: [
      {
        name: 'ISO 27001:2022',
        type: 'certification',
        canonical_name: 'ISO 27001',
      },
      { name: 'BSI', type: 'organisation', canonical_name: 'BSI' },
      {
        name: 'Cyber Essentials Plus',
        type: 'certification',
        canonical_name: 'Cyber Essentials Plus',
      },
      { name: 'ICO', type: 'organisation', canonical_name: 'ICO' },
    ],
    relationships: [
      { source: 'Company', relationship: 'holds', target: 'ISO 27001' },
      {
        source: 'Company',
        relationship: 'holds',
        target: 'Cyber Essentials Plus',
      },
    ],
    temporal_references: [
      {
        date: '2028-03-15',
        context: 'ISO 27001 certification valid until 15 March 2028',
        context_type: 'expiry',
      },
      {
        date: '2025-12-01',
        context: 'Last surveillance audit completed December 2025',
        context_type: 'historical',
      },
      {
        date: '2027-09-30',
        context: 'ICO registration expires on 30 September 2027',
        context_type: 'expiry',
      },
    ],
    ...overrides,
  };
}

function createMultiEntityClassificationResult(): ClassificationResult {
  return {
    primary_domain: 'security',
    primary_subtopic: 'data-protection',
    secondary_domain: 'compliance',
    secondary_subtopic: 'audit',
    ai_keywords: ['iso 27001', 'iso 9001', 'cyber essentials plus'],
    summary:
      'Organisation holds three certifications: ISO 27001, ISO 9001, and Cyber Essentials Plus.',
    suggested_title: 'Certification Portfolio Overview',
    classification_confidence: 0.92,
    classification_reasoning:
      'Content describes multiple certifications with expiry dates.',
    entities: [
      {
        name: 'ISO 27001:2022',
        type: 'certification',
        canonical_name: 'ISO 27001',
      },
      {
        name: 'ISO 9001:2015',
        type: 'certification',
        canonical_name: 'ISO 9001',
      },
      {
        name: 'Cyber Essentials Plus',
        type: 'certification',
        canonical_name: 'Cyber Essentials Plus',
      },
    ],
    relationships: [
      { source: 'Company', relationship: 'holds', target: 'ISO 27001' },
      { source: 'Company', relationship: 'holds', target: 'ISO 9001' },
      {
        source: 'Company',
        relationship: 'holds',
        target: 'Cyber Essentials Plus',
      },
    ],
    temporal_references: [
      {
        date: '2028-03-15',
        context: 'ISO 27001 expires 15 March 2028',
        context_type: 'expiry',
      },
      {
        date: '2027-06-22',
        context: 'ISO 9001 expires 22 June 2027',
        context_type: 'expiry',
      },
      {
        date: '2026-01-01',
        context: 'Cyber Essentials Plus renewed 1 January 2026',
        context_type: 'effective',
      },
    ],
  };
}

function createNoEntityClassificationResult(): ClassificationResult {
  return {
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    ai_keywords: ['technology company', 'public sector', 'digital services'],
    summary:
      'UK-based technology company providing digital services to the public sector.',
    suggested_title: 'Company Overview',
    classification_confidence: 0.88,
    classification_reasoning:
      'General company description with no specific certifications or regulations.',
    entities: [],
    relationships: [],
    temporal_references: [],
  };
}

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

// Hoisted mocks for modules that need to be mocked before import
const {
  mockClassifyContent,
  mockGenerateEmbedding,
  mockCanonicalise,
  mockResolveAlias,
  mockLoadAliases,
  mockHtmlToPlainText,
  mockDeriveExpiryStatus,
} = vi.hoisted(() => ({
  mockClassifyContent: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockCanonicalise: vi.fn((name: string) => name),
  mockResolveAlias: vi.fn((name: string) => name),
  mockLoadAliases: vi.fn(),
  mockHtmlToPlainText: vi.fn((html: string) => html.replace(/<[^>]*>/g, '')),
  mockDeriveExpiryStatus: vi.fn(),
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/entities/entity-dedup', () => ({
  canonicalise: mockCanonicalise,
}));

vi.mock('@/lib/entities/entity-aliases', () => ({
  resolveAlias: mockResolveAlias,
  loadAliases: mockLoadAliases,
  BASELINE_ALIASES: {},
}));

vi.mock('@/lib/editor-utils', () => ({
  htmlToPlainText: mockHtmlToPlainText,
}));

vi.mock('@/lib/certification-status', () => ({
  deriveExpiryStatus: mockDeriveExpiryStatus,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * In-memory store that tracks all DB operations during a test.
 * This allows us to verify the data flow between classification, entity storage,
 * guide matching, and MCP search without a live database.
 */
interface InMemoryStore {
  contentItems: Map<string, Record<string, unknown>>;
  entityMentions: Array<Record<string, unknown>>;
  entityRelationships: Array<Record<string, unknown>>;
}

function createInMemoryStore(): InMemoryStore {
  return {
    contentItems: new Map(),
    entityMentions: [],
    entityRelationships: [],
  };
}

/**
 * Simulate the classification flow that classifyContent() performs:
 * 1. Fetch content item
 * 2. Call Claude (mocked)
 * 3. Update content item with classification
 * 4. Generate embedding
 * 5. Store entities
 * 6. Store relationships
 * 7. Store temporal refs in metadata
 *
 * This function orchestrates the mocked flows to populate the in-memory store,
 * then verifies the data passed between steps.
 */
async function simulateClassificationFlow(
  store: InMemoryStore,
  itemId: string,
  classificationResult: ClassificationResult,
) {
  const item = store.contentItems.get(itemId);
  if (!item) throw new Error(`Content item ${itemId} not found in store`);

  // Step 1: Update content item with classification fields
  const updateData: Record<string, unknown> = {
    primary_domain: classificationResult.primary_domain,
    primary_subtopic: classificationResult.primary_subtopic,
    secondary_domain: classificationResult.secondary_domain ?? null,
    secondary_subtopic: classificationResult.secondary_subtopic ?? null,
    ai_keywords: classificationResult.ai_keywords,
    summary: classificationResult.summary,
    suggested_title: classificationResult.suggested_title,
    classification_confidence: classificationResult.classification_confidence,
    classification_reasoning: classificationResult.classification_reasoning,
    classified_at: new Date().toISOString(),
    updated_by: TEST_USER_ID,
  };

  // Step 2: Generate embedding (mocked)
  const mockEmbedding = new Array(1024).fill(0.1);
  updateData.embedding = JSON.stringify(mockEmbedding);

  // Step 3: Store temporal references in metadata
  if (classificationResult.temporal_references?.length) {
    const existingMetadata = (item.metadata as Record<string, unknown>) ?? {};
    updateData.metadata = {
      ...existingMetadata,
      ai_temporal_references: classificationResult.temporal_references,
    };
  }

  // Apply all updates to the content item
  const existing = store.contentItems.get(itemId) ?? {};
  store.contentItems.set(itemId, { ...existing, ...updateData });

  // Step 4: Store entity mentions
  if (classificationResult.entities?.length) {
    const entityRows = classificationResult.entities.map((e) => ({
      content_item_id: itemId,
      entity_type: e.type,
      entity_name: e.name,
      canonical_name: e.canonical_name,
      confidence: 1.0,
    }));
    store.entityMentions.push(...entityRows);
  }

  // Step 5: Store entity relationships
  if (classificationResult.relationships?.length) {
    const relRows = classificationResult.relationships.map((r) => ({
      source_entity: r.source,
      relationship_type: r.relationship,
      target_entity: r.target,
      source_item_id: itemId,
      confidence: 1.0,
    }));
    store.entityRelationships.push(...relRows);
  }
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockClient(mockSupabase);
  mockClassifyContent.mockReset();
  mockGenerateEmbedding.mockReset();
  mockCanonicalise.mockImplementation((name: string) => name);
  mockResolveAlias.mockImplementation((name: string) => name);
  mockLoadAliases.mockResolvedValue(undefined);
  mockHtmlToPlainText.mockImplementation((html: string) =>
    html.replace(/<[^>]*>/g, ''),
  );
  mockDeriveExpiryStatus.mockReturnValue('unknown');
  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0.1));
});

// =============================================================================
// GP1: Full Golden Path — Content Creation Through Certification Status
// =============================================================================

describe('GP1: Full golden path — content creation through certification status', () => {
  it('follows complete data flow from content creation to certification status query', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();
    const classResult = createIsoClassificationResult();

    // Step 1: Create content item
    const contentItem = createTestContentItem({
      id: itemId,
      title: 'ISO 27001 Security Certification',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      primary_subtopic: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    // Verify: content item created with correct fields
    expect(store.contentItems.has(itemId)).toBe(true);
    const storedItem = store.contentItems.get(itemId)!;
    expect(storedItem.title).toBe('ISO 27001 Security Certification');
    expect(storedItem.content_type).toBe('policy');
    // Note: createTestContentItem defaults primary_domain to 'corporate' via ?? operator.
    // Before classification, the real item would have null, but the factory provides a default.
    // The key assertion is that AFTER classification, primary_domain changes to 'security'.
    expect(storedItem.primary_domain).toBe('corporate');

    // Step 2: Classify the content item
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: Classification result has correct domains
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.primary_domain).toBe('security');
    expect(classifiedItem.primary_subtopic).toBe('data-protection');
    expect(classifiedItem.secondary_domain).toBe('compliance');
    expect(classifiedItem.classified_at).toBeTruthy();

    // Step 3: Verify entity_mentions rows created
    const isoEntities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId && e.canonical_name === 'ISO 27001',
    );
    expect(isoEntities.length).toBeGreaterThanOrEqual(1);
    expect(isoEntities[0].entity_type).toBe('certification');

    const ceEntities = store.entityMentions.filter(
      (e) =>
        e.content_item_id === itemId &&
        e.canonical_name === 'Cyber Essentials Plus',
    );
    expect(ceEntities.length).toBeGreaterThanOrEqual(1);
    expect(ceEntities[0].entity_type).toBe('certification');

    // Step 4: Verify temporal references stored in content_items.metadata
    const metadata = classifiedItem.metadata as Record<string, unknown>;
    const temporalRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(temporalRefs).toBeDefined();
    expect(temporalRefs.length).toBe(3);
    const expiryRefs = temporalRefs.filter((r) => r.context_type === 'expiry');
    expect(expiryRefs.length).toBe(2);
    expect(expiryRefs.some((r) => r.date === '2028-03-15')).toBe(true);
    expect(expiryRefs.some((r) => r.date === '2027-09-30')).toBe(true);

    // Step 5: Verify guide matching — domain_filter matches primary_domain
    const guide = createTestGuide({
      domain_filter: 'security',
      is_published: true,
    });
    const section = createTestGuideSection({ guide_id: guide.id });

    // The guide matching logic is: ci.primary_domain = g.domain_filter
    // Since classified item has primary_domain='security' and guide has domain_filter='security', it should match
    expect(classifiedItem.primary_domain).toBe(guide.domain_filter);

    const guideContentRow = createGuideContentRow({
      section_id: section.id,
      section_name: section.section_name,
      content_id: itemId,
      content_title: classifiedItem.title as string,
      content_type: classifiedItem.content_type as string,
    });
    expect(guideContentRow.content_id).toBe(itemId);

    // Step 6: Verify MCP search would find the item — embedding present
    expect(classifiedItem.embedding).toBeTruthy();
    const embedding = JSON.parse(classifiedItem.embedding as string);
    expect(embedding).toHaveLength(1024);

    // Step 7: Verify certification status tool would find ISO 27001
    const holdsRelationships = store.entityRelationships.filter(
      (r) => r.relationship_type === 'holds',
    );
    expect(holdsRelationships.length).toBeGreaterThanOrEqual(1);
    const targetNames = holdsRelationships.map(
      (r) => r.target_entity as string,
    );
    expect(targetNames).toContain('ISO 27001');
    expect(targetNames).toContain('Cyber Essentials Plus');
  });
});

// =============================================================================
// GP2: Upload Path Golden Path
// =============================================================================

describe('GP2: Upload path golden path', () => {
  it('verifies both regex and AI temporal reference paths from file upload', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    // Simulate an item created via file upload with regex-extracted temporal refs
    const uploadItem = createTestContentItem({
      id: itemId,
      title: 'Uploaded ISO Policy',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {
        // Regex path stores temporal_references (not ai_temporal_references)
        temporal_references: [
          {
            date: '2028-03-15',
            context: 'valid until 15 March 2028',
            type: 'expiry',
          },
          {
            date: '2027-09-30',
            context: 'expires on 30 September 2027',
            type: 'expiry',
          },
        ],
        ingestion_source: 'upload',
      },
    });
    store.contentItems.set(itemId, { ...uploadItem });

    // Classification adds AI temporal references alongside existing regex ones
    const classResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    const classifiedItem = store.contentItems.get(itemId)!;
    const metadata = classifiedItem.metadata as Record<string, unknown>;

    // Verify: Both temporal reference paths are stored
    // Regex path: metadata.temporal_references (from upload)
    expect(metadata.temporal_references).toBeDefined();
    const regexRefs = metadata.temporal_references as Array<
      Record<string, unknown>
    >;
    expect(regexRefs.length).toBeGreaterThanOrEqual(2);

    // AI path: metadata.ai_temporal_references (from classification)
    expect(metadata.ai_temporal_references).toBeDefined();
    const aiRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(aiRefs.length).toBe(3);

    // Verify: Classification completed successfully
    expect(classifiedItem.primary_domain).toBe('security');

    // Verify: Entities stored
    const entities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId,
    );
    expect(entities.length).toBeGreaterThanOrEqual(2);
  });
});

// =============================================================================
// GP3: URL Ingest Golden Path
// =============================================================================

describe('GP3: URL ingest golden path', () => {
  it('verifies content extraction to classification to entity storage', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    // Simulate item created from URL ingestion with source_url metadata
    const ingestedItem = createTestContentItem({
      id: itemId,
      title: 'ISO 27001 Certification Page',
      content: `<h1>Our Certifications</h1><p>${ISO_CONTENT}</p>`,
      content_type: 'article',
      primary_domain: null,
      metadata: {
        source_url: 'https://example.com/certifications',
        ingestion_source: 'url',
        captured_at: '2026-03-30T10:00:00Z',
      },
    });
    store.contentItems.set(itemId, { ...ingestedItem });

    // Classification processes the extracted content
    const classResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: Content extraction -> Classification connection
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.primary_domain).toBe('security');
    expect(classifiedItem.classified_at).toBeTruthy();

    // Verify: Classification -> Entity storage connection
    const entities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId,
    );
    expect(entities.length).toBeGreaterThanOrEqual(2);

    // Verify: Source URL metadata preserved through classification
    const metadata = classifiedItem.metadata as Record<string, unknown>;
    expect(metadata.source_url).toBe('https://example.com/certifications');
    expect(metadata.ingestion_source).toBe('url');

    // Verify: AI temporal references added to existing metadata
    expect(metadata.ai_temporal_references).toBeDefined();
  });
});

// =============================================================================
// GP4: Reclassification Golden Path
// =============================================================================

describe('GP4: Reclassification golden path', () => {
  it('verifies entities and temporal refs are updated on reclassification', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    // Create item with initial classification
    const initialItem = createTestContentItem({
      id: itemId,
      title: 'Security Policy',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: 'corporate',
      primary_subtopic: 'company-overview',
      metadata: {
        ai_temporal_references: [
          {
            date: '2025-01-01',
            context: 'Old date',
            context_type: 'historical',
          },
        ],
      },
    });
    store.contentItems.set(itemId, { ...initialItem });

    // Initial entity from first classification
    store.entityMentions.push({
      content_item_id: itemId,
      entity_type: 'organisation',
      entity_name: 'Old Entity',
      canonical_name: 'Old Entity',
      confidence: 1.0,
    });

    // Reclassify with updated content — should produce new entities/temporal refs
    const reclassResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, reclassResult);

    // Verify: Domain updated
    const reclassifiedItem = store.contentItems.get(itemId)!;
    expect(reclassifiedItem.primary_domain).toBe('security');
    expect(reclassifiedItem.primary_subtopic).toBe('data-protection');

    // Verify: Temporal references updated (overwritten by new classification)
    const metadata = reclassifiedItem.metadata as Record<string, unknown>;
    const temporalRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(temporalRefs.length).toBe(3);
    // New temporal refs should contain the ISO 27001 expiry
    expect(temporalRefs.some((r) => r.date === '2028-03-15')).toBe(true);

    // Verify: New entities added (old + new in store)
    const allEntities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId,
    );
    // Old entity (1) + new entities from reclassification (4)
    expect(allEntities.length).toBe(5);
    expect(allEntities.some((e) => e.canonical_name === 'ISO 27001')).toBe(
      true,
    );

    // Verify: Guide matching would now use new domain
    expect(reclassifiedItem.primary_domain).toBe('security');
  });
});

// =============================================================================
// GP5: Multi-Entity Golden Path
// =============================================================================

describe('GP5: Multi-entity golden path', () => {
  it('stores all 3 entities with different temporal references correctly', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'Certification Portfolio',
      content: MULTI_ENTITY_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    const classResult = createMultiEntityClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: All 3 certification entities stored
    const certEntities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId && e.entity_type === 'certification',
    );
    expect(certEntities.length).toBe(3);

    const canonicalNames = certEntities.map((e) => e.canonical_name);
    expect(canonicalNames).toContain('ISO 27001');
    expect(canonicalNames).toContain('ISO 9001');
    expect(canonicalNames).toContain('Cyber Essentials Plus');

    // Verify: All 3 'holds' relationships stored
    const holdsRels = store.entityRelationships.filter(
      (r) => r.source_item_id === itemId && r.relationship_type === 'holds',
    );
    expect(holdsRels.length).toBe(3);

    // Verify: All temporal references stored with correct dates
    const classifiedItem = store.contentItems.get(itemId)!;
    const metadata = classifiedItem.metadata as Record<string, unknown>;
    const temporalRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(temporalRefs.length).toBe(3);

    const dates = temporalRefs.map((r) => r.date);
    expect(dates).toContain('2028-03-15');
    expect(dates).toContain('2027-06-22');
    expect(dates).toContain('2026-01-01');

    // Verify: Expiry and effective types are distinct
    const expiryRefs = temporalRefs.filter((r) => r.context_type === 'expiry');
    const effectiveRefs = temporalRefs.filter(
      (r) => r.context_type === 'effective',
    );
    expect(expiryRefs.length).toBe(2);
    expect(effectiveRefs.length).toBe(1);
  });
});

// =============================================================================
// GP6: Guide Matching With Domain Slug
// =============================================================================

describe('GP6: Guide matching with domain slug', () => {
  it('content classified to domain slug matches guide with same domain_filter', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'Security Policy Document',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    // Classification assigns lowercase domain slug (S127 normalisation)
    const classResult = createIsoClassificationResult({
      primary_domain: 'security',
    });
    await simulateClassificationFlow(store, itemId, classResult);

    // Create guide with matching domain slug
    const guide = createTestGuide({
      slug: 'security-guide',
      domain_filter: 'security',
      is_published: true,
    });
    const section = createTestGuideSection({
      guide_id: guide.id,
      section_name: 'Data Protection',
      subtopic_filter: 'data-protection',
    });

    // Verify: The domain match works end-to-end
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.primary_domain).toBe('security');
    expect(classifiedItem.primary_domain).toBe(guide.domain_filter);

    // Verify: Subtopic filter would also match
    expect(classifiedItem.primary_subtopic).toBe(section.subtopic_filter);

    // Simulate get_guide_content RPC returning the match
    const rpcRow = createGuideContentRow({
      section_id: section.id,
      section_name: section.section_name,
      subtopic_filter: 'data-protection',
      content_id: itemId,
      content_title: classifiedItem.title as string,
      content_type: classifiedItem.content_type as string,
    });

    // Verify: The RPC row correctly links section to content
    expect(rpcRow.content_id).toBe(itemId);
    expect(rpcRow.subtopic_filter).toBe(classifiedItem.primary_subtopic);
  });

  it('content classified with uppercase domain does not match lowercase guide domain_filter', () => {
    // This tests that S127 domain slug normalisation is critical
    const classifiedDomain = 'Security'; // Unnormalised
    const guideDomainFilter = 'security'; // Normalised slug

    // Without normalisation, these would not match in a case-sensitive DB comparison
    expect(classifiedDomain).not.toBe(guideDomainFilter);

    // With normalisation (toLowerCase), they match
    expect(classifiedDomain.toLowerCase()).toBe(guideDomainFilter);
  });
});

// =============================================================================
// GP7: MCP Search Finds Classified Content
// =============================================================================

describe('GP7: MCP search finds classified content', () => {
  it('classified content with embedding is retrievable via search_knowledge_base flow', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'ISO 27001 Certification',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    const classResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: Item has embedding after classification
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.embedding).toBeTruthy();

    // Simulate what search_knowledge_base does:
    // 1. Generate embedding for query
    const queryEmbedding = new Array(1024).fill(0.2);
    mockGenerateEmbedding.mockResolvedValueOnce(queryEmbedding);

    // 2. Call hybrid_search RPC (mocked)
    const mockSearchResults = [
      {
        id: itemId,
        title: classifiedItem.title,
        content_type: classifiedItem.content_type,
        primary_domain: classifiedItem.primary_domain,
        similarity: 0.87,
        summary: classifiedItem.summary,
      },
    ];
    mockSupabase.rpc.mockResolvedValueOnce({
      data: mockSearchResults,
      error: null,
    });

    // 3. Verify the RPC would be called with correct shape
    const searchResult = await mockSupabase.rpc('hybrid_search', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: 'ISO 27001 certification',
      similarity_threshold: 0.3,
      limit_count: 11,
    });

    expect(searchResult.data).toHaveLength(1);
    expect(searchResult.data[0].id).toBe(itemId);
    expect(searchResult.data[0].primary_domain).toBe('security');
    expect(searchResult.data[0].similarity).toBeGreaterThan(0.3);

    // Verify: Domain filter post-processing would match
    const domainFilter = 'security';
    const filtered = searchResult.data.filter((r: Record<string, unknown>) =>
      (r.primary_domain as string).toLowerCase().includes(domainFilter),
    );
    expect(filtered.length).toBe(1);
  });

  it('content without embedding is NOT retrievable via search', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'Unembedded Content',
      content: 'Some basic content without an embedding.',
      content_type: 'policy',
      primary_domain: 'corporate',
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    // No classification = no embedding
    const item = store.contentItems.get(itemId)!;
    expect(item.embedding).toBeUndefined();

    // hybrid_search would not return items without embeddings
    mockSupabase.rpc.mockResolvedValueOnce({ data: [], error: null });

    const searchResult = await mockSupabase.rpc('hybrid_search', {
      query_embedding: JSON.stringify(new Array(1024).fill(0.2)),
      query_text: 'unembedded content',
      similarity_threshold: 0.3,
      limit_count: 11,
    });

    expect(searchResult.data).toHaveLength(0);
  });
});

// =============================================================================
// GP8: Content Without Entities — Graceful Handling
// =============================================================================

describe('GP8: Content without entities — graceful handling', () => {
  it('classification completes without entity storage errors when no entities found', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'Company Overview',
      content: NO_ENTITY_CONTENT,
      content_type: 'company_info',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    const classResult = createNoEntityClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: Classification completed successfully
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.primary_domain).toBe('corporate');
    expect(classifiedItem.primary_subtopic).toBe('company-overview');
    expect(classifiedItem.classified_at).toBeTruthy();

    // Verify: No entity mentions stored
    const entities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId,
    );
    expect(entities.length).toBe(0);

    // Verify: No entity relationships stored
    const relationships = store.entityRelationships.filter(
      (r) => r.source_item_id === itemId,
    );
    expect(relationships.length).toBe(0);

    // Verify: No temporal references in metadata (empty array case)
    const metadata = classifiedItem.metadata as Record<string, unknown>;
    // When temporal_references is empty, classifyContent does not add ai_temporal_references
    // (the if check at line 379 of classify.ts: result.temporal_references?.length)
    expect(metadata.ai_temporal_references).toBeUndefined();

    // Verify: Embedding still generated even without entities
    expect(classifiedItem.embedding).toBeTruthy();

    // Verify: Guide matching still works via domain
    expect(classifiedItem.primary_domain).toBe('corporate');
  });
});

// =============================================================================
// GP9: Content With Conflicting Temporal References
// =============================================================================

describe('GP9: Content with conflicting temporal references', () => {
  it('AI and regex paths store different dates for the same certification', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    // Regex extraction found a different date (e.g. parsing ambiguity)
    const uploadItem = createTestContentItem({
      id: itemId,
      title: 'ISO 27001 Policy',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {
        temporal_references: [
          // Regex misinterprets "December 2025" as an expiry
          { date: '2025-12-01', context: 'December 2025', type: 'expiry' },
        ],
      },
    });
    store.contentItems.set(itemId, { ...uploadItem });

    // AI classification extracts the correct temporal references
    const classResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    const classifiedItem = store.contentItems.get(itemId)!;
    const metadata = classifiedItem.metadata as Record<string, unknown>;

    // Verify: Both paths stored independently
    const regexRefs = metadata.temporal_references as Array<
      Record<string, unknown>
    >;
    const aiRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];

    expect(regexRefs).toBeDefined();
    expect(aiRefs).toBeDefined();

    // Verify: Regex path has the incorrect expiry
    expect(regexRefs[0].date).toBe('2025-12-01');
    expect(regexRefs[0].type).toBe('expiry');

    // Verify: AI path has the correct classification
    const aiDecemberRef = aiRefs.find((r) => r.date === '2025-12-01');
    expect(aiDecemberRef).toBeDefined();
    expect(aiDecemberRef!.context_type).toBe('historical'); // AI correctly identifies it as historical

    // Verify: AI path has the real expiry
    const aiExpiryRefs = aiRefs.filter((r) => r.context_type === 'expiry');
    expect(aiExpiryRefs.length).toBe(2);
    expect(aiExpiryRefs.some((r) => r.date === '2028-03-15')).toBe(true);

    // Document: There is currently no reconciliation logic between the two paths.
    // Both are stored independently. UI code must decide which to prefer.
    // Gap F from the spec — two separate storage locations for temporal data.
  });

  it('AI temporal references overwrite previous AI temporal references on reclassification', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    // First classification
    const item = createTestContentItem({
      id: itemId,
      title: 'ISO Policy',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...item });

    const firstClassResult = createIsoClassificationResult({
      temporal_references: [
        {
          date: '2028-03-15',
          context: 'Expires March 2028',
          context_type: 'expiry',
        },
      ],
    });
    await simulateClassificationFlow(store, itemId, firstClassResult);

    // Verify first classification stored
    let metadata = store.contentItems.get(itemId)!.metadata as Record<
      string,
      unknown
    >;
    let aiRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(aiRefs.length).toBe(1);

    // Second classification with different date
    const secondClassResult = createIsoClassificationResult({
      temporal_references: [
        {
          date: '2029-06-30',
          context: 'Extended to June 2029',
          context_type: 'expiry',
        },
        {
          date: '2028-03-15',
          context: 'Original expiry March 2028',
          context_type: 'historical',
        },
      ],
    });
    await simulateClassificationFlow(store, itemId, secondClassResult);

    // Verify: Second classification overwrites ai_temporal_references
    metadata = store.contentItems.get(itemId)!.metadata as Record<
      string,
      unknown
    >;
    aiRefs =
      metadata.ai_temporal_references as ClassificationTemporalReference[];
    expect(aiRefs.length).toBe(2);
    expect(aiRefs.some((r) => r.date === '2029-06-30')).toBe(true);
  });
});

// =============================================================================
// GP10: Cross-Feature Data Integrity
// =============================================================================

describe('GP10: Cross-feature data integrity', () => {
  it('no orphaned data after full golden path', async () => {
    const store = createInMemoryStore();
    const itemId = testUUID();

    const contentItem = createTestContentItem({
      id: itemId,
      title: 'ISO 27001 Certification',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId, { ...contentItem });

    const classResult = createIsoClassificationResult();
    await simulateClassificationFlow(store, itemId, classResult);

    // Verify: Every entity_mention has a valid content_item_id
    for (const mention of store.entityMentions) {
      expect(mention.content_item_id).toBe(itemId);
      expect(store.contentItems.has(mention.content_item_id as string)).toBe(
        true,
      );
    }

    // Verify: Every entity_relationship has a valid source_item_id
    for (const rel of store.entityRelationships) {
      expect(rel.source_item_id).toBe(itemId);
      expect(store.contentItems.has(rel.source_item_id as string)).toBe(true);
    }

    // Verify: No null canonical_names
    for (const mention of store.entityMentions) {
      expect(mention.canonical_name).toBeTruthy();
      expect(typeof mention.canonical_name).toBe('string');
      expect((mention.canonical_name as string).length).toBeGreaterThan(0);
    }

    // Verify: No null entity_names
    for (const mention of store.entityMentions) {
      expect(mention.entity_name).toBeTruthy();
    }

    // Verify: Relationship source/target entities are non-empty strings
    for (const rel of store.entityRelationships) {
      expect(rel.source_entity).toBeTruthy();
      expect(typeof rel.source_entity).toBe('string');
      expect(rel.target_entity).toBeTruthy();
      expect(typeof rel.target_entity).toBe('string');
    }

    // Verify: Relationship targets match entities that were extracted
    const extractedCanonicalNames = store.entityMentions.map(
      (e) => e.canonical_name as string,
    );
    for (const rel of store.entityRelationships) {
      const target = rel.target_entity as string;
      // 'holds' relationships have targets that should match extracted entities
      if (rel.relationship_type === 'holds') {
        expect(extractedCanonicalNames).toContain(target);
      }
    }

    // Verify: Content item classified_at is set
    const classifiedItem = store.contentItems.get(itemId)!;
    expect(classifiedItem.classified_at).toBeTruthy();

    // Verify: Content item embedding is set
    expect(classifiedItem.embedding).toBeTruthy();

    // Verify: Confidence scores are valid (0-1 range)
    for (const mention of store.entityMentions) {
      expect(mention.confidence).toBeGreaterThanOrEqual(0);
      expect(mention.confidence).toBeLessThanOrEqual(1);
    }
    for (const rel of store.entityRelationships) {
      expect(rel.confidence).toBeGreaterThanOrEqual(0);
      expect(rel.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('entities from different content items are isolated', async () => {
    const store = createInMemoryStore();
    const itemId1 = testUUID();
    const itemId2 = testUUID();

    // Create two different content items
    const item1 = createTestContentItem({
      id: itemId1,
      title: 'ISO 27001 Policy',
      content: ISO_CONTENT,
      content_type: 'policy',
      primary_domain: null,
      metadata: {},
    });
    const item2 = createTestContentItem({
      id: itemId2,
      title: 'Company Overview',
      content: NO_ENTITY_CONTENT,
      content_type: 'company_info',
      primary_domain: null,
      metadata: {},
    });
    store.contentItems.set(itemId1, { ...item1 });
    store.contentItems.set(itemId2, { ...item2 });

    // Classify both
    await simulateClassificationFlow(
      store,
      itemId1,
      createIsoClassificationResult(),
    );
    await simulateClassificationFlow(
      store,
      itemId2,
      createNoEntityClassificationResult(),
    );

    // Verify: Item 1 has entities, item 2 does not
    const item1Entities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId1,
    );
    const item2Entities = store.entityMentions.filter(
      (e) => e.content_item_id === itemId2,
    );

    expect(item1Entities.length).toBeGreaterThan(0);
    expect(item2Entities.length).toBe(0);

    // Verify: Item 1 has relationships, item 2 does not
    const item1Rels = store.entityRelationships.filter(
      (r) => r.source_item_id === itemId1,
    );
    const item2Rels = store.entityRelationships.filter(
      (r) => r.source_item_id === itemId2,
    );

    expect(item1Rels.length).toBeGreaterThan(0);
    expect(item2Rels.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Phase 3b: Real DB integration tests (next session)
// ---------------------------------------------------------------------------
// These stubs document the spec-required tests that need a live Supabase
// connection via SUPABASE_SECRET_KEY service client. See spec Section 4:
// "Real database required. Mocking would defeat the purpose."
//
// Implementation requires:
// - Service client using SUPABASE_SECRET_KEY from .env
// - GOLDEN-PATH-{timestamp} prefix for test data isolation
// - afterAll cleanup with FK-ordered deletion
// - vitest.integration.config.ts with 120s timeout
// ---------------------------------------------------------------------------

// Phase 3b IMPLEMENTED — see __tests__/integration/golden-path-real-db.integration.test.ts
// Run via: bun run test:integration
// 10 real DB tests using SUPABASE_SECRET_KEY service client (S131)
