/**
 * Unit tests for intelligence guide auto-creation.
 *
 * Tests the createIntelligenceGuide() function which generates a
 * hierarchical guide with sections derived from a company profile when
 * an intelligence workspace is created.
 *
 * The generator uses a two-pass approach:
 *   Pass 1: Insert sector parent sections (top-level)
 *   Pass 2: Insert topic child sections nested under their parent sector
 *           (where a mapping exists) plus the Research Feed catch-all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createIntelligenceGuide } from '@/lib/intelligence/guide-generator';
import type { CompanyProfile } from '@/lib/intelligence/guide-generator';

// ---------------------------------------------------------------------------
// Mock Supabase client — supports two-pass section inserts
// ---------------------------------------------------------------------------

const EDUCATION_SECTION_ID = 'e1e1e1e1-aaaa-4bbb-8ccc-dddddddddd01';
const HEALTH_SECTION_ID = 'e1e1e1e1-aaaa-4bbb-8ccc-dddddddddd02';

/** Track insert calls across the guide_sections table */
interface SectionInsertCall {
  rows: Array<Record<string, unknown>>;
}

function createMockSupabase() {
  const guideSectionInsertCalls: SectionInsertCall[] = [];
  let sectorInsertIndex = 0;

  // Sector UUIDs returned by Pass 1 (keyed by section_name)
  const sectorIdLookup: Record<string, string> = {
    Education: EDUCATION_SECTION_ID,
    'Health & Social Care': HEALTH_SECTION_ID,
  };

  // --- guides table chain ---
  let guidesInsertCount = 0;
  const guidesInsertResults: Array<{
    data: unknown;
    error: unknown;
  }> = [];

  const guidesChain = {
    insert: vi.fn().mockImplementation(() => guidesChain),
    select: vi.fn().mockImplementation(() => guidesChain),
    single: vi.fn().mockImplementation(() => {
      const idx = guidesInsertCount++;
      if (idx < guidesInsertResults.length) return guidesInsertResults[idx];
      return { data: null, error: { message: 'unexpected call' } };
    }),
    delete: vi.fn().mockImplementation(() => guidesChain),
    eq: vi.fn().mockImplementation(() => guidesChain),
  };

  // --- guide_sections table chain ---
  // Supports two insert calls: pass 1 (sectors) returns data with IDs,
  // pass 2 (topics + catch-all) returns success with no data.
  let sectionInsertFail = false;
  let sectionInsertFailOnPass: 1 | 2 | null = null;

  const sectionsChain = {
    insert: vi.fn().mockImplementation((rows: unknown[]) => {
      const call: SectionInsertCall = {
        rows: rows as Array<Record<string, unknown>>,
      };
      guideSectionInsertCalls.push(call);
      const passNumber = guideSectionInsertCalls.length;

      if (sectionInsertFail || sectionInsertFailOnPass === passNumber) {
        return {
          select: vi.fn().mockReturnValue({
            data: null,
            error: { message: 'section insert failed' },
          }),
          data: null,
          error: { message: 'section insert failed' },
        };
      }

      if (passNumber === 1) {
        // Pass 1: sector insert — returns with .select('id, section_name')
        const insertedData = (rows as Array<Record<string, unknown>>).map(
          (r) => ({
            id:
              sectorIdLookup[r.section_name as string] ??
              `auto-${sectorInsertIndex++}`,
            section_name: r.section_name,
          }),
        );
        return {
          select: vi.fn().mockReturnValue({
            data: insertedData,
            error: null,
          }),
          data: insertedData,
          error: null,
        };
      }

      // Pass 2: topic + catch-all insert — no .select()
      return { data: [], error: null };
    }),
  };

  const supabase = {
    from: vi.fn((table: string) => {
      if (table === 'guides') return guidesChain;
      if (table === 'guide_sections') return sectionsChain;
      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    supabase,
    guidesChain,
    sectionsChain,
    guideSectionInsertCalls,
    guidesInsertResults,
    /** Make the next section insert fail */
    failSectionInsert: () => {
      sectionInsertFail = true;
    },
    /** Fail only a specific pass (1 = sectors, 2 = topics) */
    failSectionInsertOnPass: (pass: 1 | 2) => {
      sectionInsertFailOnPass = pass;
    },
  };
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const GUIDE_ID = 'f1e2d3c4-b5a6-4978-8d0e-1f2a3b4c5d6e';
const USER_ID = 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f';

const FULL_PROFILE: CompanyProfile = {
  id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
  name: 'Example Client',
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

// Profile with topics that have no matching sector
const ORPHAN_TOPICS_PROFILE: CompanyProfile = {
  id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
  name: 'Orphan Topics Co',
  sectors: ['Education'],
  services: [],
  key_topics: ['KCSIE', 'Unmapped Topic', 'Another Unknown'],
};

// Profile with sectors only (no topics)
const SECTORS_ONLY_PROFILE: CompanyProfile = {
  id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
  name: 'Sectors Only Co',
  sectors: ['Education', 'Health & Social Care'],
  services: [],
  key_topics: [],
};

// ---------------------------------------------------------------------------
// Helper to configure guide insert success
// ---------------------------------------------------------------------------

function configureGuideSuccess(
  mock: ReturnType<typeof createMockSupabase>,
  guideId = GUIDE_ID,
) {
  mock.guidesInsertResults.push({ data: { id: guideId }, error: null });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createIntelligenceGuide', () => {
  let mock: ReturnType<typeof createMockSupabase>;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = createMockSupabase();
  });

  // -----------------------------------------------------------------------
  // Guide creation basics (unchanged from flat)
  // -----------------------------------------------------------------------

  it('creates a guide with correct name, slug, and type', async () => {
    configureGuideSuccess(mock);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.guideId).toBe(GUIDE_ID);

    const insertCall = mock.guidesChain.insert.mock.calls[0][0];
    expect(insertCall.name).toBe('Education Watch Intelligence Guide');
    expect(insertCall.slug).toBe('intelligence-education-watch');
    expect(insertCall.guide_type).toBe('research');
    expect(insertCall.is_published).toBe(true);
    expect(insertCall.created_by).toBe(USER_ID);
  });

  it('generates correct slug from workspace name', async () => {
    configureGuideSuccess(mock);

    await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'My Complex & Special Workspace!',
      FULL_PROFILE,
      USER_ID,
    );

    const insertCall = mock.guidesChain.insert.mock.calls[0][0];
    expect(insertCall.slug).toBe('intelligence-my-complex-special-workspace');
  });

  it('retries with workspace ID fragment on slug conflict', async () => {
    // First fails, second succeeds
    mock.guidesInsertResults.push({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint',
        code: '23505',
      },
    });
    mock.guidesInsertResults.push({ data: { id: GUIDE_ID }, error: null });

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.guideId).toBe(GUIDE_ID);
    expect(mock.guidesChain.insert).toHaveBeenCalledTimes(2);

    const secondInsert = mock.guidesChain.insert.mock.calls[1][0];
    expect(secondInsert.slug).toBe(
      `intelligence-education-watch-${WORKSPACE_ID.slice(0, 8)}`,
    );
  });

  it('returns null if both guide insert attempts fail', async () => {
    mock.guidesInsertResults.push({
      data: null,
      error: { message: 'duplicate key' },
    });
    mock.guidesInsertResults.push({
      data: null,
      error: { message: 'duplicate key again' },
    });

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).toBeNull();
  });

  it('sets guide description with company profile name', async () => {
    configureGuideSuccess(mock);

    await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const insertCall = mock.guidesChain.insert.mock.calls[0][0];
    expect(insertCall.description).toContain('Example Client');
  });

  // -----------------------------------------------------------------------
  // Hierarchical structure — sectors with nested topics
  // -----------------------------------------------------------------------

  it('creates sectors as top-level sections and topics nested under them', async () => {
    configureGuideSuccess(mock);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // 2 sectors + 2 topics + 1 Research Feed = 5
    expect(result!.sectionCount).toBe(5);

    // Two insert calls to guide_sections: pass 1 (sectors), pass 2 (topics + catch-all)
    expect(mock.guideSectionInsertCalls).toHaveLength(2);

    // Pass 1: sector parent sections
    const sectorRows = mock.guideSectionInsertCalls[0].rows;
    expect(sectorRows).toHaveLength(2);
    expect(sectorRows[0].section_name).toBe('Education');
    expect(sectorRows[0].is_required).toBe(true);
    expect(sectorRows[0].parent_section_id).toBeNull();
    expect(sectorRows[1].section_name).toBe('Health & Social Care');
    expect(sectorRows[1].is_required).toBe(true);
    expect(sectorRows[1].parent_section_id).toBeNull();

    // Pass 2: topic sections + Research Feed
    const topicRows = mock.guideSectionInsertCalls[1].rows;
    expect(topicRows).toHaveLength(3);

    // KCSIE -> Education (nested)
    expect(topicRows[0].section_name).toBe('KCSIE');
    expect(topicRows[0].parent_section_id).toBe(EDUCATION_SECTION_ID);
    expect(topicRows[0].is_required).toBe(false);

    // Ofsted -> Education (nested)
    expect(topicRows[1].section_name).toBe('Ofsted');
    expect(topicRows[1].parent_section_id).toBe(EDUCATION_SECTION_ID);
    expect(topicRows[1].is_required).toBe(false);

    // Research Feed (top-level)
    expect(topicRows[2].section_name).toBe('Research Feed');
    expect(topicRows[2].parent_section_id).toBeNull();
    expect(topicRows[2].content_type_filter).toBeNull();
  });

  it('assigns sequential display_order across both passes', async () => {
    configureGuideSuccess(mock);

    await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    const sectorOrders = mock.guideSectionInsertCalls[0].rows.map(
      (s) => s.display_order,
    );
    const topicOrders = mock.guideSectionInsertCalls[1].rows.map(
      (s) => s.display_order,
    );

    // Sectors first, then topics, then Research Feed
    expect([...sectorOrders, ...topicOrders]).toEqual([1, 2, 3, 4, 5]);
  });

  // -----------------------------------------------------------------------
  // Topics with no matching sector remain top-level
  // -----------------------------------------------------------------------

  it('leaves unmapped topics at top level (parent_section_id = null)', async () => {
    configureGuideSuccess(mock);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Orphan Test',
      ORPHAN_TOPICS_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // 1 sector + 3 topics + 1 Research Feed = 5
    expect(result!.sectionCount).toBe(5);

    const topicRows = mock.guideSectionInsertCalls[1].rows;
    expect(topicRows).toHaveLength(4); // 3 topics + Research Feed

    // KCSIE -> Education (mapped)
    expect(topicRows[0].section_name).toBe('KCSIE');
    expect(topicRows[0].parent_section_id).toBe(EDUCATION_SECTION_ID);

    // Unmapped Topic -> top-level
    expect(topicRows[1].section_name).toBe('Unmapped Topic');
    expect(topicRows[1].parent_section_id).toBeNull();

    // Another Unknown -> top-level
    expect(topicRows[2].section_name).toBe('Another Unknown');
    expect(topicRows[2].parent_section_id).toBeNull();
  });

  // -----------------------------------------------------------------------
  // Sectors with no topics — parents only
  // -----------------------------------------------------------------------

  it('creates sector sections even when no topics exist', async () => {
    configureGuideSuccess(mock);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Sectors Only',
      SECTORS_ONLY_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // 2 sectors + 0 topics + 1 Research Feed = 3
    expect(result!.sectionCount).toBe(3);

    // Pass 1: sectors
    const sectorRows = mock.guideSectionInsertCalls[0].rows;
    expect(sectorRows).toHaveLength(2);

    // Pass 2: only Research Feed
    const topicRows = mock.guideSectionInsertCalls[1].rows;
    expect(topicRows).toHaveLength(1);
    expect(topicRows[0].section_name).toBe('Research Feed');
  });

  // -----------------------------------------------------------------------
  // Research Feed always present and top-level
  // -----------------------------------------------------------------------

  it('always creates Research Feed at top level', async () => {
    configureGuideSuccess(mock);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Minimal Workspace',
      MINIMAL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    expect(result!.sectionCount).toBe(1);

    // No sectors, so only one insert call (pass 2 with just Research Feed)
    expect(mock.guideSectionInsertCalls).toHaveLength(1);
    const rows = mock.guideSectionInsertCalls[0].rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].section_name).toBe('Research Feed');
    expect(rows[0].parent_section_id).toBeNull();
    expect(rows[0].is_required).toBe(false);
  });

  // -----------------------------------------------------------------------
  // All sections have expected_layer = 'research'
  // -----------------------------------------------------------------------

  it('sets all section expected_layer to research', async () => {
    configureGuideSuccess(mock);

    await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    for (const call of mock.guideSectionInsertCalls) {
      for (const section of call.rows) {
        expect(section.expected_layer).toBe('research');
      }
    }
  });

  // -----------------------------------------------------------------------
  // All sections reference the correct guide
  // -----------------------------------------------------------------------

  it('sets all section guide_id to the created guide', async () => {
    configureGuideSuccess(mock);

    await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    for (const call of mock.guideSectionInsertCalls) {
      for (const section of call.rows) {
        expect(section.guide_id).toBe(GUIDE_ID);
      }
    }
  });

  // -----------------------------------------------------------------------
  // Error handling — cleanup on section insert failure
  // -----------------------------------------------------------------------

  it('cleans up guide when sector insert fails (pass 1)', async () => {
    configureGuideSuccess(mock);
    mock.failSectionInsertOnPass(1);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).toBeNull();
    expect(mock.guidesChain.delete).toHaveBeenCalled();
  });

  it('cleans up guide when topic insert fails (pass 2)', async () => {
    configureGuideSuccess(mock);
    mock.failSectionInsertOnPass(2);

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Education Watch',
      FULL_PROFILE,
      USER_ID,
    );

    expect(result).toBeNull();
    expect(mock.guidesChain.delete).toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // SS2.1.1-01: Hierarchical sections with cross-sector topic mapping
  // -----------------------------------------------------------------------

  it('nests topics under their mapped sectors across multiple sectors', async () => {
    configureGuideSuccess(mock);

    // Profile with topics from both Education and H&SC sectors
    const crossSectorProfile: CompanyProfile = {
      id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
      name: 'Cross Sector Co',
      sectors: ['Education', 'Health & Social Care'],
      services: [],
      key_topics: ['KCSIE', 'Ofsted', 'CQC'],
    };

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Cross Sector Watch',
      crossSectorProfile,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // 2 sectors + 3 topics + 1 Research Feed = 6
    expect(result!.sectionCount).toBe(6);

    // Verify guide_sections was called multiple times for inserts
    expect(mock.guideSectionInsertCalls.length).toBeGreaterThanOrEqual(2);

    // Pass 2: topic sections
    const topicRows = mock.guideSectionInsertCalls[1].rows;

    // KCSIE nested under Education
    const kcsieRow = topicRows.find((r) => r.section_name === 'KCSIE');
    expect(kcsieRow).toBeDefined();
    expect(kcsieRow!.parent_section_id).toBe(EDUCATION_SECTION_ID);

    // Ofsted nested under Education
    const ofstedRow = topicRows.find((r) => r.section_name === 'Ofsted');
    expect(ofstedRow).toBeDefined();
    expect(ofstedRow!.parent_section_id).toBe(EDUCATION_SECTION_ID);

    // CQC nested under Health & Social Care
    const cqcRow = topicRows.find((r) => r.section_name === 'CQC');
    expect(cqcRow).toBeDefined();
    expect(cqcRow!.parent_section_id).toBe(HEALTH_SECTION_ID);
  });

  // -----------------------------------------------------------------------
  // SS2.1.1-03: Slug conflict handling (two insert attempts)
  // -----------------------------------------------------------------------

  it('makes exactly two guide insert attempts on slug conflict', async () => {
    // First fails with 23505, second succeeds
    mock.guidesInsertResults.push({
      data: null,
      error: {
        message: 'duplicate key value violates unique constraint',
        code: '23505',
      },
    });
    mock.guidesInsertResults.push({ data: { id: GUIDE_ID }, error: null });

    const result = await createIntelligenceGuide(
      mock.supabase as never,
      WORKSPACE_ID,
      'Conflict Test',
      MINIMAL_PROFILE,
      USER_ID,
    );

    expect(result).not.toBeNull();
    // Verify exactly two guide insert attempts were made
    expect(mock.guidesChain.insert).toHaveBeenCalledTimes(2);
  });
});
