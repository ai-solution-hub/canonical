/**
 * Tests for the template-driven KB completeness matching engine.
 *
 * Covers: constants, cosineSimilarity, matchRequirement, computeTemplateCoverage,
 * (post-{131.16} re-point) fetchContentForMatching's Supabase call shape, and
 * ({130.24} DR-036) fetchTemplateRequirements' record_embeddings hydration —
 * all via the shared `createMockSupabaseTableDispatch` mock. `listAvailableTemplates`
 * remains untested here — a narrower fixed-shape read with no re-pointing
 * behaviour to verify.
 */
import { describe, it, expect } from 'vitest';
import {
  CONTENT_LENGTH_THRESHOLDS,
  SIMILARITY_STRONG_THRESHOLD,
  SIMILARITY_PARTIAL_THRESHOLD,
  QA_FRAGMENT_THRESHOLD,
  cosineSimilarity,
  matchRequirement,
  computeTemplateCoverage,
  fetchContentForMatching,
  fetchTemplateRequirements,
} from '@/lib/domains/procurement/form-templating/template-coverage';
import type {
  TemplateRequirement,
  ContentItemForMatching,
} from '@/lib/domains/procurement/form-templating/template-coverage';
import { createMockSupabaseTableDispatch } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Test helpers — factories for mock data
// ---------------------------------------------------------------------------

function makeRequirement(
  overrides: Partial<TemplateRequirement> = {},
): TemplateRequirement {
  return {
    id: 'req-1',
    template_name: 'Test Template',
    template_version: 'v1',
    template_type: 'sq',
    section_ref: 'Part 1',
    section_name: 'General',
    question_number: 1,
    requirement_text: 'Describe your health and safety policy.',
    description: 'H&S policy content',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['health and safety', 'h&s', 'safety policy'],
    matching_guidance: null,
    requirement_embedding: [0.1, 0.2, 0.3, 0.4, 0.5],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 1,
    ...overrides,
  };
}

function makeContent(
  overrides: Partial<ContentItemForMatching> = {},
): ContentItemForMatching {
  return {
    id: 'ci-1',
    content:
      'Our health and safety policy covers all aspects of workplace safety. '.repeat(
        10,
      ), // ~700 chars
    brief: null,
    detail: null,
    title: 'Health and Safety Policy',
    suggested_title: null,
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    content_type: 'policy',
    ai_keywords: ['health and safety', 'workplace safety', 'risk assessment'],
    embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // identical to requirement = similarity 1.0
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('Constants', () => {
  it('CONTENT_LENGTH_THRESHOLDS has all requirement types', () => {
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('declaration', 0);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('data', 0);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('evidence', 100);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('statement', 150);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('reference', 200);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('policy', 300);
    expect(CONTENT_LENGTH_THRESHOLDS).toHaveProperty('narrative', 500);
  });

  it('similarity thresholds are in the expected range', () => {
    expect(SIMILARITY_STRONG_THRESHOLD).toBe(0.55);
    expect(SIMILARITY_PARTIAL_THRESHOLD).toBe(0.35);
    expect(SIMILARITY_STRONG_THRESHOLD).toBeGreaterThan(
      SIMILARITY_PARTIAL_THRESHOLD,
    );
  });

  it('QA_FRAGMENT_THRESHOLD is 20', () => {
    expect(QA_FRAGMENT_THRESHOLD).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

describe('cosineSimilarity', () => {
  it('returns 1.0 for identical vectors', () => {
    const v = [1, 2, 3, 4, 5];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  it('returns 0 for null inputs', () => {
    expect(cosineSimilarity(null, [1, 2])).toBe(0);
    expect(cosineSimilarity([1, 2], null)).toBe(0);
    expect(cosineSimilarity(null, null)).toBe(0);
  });

  it('returns 0 for empty arrays', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1], [])).toBe(0);
  });

  it('returns 0 for mismatched lengths', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it('computes correct similarity for known vectors', () => {
    // cos([1,0], [1,1]) = 1 / (1 * sqrt(2)) ≈ 0.7071
    const sim = cosineSimilarity([1, 0], [1, 1]);
    expect(sim).toBeCloseTo(0.7071, 3);
  });
});

// ---------------------------------------------------------------------------
// matchRequirement — single requirement matching
// ---------------------------------------------------------------------------

describe('matchRequirement', () => {
  it('returns strong when taxonomy matches + high similarity + sufficient content', () => {
    const req = makeRequirement();
    const content = makeContent(); // matching domain, subtopic, and identical embedding
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('strong');
    expect(result.matching_content_ids).toContain('ci-1');
    expect(result.best_similarity_score).toBeCloseTo(1.0, 2);
    expect(result.content_length_met).toBe(true);
  });

  it('returns partial when taxonomy matches but content below type threshold', () => {
    const req = makeRequirement({ requirement_type: 'policy' }); // needs 300 chars
    const content = makeContent({
      content: 'Short policy.', // ~13 chars, well below 300
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // high similarity
    });
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('partial');
    expect(result.content_length_met).toBe(false);
  });

  it('returns partial when no taxonomy match but semantic > 0.35', () => {
    const refEmb = [0.1, 0.2, 0.3, 0.4, 0.5];
    // Analytically computed: ref + t*orth where t chosen so cos(ref, v) ≈ 0.45
    // (between partial threshold 0.35 and strong threshold 0.55)
    const partialEmb = [1.54, 0.2, 0.3, 0.4, 0.21];
    const actualSim = cosineSimilarity(refEmb, partialEmb);
    // Verify the crafted vector gives partial-range similarity
    expect(actualSim).toBeGreaterThan(0.35);
    expect(actualSim).toBeLessThan(0.55);

    const req = makeRequirement({ requirement_embedding: refEmb });
    const content = makeContent({
      primary_domain: 'other-domain',
      primary_subtopic: 'other-subtopic',
      ai_keywords: [],
      embedding: partialEmb,
    });
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('partial');
  });

  it('returns strong when no taxonomy match but semantic > 0.55 + sufficient content', () => {
    const refEmb = [1, 0, 0, 0, 0];
    // Create a vector very close to reference for high similarity
    const strongEmb = [0.99, 0.01, 0.01, 0.01, 0.01];

    const req = makeRequirement({
      requirement_type: 'data', // threshold = 0
      requirement_embedding: refEmb,
    });
    const content = makeContent({
      primary_domain: 'other-domain',
      primary_subtopic: 'other-subtopic',
      ai_keywords: [],
      embedding: strongEmb,
    });
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('strong');
  });

  it('considers keyword overlap when taxonomy does not match', () => {
    const req = makeRequirement({
      matching_keywords: ['safety policy', 'risk assessment'],
      requirement_embedding: null, // no embedding — semantic won't help
    });
    const content = makeContent({
      primary_domain: 'other-domain',
      primary_subtopic: 'other-subtopic',
      ai_keywords: ['safety policy', 'workplace safety'],
      embedding: null,
    });
    const result = matchRequirement(req, [content]);

    // Keyword overlap = 1 → at least partial
    expect(result.coverage_status).toBe('partial');
    expect(result.matching_content_ids).toContain('ci-1');
  });

  it('caps Q&A pairs with < 20 char content at partial', () => {
    const req = makeRequirement({ requirement_type: 'data' }); // threshold = 0
    const content = makeContent({
      content: 'Yes', // 3 chars — Q&A fragment
      content_type: 'q_a_pair',
      embedding: [0.1, 0.2, 0.3, 0.4, 0.5], // identical = similarity 1.0
    });
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('partial');
  });

  it('returns na for declaration requirement type', () => {
    const req = makeRequirement({ requirement_type: 'declaration' });
    const result = matchRequirement(req, [makeContent()]);

    expect(result.coverage_status).toBe('na');
    expect(result.matching_content_ids).toEqual([]);
  });

  it('returns gap when no matching content exists', () => {
    const req = makeRequirement({
      primary_domain: 'niche-domain',
      primary_subtopic: 'niche-subtopic',
      matching_keywords: ['extremely specific term xyz123'],
      requirement_embedding: [0.9, -0.9, 0.9, -0.9, 0.9],
    });
    const content = makeContent({
      primary_domain: 'other-domain',
      primary_subtopic: 'other-subtopic',
      ai_keywords: ['unrelated'],
      embedding: [0.1, 0.1, 0.1, 0.1, 0.1], // low similarity
    });
    const result = matchRequirement(req, [content]);

    expect(result.coverage_status).toBe('gap');
  });

  it('returns gap when content items array is empty', () => {
    const req = makeRequirement();
    const result = matchRequirement(req, []);

    expect(result.coverage_status).toBe('gap');
    expect(result.matching_content_ids).toEqual([]);
  });

  it('limits matching_content_ids to 5 items', () => {
    const refEmb = [0.1, 0.2, 0.3, 0.4, 0.5];
    const req = makeRequirement({ requirement_embedding: refEmb });

    // Create 8 content items that all match
    const items = Array.from({ length: 8 }, (_, i) =>
      makeContent({
        id: `ci-${i}`,
        embedding: refEmb, // all identical = similarity 1.0
      }),
    );

    const result = matchRequirement(req, items);
    expect(result.matching_content_ids.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// computeTemplateCoverage — full template coverage
// ---------------------------------------------------------------------------

describe('computeTemplateCoverage', () => {
  it('computes correct score for mixed coverage', () => {
    const refEmb = [0.1, 0.2, 0.3, 0.4, 0.5];
    const requirements: TemplateRequirement[] = [
      makeRequirement({
        id: 'req-strong',
        section_ref: 'Part 1',
        section_name: 'General',
        display_order: 1,
        requirement_embedding: refEmb,
      }),
      makeRequirement({
        id: 'req-gap',
        section_ref: 'Part 2',
        section_name: 'Technical',
        display_order: 2,
        primary_domain: 'niche',
        primary_subtopic: 'niche',
        matching_keywords: ['xyz123'],
        requirement_embedding: [0.9, -0.9, 0.9, -0.9, 0.9],
      }),
      makeRequirement({
        id: 'req-na',
        section_ref: 'Part 3',
        section_name: 'Declarations',
        display_order: 3,
        requirement_type: 'declaration',
      }),
    ];

    const content = [makeContent({ embedding: refEmb })];

    const result = computeTemplateCoverage(
      'Test Template',
      'v1',
      'sq',
      requirements,
      content,
    );

    expect(result.strong_count).toBe(1);
    expect(result.gap_count).toBe(1);
    expect(result.na_count).toBe(1);
    expect(result.total_requirements).toBe(3);
    // score = (1*1.0 + 0*0.5) / (3 - 1) = 1.0 / 2 = 0.5
    expect(result.score).toBeCloseTo(0.5, 3);
  });

  it('returns score 0 when all requirements are gaps', () => {
    const requirements = [
      makeRequirement({
        id: 'req-1',
        primary_domain: 'niche',
        primary_subtopic: 'niche',
        matching_keywords: ['xyz'],
        requirement_embedding: [0.9, -0.9, 0.9, -0.9, 0.9],
      }),
    ];

    const result = computeTemplateCoverage('Test', null, 'sq', requirements, [
      makeContent({
        primary_domain: 'other',
        primary_subtopic: 'other',
        ai_keywords: ['unrelated'],
        embedding: [0.1, 0.1, 0.1, 0.1, 0.1],
      }),
    ]);

    expect(result.score).toBe(0);
    expect(result.gap_count).toBe(1);
  });

  it('returns score 1.0 when all non-NA requirements are strong', () => {
    const refEmb = [0.1, 0.2, 0.3, 0.4, 0.5];
    const requirements = [
      makeRequirement({
        id: 'req-1',
        display_order: 1,
        requirement_embedding: refEmb,
      }),
      makeRequirement({
        id: 'req-2',
        display_order: 2,
        requirement_embedding: refEmb,
      }),
      makeRequirement({
        id: 'req-na',
        display_order: 3,
        requirement_type: 'declaration',
      }),
    ];

    const content = [makeContent({ embedding: refEmb })];

    const result = computeTemplateCoverage(
      'Test',
      'v1',
      'sq',
      requirements,
      content,
    );

    expect(result.score).toBe(1.0);
    expect(result.strong_count).toBe(2);
    expect(result.na_count).toBe(1);
  });

  it('groups requirements correctly by section', () => {
    const refEmb = [0.1, 0.2, 0.3, 0.4, 0.5];
    const requirements = [
      makeRequirement({
        id: 'r1',
        section_ref: 'Part 1',
        section_name: 'General',
        display_order: 1,
      }),
      makeRequirement({
        id: 'r2',
        section_ref: 'Part 1',
        section_name: 'General',
        display_order: 2,
        question_number: 2,
      }),
      makeRequirement({
        id: 'r3',
        section_ref: 'Part 2',
        section_name: 'Technical',
        display_order: 3,
      }),
    ];

    const result = computeTemplateCoverage('Test', 'v1', 'sq', requirements, [
      makeContent({ embedding: refEmb }),
    ]);

    expect(result.sections).toHaveLength(2);
    expect(result.sections[0].section_ref).toBe('Part 1');
    expect(result.sections[0].section_name).toBe('General');
    expect(result.sections[0].requirements).toHaveLength(2);
    expect(result.sections[1].section_ref).toBe('Part 2');
    expect(result.sections[1].requirements).toHaveLength(1);
  });

  it('returns score 0 when all requirements are NA (no denominator)', () => {
    const requirements = [
      makeRequirement({ id: 'r1', requirement_type: 'declaration' }),
      makeRequirement({ id: 'r2', requirement_type: 'declaration' }),
    ];

    const result = computeTemplateCoverage(
      'Test',
      'v1',
      'sq',
      requirements,
      [],
    );

    expect(result.score).toBe(0);
    expect(result.na_count).toBe(2);
    expect(result.total_requirements).toBe(2);
  });

  it('populates template metadata in the result', () => {
    const result = computeTemplateCoverage(
      'Standard Selection Questionnaire',
      'PPN 03/24',
      'sq',
      [],
      [],
    );

    expect(result.template_name).toBe('Standard Selection Questionnaire');
    expect(result.template_version).toBe('PPN 03/24');
    expect(result.template_type).toBe('sq');
  });
});

// ---------------------------------------------------------------------------
// fetchContentForMatching — re-pointed data-fetching behaviour ({131.16}
// BI-29/30/31). Verifies the function reads q_a_pairs + reference_items
// (+ record_embeddings / record_lifecycle satellites) and never touches the
// retired content_items table, and that the returned rows are shaped exactly
// as ContentItemForMatching — the shape every caller (get_template_coverage /
// get_template_gaps in lib/mcp/tools/templates.ts, the coverage/gaps and
// coverage/templates routes) feeds straight into computeTemplateCoverage.
// ---------------------------------------------------------------------------

describe('fetchContentForMatching', () => {
  it('sources content from q_a_pairs + reference_items and never queries content_items', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      q_a_pairs: {
        data: [
          {
            id: 'qa-1',
            question_text: 'What is your safety policy?',
            answer_standard: 'We maintain ISO 45001 certification.',
            answer_advanced: null,
          },
        ],
        error: null,
      },
      reference_items: {
        data: [
          {
            id: 'ri-1',
            title: 'Safety Policy Document',
            body: 'Full text of the safety policy.',
            summary: 'Summary of the safety policy.',
            primary_domain: 'compliance',
            primary_subtopic: 'health-and-safety',
          },
        ],
        error: null,
      },
      record_embeddings: {
        data: [
          // Stored as a JSON string on some rows, a parsed array on others —
          // fetchContentForMatching must handle both (mirrors the pgvector
          // string-or-array duality already handled for requirement_embedding).
          { owner_id: 'qa-1', embedding: '[0.1,0.2,0.3]' },
          { owner_id: 'ri-1', embedding: [0.4, 0.5, 0.6] },
        ],
        error: null,
      },
      record_lifecycle: {
        data: [{ owner_id: 'qa-1', domain: 'compliance' }],
        error: null,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
    const result = await fetchContentForMatching(dispatch as any);

    expect(result).toHaveLength(2);

    const qaItem = result.find((r) => r.id === 'qa-1');
    expect(qaItem).toEqual<ContentItemForMatching>({
      id: 'qa-1',
      content:
        'Q: What is your safety policy?\n\nWe maintain ISO 45001 certification.',
      brief: null,
      detail: null,
      title: 'What is your safety policy?',
      suggested_title: null,
      primary_domain: 'compliance',
      primary_subtopic: null,
      content_type: 'q_a_pair',
      ai_keywords: null,
      embedding: [0.1, 0.2, 0.3],
    });

    const riItem = result.find((r) => r.id === 'ri-1');
    expect(riItem).toEqual<ContentItemForMatching>({
      id: 'ri-1',
      content: 'Full text of the safety policy.',
      brief: null,
      detail: null,
      title: 'Safety Policy Document',
      suggested_title: null,
      primary_domain: 'compliance',
      primary_subtopic: 'health-and-safety',
      content_type: 'reference_item',
      ai_keywords: null,
      embedding: [0.4, 0.5, 0.6],
    });

    // The retired content_items table must never be queried.
    expect(dispatch.from).not.toHaveBeenCalledWith('content_items');

    // The re-pointed sources + satellites ARE queried.
    expect(dispatch.from).toHaveBeenCalledWith('q_a_pairs');
    expect(dispatch.from).toHaveBeenCalledWith('reference_items');
    expect(dispatch.from).toHaveBeenCalledWith('record_embeddings');
    expect(dispatch.from).toHaveBeenCalledWith('record_lifecycle');

    // Archived q_a_pairs are excluded (closest surviving analogue of the
    // dropped content_items.archived_at IMS flag — BI-29/30 note).
    expect(dispatch._chains.q_a_pairs.neq).toHaveBeenCalledWith(
      'publication_status',
      'archived',
    );

    // record_embeddings is scoped to the polymorphic owner_kind pair + model.
    expect(dispatch._chains.record_embeddings.in).toHaveBeenCalledWith(
      'owner_kind',
      ['q_a_pair', 'reference_item'],
    );
    expect(dispatch._chains.record_embeddings.eq).toHaveBeenCalledWith(
      'model',
      'text-embedding-3-large',
    );
  });

  it('returns an empty array and skips the embeddings fetch when no q_a_pairs/reference_items exist (BI-30 blank-form fork)', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      q_a_pairs: { data: [], error: null },
      reference_items: { data: [], error: null },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
    const result = await fetchContentForMatching(dispatch as any);

    expect(result).toEqual([]);
    // Short-circuits before the embeddings satellite fetch — a blank form
    // instrument correctly reports zero matchable content, not an error.
    expect(dispatch.from).not.toHaveBeenCalledWith('record_embeddings');
  });

  it('throws a descriptive error when the q_a_pairs query fails', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      q_a_pairs: { data: null, error: { message: 'connection reset' } },
      reference_items: { data: [], error: null },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
    await expect(fetchContentForMatching(dispatch as any)).rejects.toThrow(
      /Failed to fetch q_a_pairs for matching/,
    );
  });
});

// ---------------------------------------------------------------------------
// fetchTemplateRequirements — record_embeddings hydration ({130.24} DR-036).
// Verifies requirement_embedding is hydrated from the polymorphic
// record_embeddings store (owner_kind='form_template_requirement'), not the
// (now-dropped) inline column, mirroring fetchContentForMatching's pattern.
// ---------------------------------------------------------------------------

describe('fetchTemplateRequirements', () => {
  it('hydrates requirement_embedding from record_embeddings, keyed by row id', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      form_template_requirements: {
        data: [
          {
            id: 'req-1',
            template_name: 'Standard SQ',
            template_version: 'PPN 03/24',
            template_type: 'sq',
            section_ref: 'Part 1',
            section_name: 'General',
            question_number: 1,
            requirement_text: 'Describe your safety policy.',
            description: null,
            requirement_type: 'policy',
            primary_domain: 'compliance',
            primary_subtopic: 'health-and-safety',
            secondary_domain: null,
            secondary_subtopic: null,
            matching_keywords: ['safety'],
            matching_guidance: null,
            is_mandatory: true,
            sector_applicability: null,
            word_limit_guidance: null,
            display_order: 1,
          },
          {
            id: 'req-2',
            template_name: 'Standard SQ',
            template_version: 'PPN 03/24',
            template_type: 'sq',
            section_ref: 'Part 1',
            section_name: 'General',
            question_number: 2,
            requirement_text: 'Company registration number.',
            description: null,
            requirement_type: 'data',
            primary_domain: null,
            primary_subtopic: null,
            secondary_domain: null,
            secondary_subtopic: null,
            matching_keywords: [],
            matching_guidance: null,
            is_mandatory: true,
            sector_applicability: null,
            word_limit_guidance: null,
            display_order: 2,
          },
        ],
        error: null,
      },
      record_embeddings: {
        // Stored as a JSON string on one row, a parsed array on the other —
        // fetchTemplateRequirements must handle both (mirrors the
        // pgvector string-or-array duality fetchContentForMatching handles).
        data: [{ owner_id: 'req-1', embedding: '[0.1,0.2,0.3]' }],
        error: null,
      },
    });

    const result = await fetchTemplateRequirements(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
      dispatch as any,
      'Standard SQ',
    );

    expect(result).toHaveLength(2);
    const req1 = result.find((r) => r.id === 'req-1');
    expect(req1?.requirement_embedding).toEqual([0.1, 0.2, 0.3]);
    // req-2 has no record_embeddings row — hydrates to null, not an error.
    const req2 = result.find((r) => r.id === 'req-2');
    expect(req2?.requirement_embedding).toBeNull();

    expect(dispatch.from).toHaveBeenCalledWith('record_embeddings');
    expect(dispatch._chains.record_embeddings.eq).toHaveBeenCalledWith(
      'owner_kind',
      'form_template_requirement',
    );
    expect(dispatch._chains.record_embeddings.in).toHaveBeenCalledWith(
      'owner_id',
      ['req-1', 'req-2'],
    );
    expect(dispatch._chains.record_embeddings.eq).toHaveBeenCalledWith(
      'model',
      'text-embedding-3-large',
    );
  });

  it('skips the record_embeddings fetch when the template has no requirements', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      form_template_requirements: { data: [], error: null },
    });

    const result = await fetchTemplateRequirements(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
      dispatch as any,
      'Empty Template',
    );

    expect(result).toEqual([]);
    expect(dispatch.from).not.toHaveBeenCalledWith('record_embeddings');
  });

  it('throws a descriptive error when the record_embeddings query fails', async () => {
    const dispatch = createMockSupabaseTableDispatch({
      form_template_requirements: {
        data: [
          {
            id: 'req-1',
            template_name: 'Standard SQ',
            template_version: 'PPN 03/24',
            template_type: 'sq',
            section_ref: 'Part 1',
            section_name: 'General',
            question_number: 1,
            requirement_text: 'Describe your safety policy.',
            description: null,
            requirement_type: 'policy',
            primary_domain: null,
            primary_subtopic: null,
            secondary_domain: null,
            secondary_subtopic: null,
            matching_keywords: [],
            matching_guidance: null,
            is_mandatory: true,
            sector_applicability: null,
            word_limit_guidance: null,
            display_order: 1,
          },
        ],
        error: null,
      },
      record_embeddings: { data: null, error: { message: 'connection reset' } },
    });

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mock dispatch client requires flexible typing
      fetchTemplateRequirements(dispatch as any, 'Standard SQ'),
    ).rejects.toThrow(/Failed to fetch record_embeddings/);
  });
});
