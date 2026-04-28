/**
 * Integration test for the three-pass bid drafting pipeline.
 *
 * Tests the full flow: analyseQuestion → draftResponse → checkResponseQuality
 * via runDraftingPipeline(), with mocked Anthropic API responses.
 *
 * This test validates the orchestration logic, data flow between passes,
 * token/cost accumulation, metadata assembly, and citation extraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock variables (hoisted) ───────────────────────────────────────────────

const { mockCreate, mockLoadSkill } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockLoadSkill: vi.fn(),
}));

// ─── Module mocks ───────────────────────────────────────────────────────────

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn(() => ({
    messages: {
      create: mockCreate,
    },
  })),
  getModelForTier: vi.fn((tier: string) => {
    const map: Record<string, string> = {
      analysis: 'claude-sonnet-4-5',
      drafting: 'claude-opus-4-6',
      quality: 'claude-haiku-4-5',
    };
    return map[tier] ?? 'claude-sonnet-4-5';
  }),
  estimateCost: vi.fn(
    (model: string, usage: { input_tokens: number; output_tokens: number }) => {
      // Simplified cost for testing — just return a non-zero value
      return (usage.input_tokens + usage.output_tokens) * 0.00001;
    },
  ),
}));

vi.mock('@/lib/ai/skills/loader', () => ({
  loadSkill: mockLoadSkill,
}));

// ─── Import AFTER mocks ────────────────────────────────────────────────────

import {
  analyseQuestion,
  draftResponse,
  runDraftingPipeline,
  type DraftableQuestion,
  type DraftableContent,
  type QuestionAnalysis,
} from '@/lib/ai/draft';
import { runDeterministicChecks } from '@/lib/ai/quality-check';

// ─── Test fixtures ──────────────────────────────────────────────────────────

const testQuestion: DraftableQuestion = {
  id: 'q-001',
  question_text: 'Describe your approach to data security and GDPR compliance.',
  word_limit: 500,
  section_name: 'Technical Capability',
  confidence_posture: 'strong',
};

const testContent: DraftableContent[] = [
  {
    id: 'c-001',
    title: 'Data Security Policy',
    content:
      '<p>We implement ISO 27001 controls across all systems. Data is encrypted at rest and in transit using AES-256.</p>',
    content_type: 'policy',
    summary:
      'Comprehensive data security policy covering ISO 27001, encryption, and access controls.',
  },
  {
    id: 'c-002',
    title: 'GDPR Compliance Framework',
    content:
      '<p>Our GDPR framework includes data mapping, DPIAs, and a dedicated Data Protection Officer.</p>',
    content_type: 'article',
    summary:
      'GDPR compliance framework with data mapping, impact assessments, and DPO.',
  },
];

/** Build a mock Anthropic API response for structured output (Pass 1 / Pass 3) */
function mockStructuredResponse(
  jsonContent: object,
  inputTokens = 200,
  outputTokens = 100,
) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(jsonContent),
      },
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

/** Build a mock Anthropic API response with search result citations (Pass 2) */
function mockCitedResponse(
  text: string,
  citations: Array<{
    source: string;
    title: string;
    cited_text: string;
    search_result_index: number;
  }>,
  inputTokens = 1000,
  outputTokens = 500,
) {
  return {
    content: [
      {
        type: 'text',
        text,
        citations: citations.map((c) => ({
          type: 'search_result_location',
          source: c.source,
          title: c.title,
          cited_text: c.cited_text,
          search_result_index: c.search_result_index,
          start_block_index: 0,
          end_block_index: 0,
        })),
      },
    ],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

const defaultAnalysis: QuestionAnalysis = {
  primary_topic: 'Data security and GDPR',
  content_types_needed: ['policy', 'article'],
  response_structure: {
    suggested_headings: [
      'Introduction',
      'Data Security',
      'GDPR Compliance',
      'Conclusion',
    ],
    word_allocation: [
      { heading: 'Introduction', words: 50 },
      { heading: 'Data Security', words: 200 },
      { heading: 'GDPR Compliance', words: 200 },
      { heading: 'Conclusion', words: 50 },
    ],
  },
  key_points_to_cover: ['ISO 27001', 'Encryption', 'Data mapping', 'DPO'],
  tone: 'formal',
};

const defaultQualityResult = {
  unsupported_claims: [],
  suggestions: ['Consider adding a specific case study example'],
  overall_score: 85,
};

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Skills throw by default (simulating missing files) — the pipeline handles this gracefully
  mockLoadSkill.mockRejectedValue(new Error('Skill not found'));
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe('Bid Drafting Pipeline', () => {
  // ── Pass 1: analyseQuestion ─────────────────────────────────────────────

  describe('Pass 1: analyseQuestion', () => {
    it('returns parsed analysis from Anthropic structured output', async () => {
      mockCreate.mockResolvedValueOnce(
        mockStructuredResponse(defaultAnalysis, 150, 80),
      );

      const result = await analyseQuestion(testQuestion, testContent);

      expect(result.analysis.primary_topic).toBe('Data security and GDPR');
      expect(result.analysis.tone).toBe('formal');
      expect(result.analysis.key_points_to_cover).toEqual([
        'ISO 27001',
        'Encryption',
        'Data mapping',
        'DPO',
      ]);
      expect(
        result.analysis.response_structure.suggested_headings,
      ).toHaveLength(4);
    });

    it('accumulates token usage and cost', async () => {
      mockCreate.mockResolvedValueOnce(
        mockStructuredResponse(defaultAnalysis, 300, 150),
      );

      const result = await analyseQuestion(testQuestion, testContent);

      expect(result.tokensUsed).toBe(450);
      expect(result.inputTokens).toBe(300);
      expect(result.outputTokens).toBe(150);
      expect(result.cost).toBeGreaterThan(0);
    });

    it('falls back to default analysis when JSON parsing fails', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not valid json' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });

      const result = await analyseQuestion(testQuestion, testContent);

      // Falls back to default with question text slice
      expect(result.analysis.primary_topic).toBe(
        testQuestion.question_text.slice(0, 100),
      );
      expect(result.analysis.tone).toBe('formal');
    });

    it('includes word limit and section in the prompt', async () => {
      mockCreate.mockResolvedValueOnce(mockStructuredResponse(defaultAnalysis));

      await analyseQuestion(testQuestion, testContent);

      const call = mockCreate.mock.calls[0][0];
      const userMessage = call.messages[0].content;
      expect(userMessage).toContain('Word limit: 500');
      expect(userMessage).toContain('Section: Technical Capability');
    });

    it('handles null word limit gracefully', async () => {
      mockCreate.mockResolvedValueOnce(mockStructuredResponse(defaultAnalysis));

      const noLimitQuestion = {
        ...testQuestion,
        word_limit: null,
        section_name: null,
      };
      await analyseQuestion(noLimitQuestion, testContent);

      const call = mockCreate.mock.calls[0][0];
      const userMessage = call.messages[0].content;
      expect(userMessage).toContain('No limit specified');
      expect(userMessage).toContain('Not specified');
    });
  });

  // ── Pass 2: draftResponse ───────────────────────────────────────────────

  describe('Pass 2: draftResponse', () => {
    it('returns response text with extracted citations', async () => {
      mockCreate.mockResolvedValueOnce(
        mockCitedResponse(
          'We implement ISO 27001 controls and maintain GDPR compliance through our DPO.',
          [
            {
              source: '/item/c-001',
              title: 'Data Security Policy',
              cited_text: 'ISO 27001 controls',
              search_result_index: 0,
            },
            {
              source: '/item/c-002',
              title: 'GDPR Compliance Framework',
              cited_text: 'dedicated Data Protection Officer',
              search_result_index: 1,
            },
          ],
        ),
      );

      const result = await draftResponse(
        testQuestion,
        testContent,
        defaultAnalysis,
      );

      expect(result.responseText).toContain('ISO 27001');
      expect(result.citations).toHaveLength(2);
      expect(result.citations[0].source_id).toBe('c-001');
      expect(result.citations[1].source_id).toBe('c-002');
    });

    it('uses the correct model tier', async () => {
      mockCreate.mockResolvedValueOnce(mockCitedResponse('Response text.', []));

      await draftResponse(
        testQuestion,
        testContent,
        defaultAnalysis,
        'drafting',
      );

      const call = mockCreate.mock.calls[0][0];
      expect(call.model).toBe('claude-opus-4-6');
    });

    it('includes regeneration instructions when provided', async () => {
      mockCreate.mockResolvedValueOnce(
        mockCitedResponse('Updated response.', []),
      );

      await draftResponse(
        testQuestion,
        testContent,
        defaultAnalysis,
        'drafting',
        'Add more detail about encryption standards',
      );

      const call = mockCreate.mock.calls[0][0];
      const systemText = call.system[0].text;
      expect(systemText).toContain('ADDITIONAL INSTRUCTIONS FROM REVIEWER');
      expect(systemText).toContain(
        'Add more detail about encryption standards',
      );
    });

    it('loads bid-writing and uk-procurement skills when available', async () => {
      mockLoadSkill
        .mockResolvedValueOnce('Bid writing skill content')
        .mockResolvedValueOnce('UK procurement skill content');

      mockCreate.mockResolvedValueOnce(mockCitedResponse('Response.', []));

      await draftResponse(testQuestion, testContent, defaultAnalysis);

      expect(mockLoadSkill).toHaveBeenCalledWith('bid-writing');
      expect(mockLoadSkill).toHaveBeenCalledWith('uk-procurement');

      const call = mockCreate.mock.calls[0][0];
      const systemText = call.system[0].text;
      expect(systemText).toContain('Bid writing skill content');
      expect(systemText).toContain('UK procurement skill content');
    });

    it('builds search result blocks with cache_control on last 3 only', async () => {
      // 4 content items — first one should not have cache_control
      const fourItems: DraftableContent[] = [
        ...testContent,
        {
          id: 'c-003',
          title: 'Item 3',
          content: 'Content 3',
          content_type: 'article',
          summary: 'Summary 3',
        },
        {
          id: 'c-004',
          title: 'Item 4',
          content: 'Content 4',
          content_type: 'article',
          summary: 'Summary 4',
        },
      ];

      mockCreate.mockResolvedValueOnce(mockCitedResponse('Response.', []));

      await draftResponse(testQuestion, fourItems, defaultAnalysis);

      const call = mockCreate.mock.calls[0][0];
      const userContent = call.messages[0].content;
      const searchBlocks = userContent.filter(
        (b: { type: string }) => b.type === 'search_result',
      );

      expect(searchBlocks).toHaveLength(4);
      // First block should NOT have cache_control
      expect(searchBlocks[0]).not.toHaveProperty('cache_control');
      // Last 3 should have cache_control
      expect(searchBlocks[1].cache_control).toEqual({ type: 'ephemeral' });
      expect(searchBlocks[2].cache_control).toEqual({ type: 'ephemeral' });
      expect(searchBlocks[3].cache_control).toEqual({ type: 'ephemeral' });
    });

    it('includes word limit instruction in system prompt', async () => {
      mockCreate.mockResolvedValueOnce(mockCitedResponse('Response.', []));

      await draftResponse(testQuestion, testContent, defaultAnalysis);

      const call = mockCreate.mock.calls[0][0];
      const systemText = call.system[0].text;
      expect(systemText).toContain('90-95% of the 500-word limit');
    });
  });

  // ── Pass 3: Deterministic quality checks ────────────────────────────────

  describe('Pass 3: Deterministic quality checks', () => {
    it('detects word count over limit', () => {
      // Plain markdown: 600 repetitions of 'word' = 600 words
      const longText = Array(600).fill('word').join(' ');
      const { wordCount, issues } = runDeterministicChecks(
        longText,
        [],
        { question_text: 'Q', word_limit: 500 },
        1,
      );

      expect(wordCount).toBe(600);
      expect(
        issues.some((i) => i.type === 'word_limit' && i.severity === 'error'),
      ).toBe(true);
    });

    it('warns when word count is below 70% of limit', () => {
      const shortText = Array(100).fill('word').join(' ');
      const { issues } = runDeterministicChecks(
        shortText,
        [],
        { question_text: 'Q', word_limit: 500 },
        1,
      );

      expect(
        issues.some((i) => i.type === 'word_limit' && i.severity === 'warning'),
      ).toBe(true);
    });

    it('warns when no citations despite available content', () => {
      const text = Array(400).fill('word').join(' ');
      const { issues } = runDeterministicChecks(
        text,
        [],
        { question_text: 'Q', word_limit: 500 },
        3,
      );

      expect(issues.some((i) => i.type === 'unsupported_claim')).toBe(true);
    });

    it('reports empty response as error', () => {
      const { wordCount, issues } = runDeterministicChecks(
        '',
        [],
        { question_text: 'Q', word_limit: 500 },
        1,
      );

      expect(wordCount).toBe(0);
      expect(
        issues.some(
          (i) => i.type === 'missing_section' && i.severity === 'error',
        ),
      ).toBe(true);
    });

    it('passes when word count is within limit with citations', () => {
      const text = Array(450).fill('word').join(' ');
      const citations = [
        {
          cited_text: 'test',
          source_index: 0,
          source_id: 'c-001',
          source_title: 'Title',
          source_url: '/item/c-001',
          start_block_index: 0,
          end_block_index: 0,
        },
      ];
      const { issues } = runDeterministicChecks(
        text,
        citations,
        { question_text: 'Q', word_limit: 500 },
        1,
      );

      expect(issues).toHaveLength(0);
    });

    it('handles null word limit (no compliance check)', () => {
      const text = Array(1000).fill('word').join(' ');
      const { issues } = runDeterministicChecks(
        text,
        [],
        { question_text: 'Q', word_limit: null },
        0,
      );

      // No word limit issues, no citation issues (0 matched content)
      expect(issues).toHaveLength(0);
    });
  });

  // ── Full pipeline: runDraftingPipeline ───────────────────────────────────

  describe('runDraftingPipeline (full three-pass)', () => {
    beforeEach(() => {
      // Pass 1: Question analysis (Sonnet)
      mockCreate.mockResolvedValueOnce(
        mockStructuredResponse(defaultAnalysis, 200, 100),
      );

      // Pass 2: Response drafting (Opus)
      mockCreate.mockResolvedValueOnce(
        mockCitedResponse(
          'Our approach to data security is built on ISO 27001 certification and GDPR compliance through our dedicated DPO.',
          [
            {
              source: '/item/c-001',
              title: 'Data Security Policy',
              cited_text: 'ISO 27001',
              search_result_index: 0,
            },
            {
              source: '/item/c-002',
              title: 'GDPR Compliance Framework',
              cited_text: 'dedicated DPO',
              search_result_index: 1,
            },
          ],
          1500,
          600,
        ),
      );

      // Pass 3: Quality check (Haiku)
      mockCreate.mockResolvedValueOnce(
        mockStructuredResponse(defaultQualityResult, 300, 80),
      );
    });

    it('executes all three passes in sequence', async () => {
      const result = await runDraftingPipeline(testQuestion, testContent);

      expect(mockCreate).toHaveBeenCalledTimes(3);
      expect(result.response_text).toContain('ISO 27001');
      expect(result.citations).toHaveLength(2);
      expect(result.analysis.primary_topic).toBe('Data security and GDPR');
    });

    it('accumulates tokens and cost across all passes', async () => {
      const result = await runDraftingPipeline(testQuestion, testContent);

      // Pass 1: 200+100, Pass 2: 1500+600, Pass 3: 300+80
      expect(result.total_tokens).toBe(200 + 100 + 1500 + 600 + 300 + 80);
      expect(result.total_cost).toBeGreaterThan(0);
    });

    it('assembles metadata with all three models recorded', async () => {
      const result = await runDraftingPipeline(testQuestion, testContent);
      const ai = result.metadata.ai_metadata!;

      expect(ai.model).toBe('claude-opus-4-6');
      expect(ai.analysis_model).toBe('claude-sonnet-4-5');
      expect(ai.quality_model).toBe('claude-haiku-4-5');
      expect(ai.generated_at).toBeTruthy();
    });

    it('includes quality data in metadata', async () => {
      const result = await runDraftingPipeline(testQuestion, testContent);
      const q = result.metadata.quality_data!;

      expect(q.overall_score).toBe(85);
      expect(q.citation_count).toBe(2);
      expect(q.suggestions).toContain(
        'Consider adding a specific case study example',
      );
    });

    it('maps source content IDs correctly', async () => {
      const result = await runDraftingPipeline(testQuestion, testContent);

      expect(result.source_content_ids).toEqual(['c-001', 'c-002']);
      expect(result.metadata.citations_data!.source_content_ids).toEqual([
        'c-001',
        'c-002',
      ]);
    });

    it('passes regeneration instructions through to Pass 2', async () => {
      // Reset and set up fresh mocks with regeneration
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(
          mockStructuredResponse(defaultAnalysis, 200, 100),
        )
        .mockResolvedValueOnce(
          mockCitedResponse('Regenerated response.', [], 1500, 600),
        )
        .mockResolvedValueOnce(
          mockStructuredResponse(defaultQualityResult, 300, 80),
        );

      const result = await runDraftingPipeline(
        testQuestion,
        testContent,
        'drafting',
        'Focus more on encryption standards',
      );

      expect(result.response_text).toBe('Regenerated response.');
      expect(result.metadata.ai_metadata!.regeneration_instructions).toBe(
        'Focus more on encryption standards',
      );

      // Verify Pass 2 received the instructions
      const pass2Call = mockCreate.mock.calls[1][0];
      expect(pass2Call.system[0].text).toContain(
        'Focus more on encryption standards',
      );
    });

    it('handles empty matched content (no KB sources)', async () => {
      mockCreate.mockReset();
      mockCreate
        .mockResolvedValueOnce(mockStructuredResponse(defaultAnalysis, 100, 50))
        .mockResolvedValueOnce(
          mockCitedResponse('A response without KB backing.', [], 500, 200),
        )
        .mockResolvedValueOnce(
          mockStructuredResponse(defaultQualityResult, 150, 40),
        );

      const result = await runDraftingPipeline(testQuestion, []);

      expect(result.source_content_ids).toEqual([]);
      expect(result.citations).toHaveLength(0);
    });
  });
});
