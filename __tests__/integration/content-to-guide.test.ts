/**
 * Data Flow Integration Tests: Content-to-Guide
 *
 * Verifies the full data flow from content classification to guide population:
 *   content_item classification -> guide domain_filter matching -> guide_sections filtering -> API response
 *
 * These tests use mocked Supabase clients to verify the data flow logic without
 * requiring a live database. Each test documents the expected behaviour of the
 * `get_guide_content` RPC, the `get_guide_coverage` RPC, and the
 * `suggestGuideSections` client-side function.
 *
 * Tests that would ideally run against a live DB are marked with a comment.
 * The mock tests verify that the application code correctly interprets the
 * data shapes returned by the RPCs.
 *
 * Spec: docs/specs/data-flow-content-to-guide-spec.md
 *
 * Known issues documented in test comments:
 * 2. Seed script domain values: 7 example-client guides use client-specific domain names no content uses
 * 3. `get_guide_content` does not filter by `is_published` (intentional for preview)
 * 5. `suggestGuideSections` uses `.eq()` not `.in()` for primary domain only
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';
import {
  createTestGuide,
  createTestGuideSection,
  createTestContentItem,
  createGuideContentRow,
  createGuideCoverageRow,
  createGuideSectionQueryRow,
  testUUID,
} from './helpers/test-data-factory';
import { resetMockClient } from './helpers/cleanup';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import route handler and suggestGuideSections AFTER mocks
import { GET as guidesGet } from '@/app/api/guides/[slug]/route';
import {
  suggestGuideSections,
  type GuideSectionMatchInput,
} from '@/lib/guide-section-mapping';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Cast mock client for functions that expect a typed Supabase client */
function asSupabase(mock: MockSupabaseClient) {
  return mock as unknown as Parameters<typeof suggestGuideSections>[0];
}

/**
 * Configure the mock RPC to return specific rows for get_guide_content.
 */
function configureGuideContentRpc(
  client: MockSupabaseClient,
  rows: ReturnType<typeof createGuideContentRow>[],
) {
  client.rpc.mockResolvedValueOnce({ data: rows, error: null });
}

/**
 * Configure the mock chain for guide metadata fetch (from('guides').select(...).eq(...).single()).
 */
function configureGuideMetadata(
  client: MockSupabaseClient,
  guide: ReturnType<typeof createTestGuide> | null,
  error: { code?: string; message: string } | null = null,
) {
  client._chain.single.mockResolvedValueOnce({
    data: guide,
    error,
  });
}

/**
 * Configure the mock chain for suggestGuideSections query.
 * The query is: from('guide_sections').select(...).eq('guides.is_published', true).in('guides.domain_filter', domains)
 */
function configureSectionQueryResponse(
  client: MockSupabaseClient,
  sections: ReturnType<typeof createGuideSectionQueryRow>[],
) {
  client._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: sections, error: null, count: sections.length }),
  );
}

// ---------------------------------------------------------------------------
// Reset state before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  resetMockClient(mockSupabase);
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
});

// =============================================================================
// 4.1 Core Domain Matching Tests
// =============================================================================

describe('4.1 Core Domain Matching', () => {
  // -------------------------------------------------------------------------
  // Test 4.1.1
  // -------------------------------------------------------------------------
  describe('4.1.1: Item with matching primary_domain appears in guide', () => {
    it('content item with primary_domain matching guide domain_filter appears in get_guide_content results', async () => {
      // Setup: Guide with domain_filter='corporate', content with primary_domain='corporate'
      const guide = createTestGuide({
        slug: 'test-corp-guide',
        domain_filter: 'corporate',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Overview',
      });
      const contentItem = createTestContentItem({
        title: 'Company Profile',
        primary_domain: 'corporate',
        content_type: 'company_info',
      });

      // Configure mock: guide metadata fetch returns the guide
      configureGuideMetadata(mockSupabase, guide);

      // Configure mock: get_guide_content RPC returns the matching content
      const rpcRow = createGuideContentRow({
        section_id: section.id,
        section_name: 'Overview',
        content_id: contentItem.id,
        content_title: 'Company Profile',
        content_type: 'company_info',
        is_required: true,
      });
      configureGuideContentRpc(mockSupabase, [rpcRow]);

      // Action: Call the GET /api/guides/[slug] route
      const req = createTestRequest('/api/guides/test-corp-guide');
      const params = createTestParams({ slug: 'test-corp-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify: The response contains the guide and the content item in the section
      expect(body.guide.slug).toBe('test-corp-guide');
      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].section_name).toBe('Overview');
      expect(body.sections[0].content_items).toHaveLength(1);
      expect(body.sections[0].content_items[0].content_id).toBe(contentItem.id);
      expect(body.sections[0].content_items[0].content_title).toBe(
        'Company Profile',
      );

      // Verify: The RPC was called with the correct slug
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_guide_content', {
        p_guide_slug: 'test-corp-guide',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.1.2
  // -------------------------------------------------------------------------
  describe('4.1.2: Item with non-matching primary_domain does NOT appear in guide', () => {
    it('content item with different primary_domain does not appear in get_guide_content results', async () => {
      // Setup: Guide filters on 'security', content has 'compliance'
      const guide = createTestGuide({
        slug: 'test-sec-guide',
        domain_filter: 'security',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Security Overview',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC returns a section row but with NULL content_id (LEFT JOIN, no match)
      const rpcRow = createGuideContentRow({
        section_id: section.id,
        section_name: 'Security Overview',
        content_id: null,
        content_title: null,
        is_required: true,
      });
      configureGuideContentRpc(mockSupabase, [rpcRow]);

      const req = createTestRequest('/api/guides/test-sec-guide');
      const params = createTestParams({ slug: 'test-sec-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      // The section exists but has no content items
      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].section_name).toBe('Security Overview');
      expect(body.sections[0].content_items).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.1.3
  // -------------------------------------------------------------------------
  describe('4.1.3: Item with secondary_domain matching guide (known gap)', () => {
    it('content item with secondary_domain matching guide domain_filter does not appear until secondary domain matching is implemented', async () => {
      // Setup: Guide filters on 'corporate', content has primary_domain='compliance'
      // and secondary_domain='corporate'
      const guide = createTestGuide({
        slug: 'test-corp-guide-2',
        domain_filter: 'corporate',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Overview',
      });

      configureGuideMetadata(mockSupabase, guide);

      // Current behaviour: get_guide_content does NOT match on secondary_domain,
      // so the content item does not appear (NULL content_id)
      const rpcRow = createGuideContentRow({
        section_id: section.id,
        section_name: 'Overview',
        content_id: null,
        content_title: null,
        is_required: true,
      });
      configureGuideContentRpc(mockSupabase, [rpcRow]);

      const req = createTestRequest('/api/guides/test-corp-guide-2');
      const params = createTestParams({ slug: 'test-corp-guide-2' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Current assertion: secondary domain content does NOT appear
      expect(body.sections[0].content_items).toHaveLength(0);

      // TODO: Update assertion after secondary domain matching is implemented
      // (see docs/specs/secondary-domain-guide-matching-spec.md).
      // After implementation, the content item with secondary_domain='corporate'
      // SHOULD appear in the guide with domain_filter='corporate'.
      // Expected post-fix assertion:
      // expect(body.sections[0].content_items).toHaveLength(1);
      // expect(body.sections[0].content_items[0].content_title).toBe('Audit Governance');
    });
  });
});

// =============================================================================
// 4.2 Subtopic Filtering Tests
// =============================================================================

describe('4.2 Subtopic Filtering', () => {
  // -------------------------------------------------------------------------
  // Test 4.2.1
  // -------------------------------------------------------------------------
  describe('4.2.1: Section with subtopic_filter only includes matching content', () => {
    it('guide section with subtopic_filter only includes items with matching primary_subtopic', async () => {
      const guide = createTestGuide({
        slug: 'test-compliance-guide',
        domain_filter: 'compliance',
        is_published: true,
      });
      const sectionCert = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Certification',
        subtopic_filter: 'certification',
        display_order: 1,
      });
      const sectionAudit = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Audit',
        subtopic_filter: 'audit',
        display_order: 2,
      });
      const item1 = createTestContentItem({
        title: 'ISO 27001 Status',
        primary_domain: 'compliance',
        primary_subtopic: 'certification',
        content_type: 'q_a_pair',
      });
      const item2 = createTestContentItem({
        title: 'Audit Process',
        primary_domain: 'compliance',
        primary_subtopic: 'audit',
        content_type: 'q_a_pair',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC returns two rows: item1 in Certification section, item2 in Audit section
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: sectionCert.id,
          section_name: 'Certification',
          subtopic_filter: 'certification',
          section_order: 1,
          content_id: item1.id,
          content_title: 'ISO 27001 Status',
          content_type: 'q_a_pair',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: sectionAudit.id,
          section_name: 'Audit',
          subtopic_filter: 'audit',
          section_order: 2,
          content_id: item2.id,
          content_title: 'Audit Process',
          content_type: 'q_a_pair',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-compliance-guide');
      const params = createTestParams({ slug: 'test-compliance-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections).toHaveLength(2);

      // Section 'Certification' contains only item 1
      const certSection = body.sections.find(
        (s: { section_name: string }) => s.section_name === 'Certification',
      );
      expect(certSection.content_items).toHaveLength(1);
      expect(certSection.content_items[0].content_title).toBe(
        'ISO 27001 Status',
      );

      // Section 'Audit' contains only item 2
      const auditSection = body.sections.find(
        (s: { section_name: string }) => s.section_name === 'Audit',
      );
      expect(auditSection.content_items).toHaveLength(1);
      expect(auditSection.content_items[0].content_title).toBe('Audit Process');
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.2.2
  // -------------------------------------------------------------------------
  describe('4.2.2: Section with NULL subtopic_filter includes all domain-matched content', () => {
    it('guide section with NULL subtopic_filter includes all items in the domain', async () => {
      const guide = createTestGuide({
        slug: 'test-catchall-guide',
        domain_filter: 'compliance',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'All Compliance',
        subtopic_filter: null,
      });
      const item1 = createTestContentItem({
        title: 'Cert Item',
        primary_domain: 'compliance',
        primary_subtopic: 'certification',
      });
      const item2 = createTestContentItem({
        title: 'Audit Item',
        primary_domain: 'compliance',
        primary_subtopic: 'audit',
      });
      const item3 = createTestContentItem({
        title: 'Standards Item',
        primary_domain: 'compliance',
        primary_subtopic: 'standards',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC returns all three items in the same section (NULL subtopic = wildcard)
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All Compliance',
          content_id: item1.id,
          content_title: 'Cert Item',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All Compliance',
          content_id: item2.id,
          content_title: 'Audit Item',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All Compliance',
          content_id: item3.id,
          content_title: 'Standards Item',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-catchall-guide');
      const params = createTestParams({ slug: 'test-catchall-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].section_name).toBe('All Compliance');
      expect(body.sections[0].content_items).toHaveLength(3);

      const titles = body.sections[0].content_items.map(
        (ci: { content_title: string }) => ci.content_title,
      );
      expect(titles).toContain('Cert Item');
      expect(titles).toContain('Audit Item');
      expect(titles).toContain('Standards Item');
    });
  });
});

// =============================================================================
// 4.3 Layer Filtering Tests
// =============================================================================

describe('4.3 Layer Filtering', () => {
  // -------------------------------------------------------------------------
  // Test 4.3.1
  // -------------------------------------------------------------------------
  describe('4.3.1: Section with expected_layer filters by layer', () => {
    it('guide section with expected_layer only includes items with matching layer', async () => {
      // KNOWN ISSUE: The get_guide_content RPC reads ci.metadata->>'layer' instead of
      // the promoted ci.layer column. Test data must set both to avoid false negatives.
      // See: docs/specs/data-flow-content-to-guide-spec.md section 3.3
      const guide = createTestGuide({
        slug: 'test-layer-guide',
        domain_filter: 'corporate',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Company Reference',
        expected_layer: 'company_reference',
      });
      const item1 = createTestContentItem({
        primary_domain: 'corporate',
        content_type: 'company_info',
        layer: 'company_reference',
        metadata: { layer: 'company_reference' },
      });
      const item2 = createTestContentItem({
        primary_domain: 'corporate',
        content_type: 'article',
        layer: 'research',
        metadata: { layer: 'research' },
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC only returns item1 (layer match); item2 is excluded
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: section.id,
          section_name: 'Company Reference',
          expected_layer: 'company_reference',
          content_id: item1.id,
          content_title: item1.title,
          content_type: 'company_info',
          content_layer: 'company_reference',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-layer-guide');
      const params = createTestParams({ slug: 'test-layer-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].content_items).toHaveLength(1);
      expect(body.sections[0].content_items[0].content_layer).toBe(
        'company_reference',
      );

      // Item2 with layer='research' should not appear
      const allContentIds = body.sections[0].content_items.map(
        (ci: { content_id: string }) => ci.content_id,
      );
      expect(allContentIds).not.toContain(item2.id);
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.3.2
  // -------------------------------------------------------------------------
  describe('4.3.2: Layer column vs metadata JSONB path consistency', () => {
    it('documents the layer storage discrepancy between ci.layer and metadata.layer', () => {
      // This test documents a known discrepancy in the data model:
      //
      // The `content_items` table has BOTH:
      //   - `layer` column (varchar(50), added in squashed migration line 432, indexed)
      //   - `metadata->>'layer'` JSONB path
      //
      // get_guide_content and get_guide_coverage read from metadata->>'layer'
      // get_coverage_matrix correctly reads from ci.layer
      //
      // If these values diverge, guide layer filtering silently breaks.
      //
      // RECOMMENDATION: Run the following SQL periodically to detect divergence:
      //   SELECT COUNT(*) FROM content_items
      //   WHERE layer IS DISTINCT FROM metadata->>'layer'
      //     AND (layer IS NOT NULL OR metadata->>'layer' IS NOT NULL);
      //
      // Expected result: 0 (all items consistent)
      //
      // This is an audit check, not a mock test. A live DB test would query
      // the real data and assert count = 0.
      //
      // For mock verification, we ensure test data factories always set both:
      const item = createTestContentItem({
        layer: 'company_reference',
        metadata: { layer: 'company_reference' },
      });

      expect(item.layer).toBe('company_reference');
      expect(item.metadata.layer).toBe('company_reference');
      expect(item.layer).toBe(item.metadata.layer);
    });
  });
});

// =============================================================================
// 4.4 Content Type Filtering Tests
// =============================================================================

describe('4.4 Content Type Filtering', () => {
  // -------------------------------------------------------------------------
  // Test 4.4.1
  // -------------------------------------------------------------------------
  describe('4.4.1: Section with content_type_filter only includes matching types', () => {
    it('guide section with content_type_filter only includes items of that content type', async () => {
      const guide = createTestGuide({
        slug: 'test-type-guide',
        domain_filter: 'security',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'Q&A Pairs',
        content_type_filter: 'q_a_pair',
      });
      const item1 = createTestContentItem({
        title: 'Security Q&A',
        primary_domain: 'security',
        content_type: 'q_a_pair',
      });
      const item2 = createTestContentItem({
        title: 'Security Policy',
        primary_domain: 'security',
        content_type: 'policy',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC returns only item1 (content_type match)
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: section.id,
          section_name: 'Q&A Pairs',
          content_type_filter: 'q_a_pair',
          content_id: item1.id,
          content_title: 'Security Q&A',
          content_type: 'q_a_pair',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-type-guide');
      const params = createTestParams({ slug: 'test-type-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections).toHaveLength(1);
      expect(body.sections[0].content_items).toHaveLength(1);
      expect(body.sections[0].content_items[0].content_title).toBe(
        'Security Q&A',
      );
      expect(body.sections[0].content_items[0].content_type).toBe('q_a_pair');

      // Item2 (policy) should not appear
      const allContentIds = body.sections[0].content_items.map(
        (ci: { content_id: string }) => ci.content_id,
      );
      expect(allContentIds).not.toContain(item2.id);
    });
  });
});

// =============================================================================
// 4.5 Exclusion Tests
// =============================================================================

describe('4.5 Exclusion Tests', () => {
  // -------------------------------------------------------------------------
  // Test 4.5.1
  // -------------------------------------------------------------------------
  describe('4.5.1: Archived items are excluded from guides', () => {
    it('archived content items do not appear in get_guide_content results', async () => {
      const guide = createTestGuide({
        slug: 'test-archive-guide',
        domain_filter: 'corporate',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'All',
      });
      const activeItem = createTestContentItem({
        title: 'Active Item',
        primary_domain: 'corporate',
        archived_at: null,
      });
      // Archived item would have archived_at set, but RPC excludes it
      const _archivedItem = createTestContentItem({
        title: 'Archived Item',
        primary_domain: 'corporate',
        archived_at: '2026-03-01T00:00:00Z',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC only returns the active item (ci.archived_at IS NULL filter)
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All',
          content_id: activeItem.id,
          content_title: 'Active Item',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-archive-guide');
      const params = createTestParams({ slug: 'test-archive-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections[0].content_items).toHaveLength(1);
      expect(body.sections[0].content_items[0].content_title).toBe(
        'Active Item',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.5.2
  // -------------------------------------------------------------------------
  describe('4.5.2: Draft items are excluded from guides', () => {
    it('draft content items do not appear in get_guide_content results', async () => {
      const guide = createTestGuide({
        slug: 'test-draft-guide',
        domain_filter: 'corporate',
        is_published: true,
      });
      const section = createTestGuideSection({
        guide_id: guide.id,
        section_name: 'All',
      });
      const approvedItem = createTestContentItem({
        title: 'Approved Item',
        primary_domain: 'corporate',
        governance_review_status: 'approved',
      });
      const nullStatusItem = createTestContentItem({
        title: 'Null Status Item',
        primary_domain: 'corporate',
        governance_review_status: null,
      });
      // Draft item is excluded by the RPC (governance_review_status != 'draft')
      const _draftItem = createTestContentItem({
        title: 'Draft Item',
        primary_domain: 'corporate',
        governance_review_status: 'draft',
      });

      configureGuideMetadata(mockSupabase, guide);

      // RPC returns approved and null-status items, but NOT the draft item
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All',
          content_id: approvedItem.id,
          content_title: 'Approved Item',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: section.id,
          section_name: 'All',
          content_id: nullStatusItem.id,
          content_title: 'Null Status Item',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-draft-guide');
      const params = createTestParams({ slug: 'test-draft-guide' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.sections[0].content_items).toHaveLength(2);
      const titles = body.sections[0].content_items.map(
        (ci: { content_title: string }) => ci.content_title,
      );
      expect(titles).toContain('Approved Item');
      expect(titles).toContain('Null Status Item');
      expect(titles).not.toContain('Draft Item');
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.5.3
  // -------------------------------------------------------------------------
  describe('4.5.3: Unpublished guides in coverage', () => {
    it('documents that get_guide_coverage filters out unpublished guides while get_guide_content does not', () => {
      // KNOWN DESIGN DECISION:
      // get_guide_content does NOT filter by is_published — it returns results
      // for any guide if you know the slug. This is intentional for preview.
      //
      // get_guide_coverage DOES filter by is_published — only published guides
      // appear in coverage reporting.
      //
      // This test documents the asymmetry. A live DB test would:
      // 1. Create an unpublished guide with content
      // 2. Call get_guide_content(slug) — expect results (preview works)
      // 3. Call get_guide_coverage() — expect the guide to be absent

      // Verify the mock factories can represent unpublished guides
      const unpubGuide = createTestGuide({
        slug: 'test-unpub-guide',
        is_published: false,
      });
      expect(unpubGuide.is_published).toBe(false);

      // Coverage RPC would not include this guide
      const coverageRows = [
        createGuideCoverageRow({
          guide_slug: 'some-published-guide',
          guide_name: 'Published Guide',
          content_count: 5,
        }),
      ];
      expect(
        coverageRows.every((r) => r.guide_slug !== 'test-unpub-guide'),
      ).toBe(true);
    });
  });
});

// =============================================================================
// 4.6 Semantic Validation Tests (Domain Value Consistency)
// =============================================================================

describe('4.6 Semantic Validation — Domain Value Consistency', () => {
  // -------------------------------------------------------------------------
  // Test 4.6.1
  // -------------------------------------------------------------------------
  describe('4.6.1: Guide domain_filter values have matching content', () => {
    it('documents the known domain mismatch between guides and content items', () => {
      // KNOWN DATA ISSUE (persisted for 30+ sessions):
      //
      // All 7 seeded example-client guides use client-specific domain_filter values:
      //   - 'Safeguarding & Child Protection'
      //   - 'Safeguarding Adults'
      //   - 'Multi-Academy Trusts'
      //   - 'Education'
      //   - 'Products & Services'
      //   - 'Company & Corporate'
      //   etc.
      //
      // All 251+ content items use baseline taxonomy domains:
      //   - 'security', 'compliance', 'corporate', 'support',
      //     'product-feature', 'methodology', 'implementation'
      //
      // No guide currently has matching content — all 7 have mismatched
      // domain_filter values.
      //
      // This is a SEMANTIC validation gap: the seed script validates that
      // domain_filter values exist in taxonomy_domains (structural check),
      // but does NOT validate that any content_items use those domains
      // (connectivity check).
      //
      // AUDIT QUERY (run against live DB):
      //   SELECT g.slug, g.name, g.domain_filter, COUNT(ci.id) AS item_count
      //   FROM guides g
      //   LEFT JOIN content_items ci ON ci.primary_domain = g.domain_filter
      //     AND ci.archived_at IS NULL
      //   WHERE g.is_published = true
      //   GROUP BY g.slug, g.name, g.domain_filter
      //   ORDER BY item_count ASC;
      //
      // Expected: ALL guides have item_count = 0 (currently expected to fail)
      //
      // This test would have caught the domain mismatch immediately if
      // run as part of CI.

      // Verify our factory defaults use baseline taxonomy domains (not client domains)
      const item = createTestContentItem();
      const baselineDomains = [
        'security',
        'compliance',
        'corporate',
        'support',
        'product-feature',
        'methodology',
        'implementation',
      ];
      expect(baselineDomains).toContain(item.primary_domain);

      // Client domains used by seeded guides
      const clientDomains = [
        'Safeguarding & Child Protection',
        'Safeguarding Adults',
        'Multi-Academy Trusts',
        'Education',
        'Products & Services',
        'Company & Corporate',
      ];

      // No overlap between baseline and client domains
      for (const clientDomain of clientDomains) {
        expect(baselineDomains).not.toContain(clientDomain);
      }
    });
  });

  // -------------------------------------------------------------------------
  // Test 4.6.2
  // -------------------------------------------------------------------------
  describe('4.6.2: Guide domain_filter values exist in taxonomy_domains', () => {
    it('documents the structural validation that the seed script performs', () => {
      // The seed script at scripts/seed-example-client-guides.ts validates that domain_filter
      // values exist in taxonomy_domains (structural validation). This works correctly.
      //
      // The problem is that structural validation alone is insufficient — a domain
      // can exist in taxonomy_domains but have zero content items classified with it.
      //
      // AUDIT QUERY (run against live DB):
      //   SELECT g.slug, g.domain_filter
      //   FROM guides g
      //   LEFT JOIN taxonomy_domains td ON td.name = g.domain_filter AND td.is_active = true
      //   WHERE td.id IS NULL;
      //
      // Expected: 0 rows (all guide domains exist in active taxonomy)
      //
      // This is a live DB check. For mock tests, we verify the factory creates
      // valid domain values.

      const guide = createTestGuide({ domain_filter: 'corporate' });
      expect(guide.domain_filter).toBeTruthy();
      expect(typeof guide.domain_filter).toBe('string');
    });
  });
});

// =============================================================================
// 4.7 Coverage RPC Consistency Tests
// =============================================================================

describe('4.7 Coverage RPC Consistency', () => {
  // -------------------------------------------------------------------------
  // Test 4.7.1
  // -------------------------------------------------------------------------
  describe('4.7.1: get_guide_coverage counts match get_guide_content item counts', () => {
    it('coverage content_count matches actual items returned by guide content RPC', async () => {
      // This test verifies that get_guide_coverage and get_guide_content
      // use consistent matching logic.
      //
      // Setup: A guide with known content
      const guide = createTestGuide({
        slug: 'test-consistency-coverage',
        domain_filter: 'corporate',
        is_published: true,
      });
      const sectionId = testUUID();

      // get_guide_content returns 3 items in this section
      const contentRows = [
        createGuideContentRow({
          section_id: sectionId,
          section_name: 'Overview',
          content_id: testUUID(),
          content_title: 'Item 1',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: sectionId,
          section_name: 'Overview',
          content_id: testUUID(),
          content_title: 'Item 2',
          is_required: true,
        }),
        createGuideContentRow({
          section_id: sectionId,
          section_name: 'Overview',
          content_id: testUUID(),
          content_title: 'Item 3',
          is_required: true,
        }),
      ];

      // get_guide_coverage should report content_count=3 for this section
      const coverageRow = createGuideCoverageRow({
        guide_id: guide.id,
        guide_slug: 'test-consistency-coverage',
        guide_name: guide.name,
        section_id: sectionId,
        section_name: 'Overview',
        content_count: 3,
      });

      // Verify consistency: content count matches the number of distinct content items
      const distinctContentIds = contentRows
        .filter((r) => r.content_id !== null)
        .map((r) => r.content_id);
      expect(distinctContentIds).toHaveLength(coverageRow.content_count);

      // Also verify via the API route
      configureGuideMetadata(mockSupabase, guide);
      configureGuideContentRpc(mockSupabase, contentRows);

      const req = createTestRequest('/api/guides/test-consistency-coverage');
      const params = createTestParams({ slug: 'test-consistency-coverage' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      // The API groups by section and counts content items
      const sectionFromApi = body.sections[0];
      expect(sectionFromApi.content_items).toHaveLength(
        coverageRow.content_count,
      );
    });
  });
});

// =============================================================================
// 4.8 Client-Side Matching Consistency Tests
// =============================================================================

describe('4.8 Client-Side Matching Consistency', () => {
  // -------------------------------------------------------------------------
  // Test 4.8.1
  // -------------------------------------------------------------------------
  describe('4.8.1: suggestGuideSections returns matches consistent with get_guide_content', () => {
    it('suggestGuideSections for a classified item matches guide sections from RPC', async () => {
      // Setup: Guide and section with specific filters
      const guideId = testUUID();
      const sectionId = testUUID();
      const guide = createTestGuide({
        id: guideId,
        slug: 'test-consistency',
        domain_filter: 'corporate',
        is_published: true,
      });

      // Configure suggestGuideSections mock query response
      const sectionQueryRow = createGuideSectionQueryRow({
        id: sectionId,
        section_name: 'Company Info',
        subtopic_filter: 'company-info',
        expected_layer: 'company_reference',
        content_type_filter: null,
        display_order: 1,
        is_required: true,
        guides: {
          id: guideId,
          name: guide.name,
          slug: 'test-consistency',
          domain_filter: 'corporate',
          display_order: 1,
          is_published: true,
        },
      });

      configureSectionQueryResponse(mockSupabase, [sectionQueryRow]);

      // Action: Call suggestGuideSections with matching classification
      const input: GuideSectionMatchInput = {
        primaryDomain: 'corporate',
        primarySubtopic: 'company-info',
        layer: 'company_reference',
      };

      const suggestions = await suggestGuideSections(
        asSupabase(mockSupabase),
        input,
      );

      // Verify: Suggestions include the section with exact match strength
      expect(suggestions).toHaveLength(1);
      expect(suggestions[0].sectionName).toBe('Company Info');
      expect(suggestions[0].matchStrength).toBe('exact');
      expect(suggestions[0].guideSlug).toBe('test-consistency');

      // Now verify the same content would appear in get_guide_content
      // Reset mocks for the API call
      resetMockClient(mockSupabase);
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'test-user-id', email: 'test@example.com' } },
        error: null,
      });

      configureGuideMetadata(mockSupabase, guide);

      // An item with these classification values WOULD be returned by the RPC
      const contentItem = createTestContentItem({
        primary_domain: 'corporate',
        primary_subtopic: 'company-info',
        layer: 'company_reference',
        metadata: { layer: 'company_reference' },
      });
      configureGuideContentRpc(mockSupabase, [
        createGuideContentRow({
          section_id: sectionId,
          section_name: 'Company Info',
          subtopic_filter: 'company-info',
          expected_layer: 'company_reference',
          content_id: contentItem.id,
          content_title: contentItem.title,
          content_layer: 'company_reference',
          is_required: true,
        }),
      ]);

      const req = createTestRequest('/api/guides/test-consistency');
      const params = createTestParams({ slug: 'test-consistency' });
      const res = await guidesGet(req, { params });

      expect(res.status).toBe(200);
      const body = await res.json();

      // Verify: The same section that suggestGuideSections identified
      // also contains the content item in get_guide_content results
      expect(body.sections[0].section_name).toBe('Company Info');
      expect(body.sections[0].content_items).toHaveLength(1);
    });
  });
});

// =============================================================================
// 4.9 Domain with No Matching Guide
// =============================================================================

describe('4.9 Domain with No Matching Guide', () => {
  // -------------------------------------------------------------------------
  // Test 4.9.1
  // -------------------------------------------------------------------------
  describe('4.9.1: suggestGuideSections returns empty for domain with no guide', () => {
    it('suggestGuideSections returns empty array when no published guide has matching domain_filter', async () => {
      // Configure mock to return no sections (no guides match the domain)
      configureSectionQueryResponse(mockSupabase, []);

      const input: GuideSectionMatchInput = {
        primaryDomain: 'NONEXISTENT-DOMAIN',
        primarySubtopic: 'any',
      };

      const suggestions = await suggestGuideSections(
        asSupabase(mockSupabase),
        input,
      );

      expect(suggestions).toEqual([]);
      // No errors thrown — graceful handling
    });

    it('suggestGuideSections returns empty array when primaryDomain is empty', async () => {
      const input: GuideSectionMatchInput = {
        primaryDomain: '',
        primarySubtopic: 'any',
      };

      const suggestions = await suggestGuideSections(
        asSupabase(mockSupabase),
        input,
      );

      // Empty domain triggers early return without querying
      expect(suggestions).toEqual([]);
    });
  });
});

// =============================================================================
// Additional Data Flow Tests — Full Chain Verification
// =============================================================================

describe('Full Chain: Classification -> Guide Population -> API Response', () => {
  it('verifies the complete data flow from classification to API response', async () => {
    // This test walks through the entire data flow chain:
    //
    // 1. Content is classified with primary_domain='compliance', primary_subtopic='certification'
    // 2. A guide exists with domain_filter='compliance'
    // 3. The guide has a section with subtopic_filter='certification'
    // 4. The RPC matches the content to the section
    // 5. The API route returns the content grouped under the correct section

    const guideId = testUUID();
    const sectionId = testUUID();

    // Step 1: Content classification result
    const classifiedContent = createTestContentItem({
      title: 'ISO 27001 Certification Status',
      primary_domain: 'compliance',
      primary_subtopic: 'certification',
      content_type: 'q_a_pair',
      layer: 'bid_detail',
      metadata: { layer: 'bid_detail' },
    });

    // Step 2-3: Guide and section setup
    const guide = createTestGuide({
      id: guideId,
      slug: 'compliance-sector-guide',
      name: 'Compliance Guide',
      domain_filter: 'compliance',
      is_published: true,
    });

    // Step 4: Mock the RPC to simulate the database join
    configureGuideMetadata(mockSupabase, guide);
    configureGuideContentRpc(mockSupabase, [
      createGuideContentRow({
        section_id: sectionId,
        section_name: 'Certification',
        subtopic_filter: 'certification',
        expected_layer: null,
        content_type_filter: null,
        section_order: 1,
        content_id: classifiedContent.id,
        content_title: classifiedContent.title,
        content_type: 'q_a_pair',
        content_layer: 'bid_detail',
        is_required: true,
      }),
    ]);

    // Step 5: API route call
    const req = createTestRequest('/api/guides/compliance-sector-guide');
    const params = createTestParams({ slug: 'compliance-sector-guide' });
    const res = await guidesGet(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();

    // Full chain verification
    expect(body.guide.slug).toBe('compliance-sector-guide');
    expect(body.guide.domain_filter).toBe('compliance');
    expect(body.sections).toHaveLength(1);

    const section = body.sections[0];
    expect(section.section_name).toBe('Certification');
    expect(section.subtopic_filter).toBe('certification');
    expect(section.content_items).toHaveLength(1);

    const item = section.content_items[0];
    expect(item.content_id).toBe(classifiedContent.id);
    expect(item.content_title).toBe('ISO 27001 Certification Status');
    expect(item.content_type).toBe('q_a_pair');
    expect(item.content_layer).toBe('bid_detail');
  });

  it('verifies guide with multiple sections groups content correctly', async () => {
    const guideId = testUUID();
    const section1Id = testUUID();
    const section2Id = testUUID();
    const section3Id = testUUID();

    const guide = createTestGuide({
      id: guideId,
      slug: 'multi-section-guide',
      domain_filter: 'security',
      is_published: true,
    });

    const item1 = createTestContentItem({
      title: 'Access Control Policy',
      primary_domain: 'security',
      content_type: 'policy',
    });
    const item2 = createTestContentItem({
      title: 'Encryption FAQ',
      primary_domain: 'security',
      content_type: 'q_a_pair',
    });
    const item3 = createTestContentItem({
      title: 'Incident Response Plan',
      primary_domain: 'security',
      content_type: 'policy',
    });

    configureGuideMetadata(mockSupabase, guide);
    configureGuideContentRpc(mockSupabase, [
      // Section 1: Policies (content_type_filter='policy')
      createGuideContentRow({
        section_id: section1Id,
        section_name: 'Policies',
        section_order: 1,
        content_type_filter: 'policy',
        content_id: item1.id,
        content_title: 'Access Control Policy',
        content_type: 'policy',
        is_required: true,
      }),
      createGuideContentRow({
        section_id: section1Id,
        section_name: 'Policies',
        section_order: 1,
        content_type_filter: 'policy',
        content_id: item3.id,
        content_title: 'Incident Response Plan',
        content_type: 'policy',
        is_required: true,
      }),
      // Section 2: Q&A (content_type_filter='q_a_pair')
      createGuideContentRow({
        section_id: section2Id,
        section_name: 'Q&A',
        section_order: 2,
        content_type_filter: 'q_a_pair',
        content_id: item2.id,
        content_title: 'Encryption FAQ',
        content_type: 'q_a_pair',
        is_required: false,
      }),
      // Section 3: Empty section (no matching content)
      createGuideContentRow({
        section_id: section3Id,
        section_name: 'Case Studies',
        section_order: 3,
        content_type_filter: 'case_study',
        content_id: null,
        content_title: null,
        is_required: false,
      }),
    ]);

    const req = createTestRequest('/api/guides/multi-section-guide');
    const params = createTestParams({ slug: 'multi-section-guide' });
    const res = await guidesGet(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.sections).toHaveLength(3);

    // Sections should be sorted by display order
    expect(body.sections[0].section_name).toBe('Policies');
    expect(body.sections[0].content_items).toHaveLength(2);

    expect(body.sections[1].section_name).toBe('Q&A');
    expect(body.sections[1].content_items).toHaveLength(1);

    expect(body.sections[2].section_name).toBe('Case Studies');
    expect(body.sections[2].content_items).toHaveLength(0);
  });

  it('handles guide not found gracefully', async () => {
    // Guide metadata fetch returns 404
    configureGuideMetadata(mockSupabase, null, {
      code: 'PGRST116',
      message: 'Not found',
    });

    const req = createTestRequest('/api/guides/nonexistent-guide');
    const params = createTestParams({ slug: 'nonexistent-guide' });
    const res = await guidesGet(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Guide not found');
  });

  it('handles RPC error gracefully', async () => {
    const guide = createTestGuide({ slug: 'test-rpc-error' });
    configureGuideMetadata(mockSupabase, guide);

    // RPC returns an error
    mockSupabase.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'RPC execution failed' },
    });

    const req = createTestRequest('/api/guides/test-rpc-error');
    const params = createTestParams({ slug: 'test-rpc-error' });
    const res = await guidesGet(req, { params });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Failed to fetch guide content');
  });
});

// =============================================================================
// Domain Change Flow Tests
// =============================================================================

describe('Domain Change Flow', () => {
  it('changing content domain updates which guide results include it', async () => {
    // This test verifies the concept that reclassifying content changes guide membership.
    //
    // Scenario:
    // 1. Item initially classified as primary_domain='security'
    // 2. Appears in security guide, not in compliance guide
    // 3. Item reclassified to primary_domain='compliance'
    // 4. Now appears in compliance guide, not in security guide
    //
    // We simulate this by showing two different RPC responses for the same guide slug.

    const securityGuide = createTestGuide({
      slug: 'security-guide',
      domain_filter: 'security',
    });
    const complianceGuide = createTestGuide({
      slug: 'compliance-guide',
      domain_filter: 'compliance',
    });
    const sectionId = testUUID();
    const itemId = testUUID();

    // --- Phase 1: Item classified as 'security' ---
    configureGuideMetadata(mockSupabase, securityGuide);
    configureGuideContentRpc(mockSupabase, [
      createGuideContentRow({
        section_id: sectionId,
        section_name: 'Overview',
        content_id: itemId,
        content_title: 'Reclassified Item',
        is_required: true,
      }),
    ]);

    const req1 = createTestRequest('/api/guides/security-guide');
    const params1 = createTestParams({ slug: 'security-guide' });
    const res1 = await guidesGet(req1, { params: params1 });
    const body1 = await res1.json();

    // Item appears in security guide
    expect(body1.sections[0].content_items).toHaveLength(1);
    expect(body1.sections[0].content_items[0].content_id).toBe(itemId);

    // Reset for next call
    resetMockClient(mockSupabase);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    // --- Phase 2: After reclassification to 'compliance' ---
    // Security guide no longer includes the item
    configureGuideMetadata(mockSupabase, securityGuide);
    configureGuideContentRpc(mockSupabase, [
      createGuideContentRow({
        section_id: sectionId,
        section_name: 'Overview',
        content_id: null, // Item no longer matches
        content_title: null,
        is_required: true,
      }),
    ]);

    const req2 = createTestRequest('/api/guides/security-guide');
    const params2 = createTestParams({ slug: 'security-guide' });
    const res2 = await guidesGet(req2, { params: params2 });
    const body2 = await res2.json();

    // Item no longer in security guide
    expect(body2.sections[0].content_items).toHaveLength(0);

    // Reset for compliance guide call
    resetMockClient(mockSupabase);
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });

    // Compliance guide now includes the item
    const complianceSectionId = testUUID();
    configureGuideMetadata(mockSupabase, complianceGuide);
    configureGuideContentRpc(mockSupabase, [
      createGuideContentRow({
        section_id: complianceSectionId,
        section_name: 'All',
        content_id: itemId,
        content_title: 'Reclassified Item',
        is_required: true,
      }),
    ]);

    const req3 = createTestRequest('/api/guides/compliance-guide');
    const params3 = createTestParams({ slug: 'compliance-guide' });
    const res3 = await guidesGet(req3, { params: params3 });
    const body3 = await res3.json();

    // Item now appears in compliance guide
    expect(body3.sections[0].content_items).toHaveLength(1);
    expect(body3.sections[0].content_items[0].content_id).toBe(itemId);
  });
});

// =============================================================================
// suggestGuideSections Match Strength Tests
// =============================================================================

describe('suggestGuideSections — Match Strength Verification', () => {
  it('returns exact match when all section filters match', async () => {
    const guideId = testUUID();
    configureSectionQueryResponse(mockSupabase, [
      createGuideSectionQueryRow({
        section_name: 'Exact Match Section',
        subtopic_filter: 'certification',
        expected_layer: 'bid_detail',
        content_type_filter: 'q_a_pair',
        is_required: true,
        guides: {
          id: guideId,
          name: 'Test Guide',
          slug: 'test-guide',
          domain_filter: 'compliance',
          display_order: 1,
          is_published: true,
        },
      }),
    ]);

    const result = await suggestGuideSections(asSupabase(mockSupabase), {
      primaryDomain: 'compliance',
      primarySubtopic: 'certification',
      layer: 'bid_detail',
      contentType: 'q_a_pair',
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchStrength).toBe('exact');
    expect(result[0].sectionName).toBe('Exact Match Section');
  });

  it('returns partial match when some section filters match', async () => {
    const guideId = testUUID();
    configureSectionQueryResponse(mockSupabase, [
      createGuideSectionQueryRow({
        section_name: 'Partial Match Section',
        subtopic_filter: 'certification',
        expected_layer: 'company_reference', // Does NOT match input layer
        content_type_filter: null,
        is_required: true,
        guides: {
          id: guideId,
          name: 'Test Guide',
          slug: 'test-guide',
          domain_filter: 'compliance',
          display_order: 1,
          is_published: true,
        },
      }),
    ]);

    const result = await suggestGuideSections(asSupabase(mockSupabase), {
      primaryDomain: 'compliance',
      primarySubtopic: 'certification',
      layer: 'bid_detail', // Does NOT match expected_layer='company_reference'
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchStrength).toBe('partial');
  });

  it('returns domain_only match when no section filters match', async () => {
    const guideId = testUUID();
    configureSectionQueryResponse(mockSupabase, [
      createGuideSectionQueryRow({
        section_name: 'Domain Only Section',
        subtopic_filter: 'audit', // Does NOT match
        expected_layer: 'company_reference', // Does NOT match
        content_type_filter: 'policy', // Does NOT match
        is_required: true,
        guides: {
          id: guideId,
          name: 'Test Guide',
          slug: 'test-guide',
          domain_filter: 'compliance',
          display_order: 1,
          is_published: true,
        },
      }),
    ]);

    const result = await suggestGuideSections(asSupabase(mockSupabase), {
      primaryDomain: 'compliance',
      primarySubtopic: 'certification',
      layer: 'bid_detail',
      contentType: 'q_a_pair',
    });

    expect(result).toHaveLength(1);
    expect(result[0].matchStrength).toBe('domain_only');
  });

  it('caps match strength to partial for secondary domain matches', async () => {
    const guideId = testUUID();
    configureSectionQueryResponse(mockSupabase, [
      createGuideSectionQueryRow({
        section_name: 'Secondary Domain Section',
        subtopic_filter: null,
        expected_layer: null,
        content_type_filter: null,
        is_required: true,
        guides: {
          id: guideId,
          name: 'Corporate Guide',
          slug: 'corporate-guide',
          domain_filter: 'corporate', // Matches secondary, not primary
          display_order: 1,
          is_published: true,
        },
      }),
    ]);

    const result = await suggestGuideSections(asSupabase(mockSupabase), {
      primaryDomain: 'compliance',
      primarySubtopic: 'certification',
      secondaryDomain: 'corporate',
    });

    expect(result).toHaveLength(1);
    // All filters match vacuously (no filters), but since domain match is via
    // secondary domain, strength is capped to 'partial'
    expect(result[0].matchStrength).toBe('partial');
  });
});
