/**
 * Unit tests for intelligence guide auto-creation.
 *
 * Tests the createIntelligenceGuide() function which generates a guide
 * with sections derived from a company profile when an intelligence
 * workspace is created.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntelligenceGuide } from '@/lib/intelligence/guide-generator';
import type { CompanyProfile } from '@/lib/intelligence/guide-generator';

// ---------------------------------------------------------------------------
// Mock Supabase client
// ---------------------------------------------------------------------------

function createMockChain() {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'insert', 'update', 'delete', 'eq', 'single'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnThis();
  }
  // Default: single() resolves to null
  chain.single.mockResolvedValue({ data: null, error: null });
  return chain;
}

function createMockSupabase() {
  const chains: Record<string, ReturnType<typeof createMockChain>> = {};
  let currentTable = '';

  const supabase = {
    from: vi.fn((table: string) => {
      currentTable = table;
      if (!chains[table]) {
        chains[table] = createMockChain();
      }
      return chains[table];
    }),
    _chains: chains,
    _getCurrentTable: () => currentTable,
  };

  return supabase;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const GUIDE_ID = 'f1e2d3c4-b5a6-4978-8d0e-1f2a3b4c5d6e';
const USER_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const FULL_PROFILE: CompanyProfile = {
  id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
  name: 'example-client Design',
  sectors: ['Education', 'Health & Social Care'],
  services: ['Curriculum Design', 'Safeguarding Training'],
  key_topics: ['KCSIE', 'Ofsted'],
};

const MINIMAL_PROFILE: CompanyProfile = {
  id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
  name: 'Minimal Co',
  sectors: [],
  services: [],
  key_topics: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createIntelligenceGuide', () => {
  let mockSupabase: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabase();
  });

  // Helper to configure a successful guide insert
  function configureGuideInsertSuccess(guideId = GUIDE_ID) {
    const guidesChain = createMockChain();
    guidesChain.insert.mockReturnThis();
    guidesChain.select.mockReturnThis();
    guidesChain.single.mockResolvedValueOnce({
      data: { id: guideId },
      error: null,
    });
    mockSupabase._chains['guides'] = guidesChain;
    return guidesChain;
  }

  // Helper to configure a successful section insert
  function configureSectionInsertSuccess() {
    const sectionsChain = createMockChain();
    // insert() resolves directly (no .single())
    sectionsChain.insert.mockResolvedValueOnce({ data: [], error: null });
    mockSupabase._chains['guide_sections'] = sectionsChain;
    return sectionsChain;
  }

  it('creates a guide with correct name, slug, and type', async () => {
    const guidesChain = configureGuideInsertSuccess();
    configureSectionInsertSuccess();

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.guideId).toBe(GUIDE_ID);

    // Verify guide insert was called with correct payload
    const insertCall = guidesChain.insert.mock.calls[0][0];
    expect(insertCall.name).toBe('Education Watch Intelligence Guide');
    expect(insertCall.slug).toBe('intelligence-education-watch');
    expect(insertCall.guide_type).toBe('research');
    expect(insertCall.is_published).toBe(true);
    expect(insertCall.created_by).toBe(USER_ID);
  });

  it('creates sections: one per sector, one per key topic, plus Research Feed', async () => {
    configureGuideInsertSuccess();
    const sectionsChain = configureSectionInsertSuccess();

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // 2 sectors + 2 key topics + 1 Research Feed = 5
    expect(result!.sectionCount).toBe(5);

    const insertedSections = sectionsChain.insert.mock.calls[0][0];
    expect(insertedSections).toHaveLength(5);

    // Sector sections (required)
    expect(insertedSections[0].section_name).toBe('Education');
    expect(insertedSections[0].is_required).toBe(true);
    expect(insertedSections[0].content_type_filter).toBe('article');
    expect(insertedSections[1].section_name).toBe('Health & Social Care');
    expect(insertedSections[1].is_required).toBe(true);

    // Key topic sections (optional)
    expect(insertedSections[2].section_name).toBe('KCSIE');
    expect(insertedSections[2].is_required).toBe(false);
    expect(insertedSections[3].section_name).toBe('Ofsted');
    expect(insertedSections[3].is_required).toBe(false);

    // Research Feed catch-all
    expect(insertedSections[4].section_name).toBe('Research Feed');
    expect(insertedSections[4].is_required).toBe(false);
    expect(insertedSections[4].content_type_filter).toBeNull();
  });

  it('assigns sequential display_order to sections', async () => {
    configureGuideInsertSuccess();
    const sectionsChain = configureSectionInsertSuccess();

    await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const insertedSections = sectionsChain.insert.mock.calls[0][0];
    const orders = insertedSections.map(
      (s: { display_order: number }) => s.display_order,
    );
    expect(orders).toEqual([1, 2, 3, 4, 5]);
  });

  it('generates correct slug from workspace name', async () => {
    configureGuideInsertSuccess();
    configureSectionInsertSuccess();

    await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'My Complex & Special Workspace!',
      FULL_PROFILE,
      USER_ID,
    );

    const guidesChain = mockSupabase._chains['guides'];
    const insertCall = guidesChain.insert.mock.calls[0][0];
    expect(insertCall.slug).toBe('intelligence-my-complex-special-workspace');
  });

  it('retries with workspace ID fragment on slug conflict', async () => {
    // First insert fails (slug conflict)
    const guidesChain = createMockChain();
    guidesChain.insert.mockReturnThis();
    guidesChain.select.mockReturnThis();
    guidesChain.single
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: 'duplicate key value violates unique constraint',
          code: '23505',
        },
      })
      .mockResolvedValueOnce({
        data: { id: GUIDE_ID },
        error: null,
      });
    // delete chain for potential cleanup
    guidesChain.delete.mockReturnThis();
    guidesChain.eq.mockReturnThis();
    mockSupabase._chains['guides'] = guidesChain;

    configureSectionInsertSuccess();

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.guideId).toBe(GUIDE_ID);

    // Should have called insert twice
    expect(guidesChain.insert).toHaveBeenCalledTimes(2);

    // Second insert should use fallback slug with workspace ID fragment
    const secondInsert = guidesChain.insert.mock.calls[1][0];
    expect(secondInsert.slug).toBe(
      `intelligence-education-watch-${WORKSPACE_ID.slice(0, 8)}`,
    );
  });

  it('returns null if both guide insert attempts fail', async () => {
    const guidesChain = createMockChain();
    guidesChain.insert.mockReturnThis();
    guidesChain.select.mockReturnThis();
    guidesChain.single
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'duplicate key' },
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'duplicate key again' },
      });
    mockSupabase._chains['guides'] = guidesChain;

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).toBeNull();
  });

  it('cleans up guide when section insert fails', async () => {
    const guidesChain = configureGuideInsertSuccess();
    // Override delete chain to track calls
    guidesChain.delete.mockReturnThis();
    guidesChain.eq.mockResolvedValueOnce({ data: null, error: null });

    // Section insert fails
    const sectionsChain = createMockChain();
    sectionsChain.insert.mockResolvedValueOnce({
      data: null,
      error: { message: 'section insert failed' },
    });
    mockSupabase._chains['guide_sections'] = sectionsChain;

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).toBeNull();

    // Should have tried to delete the guide
    expect(guidesChain.delete).toHaveBeenCalled();
  });

  it('handles profile with no sectors or key topics (only Research Feed)', async () => {
    configureGuideInsertSuccess();
    const sectionsChain = configureSectionInsertSuccess();

    const result = await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Minimal Workspace',
      MINIMAL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.sectionCount).toBe(1);

    const insertedSections = sectionsChain.insert.mock.calls[0][0];
    expect(insertedSections).toHaveLength(1);
    expect(insertedSections[0].section_name).toBe('Research Feed');
  });

  it('sets guide description with company profile name', async () => {
    const guidesChain = configureGuideInsertSuccess();
    configureSectionInsertSuccess();

    await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const insertCall = guidesChain.insert.mock.calls[0][0];
    expect(insertCall.description).toContain('example-client Design');
  });

  it('sets all section expected_layer to research', async () => {
    configureGuideInsertSuccess();
    const sectionsChain = configureSectionInsertSuccess();

    await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const insertedSections = sectionsChain.insert.mock.calls[0][0];
    for (const section of insertedSections) {
      expect(section.expected_layer).toBe('research');
    }
  });

  it('sets all section guide_id to the created guide', async () => {
    configureGuideInsertSuccess();
    const sectionsChain = configureSectionInsertSuccess();

    await createIntelligenceGuide(
      mockSupabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const insertedSections = sectionsChain.insert.mock.calls[0][0];
    for (const section of insertedSections) {
      expect(section.guide_id).toBe(GUIDE_ID);
    }
  });
});
