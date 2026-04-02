import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import type { CitationEntry, QualityData } from '@/types/bid-metadata';
import type {
  DraftableQuestion,
  DraftableContent,
  QuestionAnalysis,
} from '@/lib/ai/draft';

// ──────────────────────────────────────────
// Mock the Anthropic client module
// ──────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getModelForTier: (tier: string) => {
    const map: Record<string, string> = {
      analysis: 'claude-sonnet-4-5',
      drafting: 'claude-opus-4-6',
      quality: 'claude-haiku-4-5',
    };
    return map[tier] ?? 'claude-sonnet-4-5';
  },
  estimateCost: vi
    .fn()
    .mockImplementation(
      (
        model: string,
        usage: {
          input_tokens: number;
          output_tokens: number;
          cache_read_input_tokens?: number | null;
        },
      ) => {
        const rates: Record<
          string,
          { input: number; output: number; cache_read: number }
        > = {
          'claude-opus-4-6': { input: 15, output: 75, cache_read: 1.5 },
          'claude-sonnet-4-5': { input: 3, output: 15, cache_read: 0.3 },
          'claude-haiku-4-5': { input: 0.8, output: 4, cache_read: 0.08 },
        };
        const r = rates[model] ?? rates['claude-sonnet-4-5'];
        const inputTokens =
          usage.input_tokens - (usage.cache_read_input_tokens ?? 0);
        const cacheReadTokens = usage.cache_read_input_tokens ?? 0;
        return (
          (inputTokens / 1_000_000) * r.input +
          (usage.output_tokens / 1_000_000) * r.output +
          (cacheReadTokens / 1_000_000) * r.cache_read
        );
      },
    ),
}));

// Mock the quality-check module to isolate Pass 3.
// vi.hoisted() ensures the mock is available before vi.mock() factory runs.
const { mockCheckResponseQuality } = vi.hoisted(() => ({
  mockCheckResponseQuality: vi.fn(),
}));
vi.mock('@/lib/ai/quality-check', () => ({
  checkResponseQuality: mockCheckResponseQuality,
}));

// Note: we do NOT mock @/lib/citations. The extractCitedResponse function is
// a pure transformer that maps API response structures to CitationEntry arrays.
// By letting the real implementation run, we avoid vi.mock leaking into the
// citations.test.ts file when tests share a worker thread.

// Import after mocks are declared
import { estimateCost } from '@/lib/anthropic';
import {
  analyseQuestion,
  draftResponse,
  runDraftingPipeline,
} from '@/lib/ai/draft';

// ──────────────────────────────────────────
// Test fixtures
// ──────────────────────────────────────────

const sampleQuestion: DraftableQuestion = {
  id: 'q-001',
  question_text:
    'Describe your approach to data security for cloud-hosted systems.',
  word_limit: 500,
  section_name: 'Technical Capability',
  confidence_posture: null,
};

const sampleQuestionNoLimit: DraftableQuestion = {
  ...sampleQuestion,
  id: 'q-002',
  word_limit: null,
};

const sampleContent: DraftableContent[] = [
  {
    id: 'uuid-1',
    title: 'Data Encryption Policy',
    content:
      'We use AES-256 encryption for all data at rest and TLS 1.3 for data in transit.',
    content_type: 'policy',
    ai_summary: 'Covers encryption standards and key management practices.',
  },
  {
    id: 'uuid-2',
    title: 'ISO 27001 Certification',
    content: 'Our company holds ISO 27001 certification, renewed annually.',
    content_type: 'certification',
    ai_summary: 'Details of ISO 27001 certification and audit schedule.',
  },
];

const sampleAnalysis: QuestionAnalysis = {
  primary_topic: 'Data Security',
  content_types_needed: ['policy', 'certification'],
  response_structure: {
    suggested_headings: ['Encryption Standards', 'Certifications'],
    word_allocation: [
      { heading: 'Encryption Standards', words: 300 },
      { heading: 'Certifications', words: 200 },
    ],
  },
  key_points_to_cover: ['AES-256', 'ISO 27001', 'TLS 1.3'],
  tone: 'formal',
};

const sampleCitations: CitationEntry[] = [
  {
    cited_text: 'We use AES-256 encryption for all data at rest',
    source_index: 0,
    source_id: 'uuid-1',
    source_title: 'Data Encryption Policy',
    source_url: '/item/uuid-1',
    start_block_index: 0,
    end_block_index: 0,
  },
];

const sampleQualityData: QualityData = {
  overall_score: 85,
  word_count: 420,
  word_limit_compliance: true,
  citation_count: 1,
  unsupported_claims: [],
  suggestions: ['Consider adding more detail on key rotation schedules'],
  issues: [],
};

/**
 * Build a mock Anthropic API response with the given text and token usage.
 * When citations need to be extracted by the real extractCitedResponse,
 * pass citationBlocks to include search_result_location citations on the
 * text block.
 */
function buildMockApiResponse(
  text: string,
  inputTokens: number,
  outputTokens: number,
  options?: {
    cacheReadTokens?: number;
    citations?: Array<{
      type: 'search_result_location';
      source: string;
      title: string | null;
      cited_text: string;
      search_result_index: number;
      start_block_index: number;
      end_block_index: number;
    }>;
  },
) {
  const textBlock: Record<string, unknown> = { type: 'text' as const, text };
  if (options?.citations) {
    textBlock.citations = options.citations;
  }
  return {
    content: [textBlock],
    usage: {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: options?.cacheReadTokens ?? 0,
    },
  };
}

/** Build a Pass 2 API response that includes search_result_location citations */
function buildPass2ResponseWithCitations(
  text: string,
  inputTokens: number,
  outputTokens: number,
) {
  return buildMockApiResponse(text, inputTokens, outputTokens, {
    citations: [
      {
        type: 'search_result_location',
        source: '/item/uuid-1',
        title: 'Data Encryption Policy',
        cited_text: 'We use AES-256 encryption for all data at rest',
        search_result_index: 0,
        start_block_index: 0,
        end_block_index: 0,
      },
    ],
  });
}

/** Build a Pass 2 API response without citations (plain text only) */
function buildPass2ResponseNoCitations(
  text: string,
  inputTokens: number,
  outputTokens: number,
) {
  return buildMockApiResponse(text, inputTokens, outputTokens);
}

// ──────────────────────────────────────────
// estimateCost (from @/lib/anthropic)
// ──────────────────────────────────────────

describe('estimateCost', () => {
  // The estimateCost function is mocked with a faithful re-implementation,
  // so we verify the mock's behaviour matches expected cost calculations.
  // This validates the contract our pipeline depends on.

  it('calculates Opus cost correctly', () => {
    const cost = (estimateCost as Mock)('claude-opus-4-6', {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // (1000 / 1_000_000) * 15 + (500 / 1_000_000) * 75 = 0.015 + 0.0375 = 0.0525
    expect(cost).toBeCloseTo(0.0525, 6);
  });

  it('calculates Sonnet cost correctly', () => {
    const cost = (estimateCost as Mock)('claude-sonnet-4-5', {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // (1000 / 1_000_000) * 3 + (500 / 1_000_000) * 15 = 0.003 + 0.0075 = 0.0105
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('accounts for cache read tokens', () => {
    const cost = (estimateCost as Mock)('claude-opus-4-6', {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 200,
    });
    // Non-cached input: 800 tokens, cached: 200 tokens
    // (800 / 1_000_000) * 15 + (500 / 1_000_000) * 75 + (200 / 1_000_000) * 1.5
    // = 0.012 + 0.0375 + 0.0003 = 0.0498
    expect(cost).toBeCloseTo(0.0498, 6);
  });

  it('falls back to Sonnet rates for unknown models', () => {
    const cost = (estimateCost as Mock)('claude-unknown-model', {
      input_tokens: 1000,
      output_tokens: 500,
    });
    // Falls back to Sonnet rates
    expect(cost).toBeCloseTo(0.0105, 6);
  });

  it('returns 0 for zero tokens', () => {
    const cost = (estimateCost as Mock)('claude-opus-4-6', {
      input_tokens: 0,
      output_tokens: 0,
    });
    expect(cost).toBe(0);
  });
});

// ──────────────────────────────────────────
// Pass 1: analyseQuestion
// ──────────────────────────────────────────

describe('analyseQuestion (Pass 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns structured analysis from valid API response', async () => {
    const analysisJson = JSON.stringify(sampleAnalysis);
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(analysisJson, 500, 200),
    );

    const result = await analyseQuestion(sampleQuestion, sampleContent);

    expect(result.analysis.primary_topic).toBe('Data Security');
    expect(result.analysis.content_types_needed).toEqual([
      'policy',
      'certification',
    ]);
    expect(result.analysis.response_structure.suggested_headings).toEqual([
      'Encryption Standards',
      'Certifications',
    ]);
    expect(result.analysis.key_points_to_cover).toContain('AES-256');
    expect(result.analysis.tone).toBe('formal');
  });

  it('returns default analysis when API returns invalid JSON', async () => {
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse('this is not valid json {{{', 500, 200),
    );

    const result = await analyseQuestion(sampleQuestion, sampleContent);

    // Falls back to defaults
    expect(result.analysis.primary_topic).toBe(
      sampleQuestion.question_text.slice(0, 100),
    );
    expect(result.analysis.content_types_needed).toEqual([]);
    expect(result.analysis.response_structure.suggested_headings).toEqual([]);
    expect(result.analysis.key_points_to_cover).toEqual([]);
    expect(result.analysis.tone).toBe('formal');
  });

  it('includes token usage and cost in result', async () => {
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 800, 300),
    );

    const result = await analyseQuestion(sampleQuestion, sampleContent);

    expect(result.inputTokens).toBe(800);
    expect(result.outputTokens).toBe(300);
    expect(result.tokensUsed).toBe(1100);
    expect(result.cost).toBeGreaterThan(0);
  });

  it('passes question text and matched content in prompt', async () => {
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 500, 200),
    );

    await analyseQuestion(sampleQuestion, sampleContent);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;

    // Verify question text is included
    expect(userMessage).toContain(sampleQuestion.question_text);
    // Verify matched content titles and summaries are included
    expect(userMessage).toContain('Data Encryption Policy');
    expect(userMessage).toContain('Covers encryption standards');
    expect(userMessage).toContain('ISO 27001 Certification');
    // Verify word limit is included
    expect(userMessage).toContain('500');
    // Verify section name is included
    expect(userMessage).toContain('Technical Capability');
  });
});

// ──────────────────────────────────────────
// Pass 2: draftResponse
// ──────────────────────────────────────────

describe('draftResponse (Pass 2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds search result blocks from matched content', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseWithCitations(
        'Our data security approach includes AES-256 encryption.',
        2000,
        800,
      ),
    );

    await draftResponse(sampleQuestion, sampleContent, sampleAnalysis);

    const callArgs = mockCreate.mock.calls[0][0];
    const userContent = callArgs.messages[0].content;

    // Each content item becomes a search_result block
    const searchResults = userContent.filter(
      (b: { type: string }) => b.type === 'search_result',
    );
    expect(searchResults).toHaveLength(2);
    expect(searchResults[0].source).toBe('/item/uuid-1');
    expect(searchResults[0].title).toBe('Data Encryption Policy');
    expect(searchResults[1].source).toBe('/item/uuid-2');
    expect(searchResults[1].title).toBe('ISO 27001 Certification');
    // Verify citations are enabled on each block
    expect(searchResults[0].citations).toEqual({ enabled: true });
    expect(searchResults[1].citations).toEqual({ enabled: true });
  });

  it('extracts citations from API response', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseWithCitations('Response text', 2000, 800),
    );

    const result = await draftResponse(
      sampleQuestion,
      sampleContent,
      sampleAnalysis,
    );

    // The real extractCitedResponse processes the search_result_location citations
    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].source_id).toBe('uuid-1');
    expect(result.citations[0].cited_text).toBe(
      'We use AES-256 encryption for all data at rest',
    );
  });

  it('returns response text concatenated from all text blocks', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseNoCitations(
        'Full drafted response text here.',
        2000,
        800,
      ),
    );

    const result = await draftResponse(
      sampleQuestion,
      sampleContent,
      sampleAnalysis,
    );

    expect(result.responseText).toBe('Full drafted response text here.');
  });

  it('includes word limit instruction when limit is set', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseNoCitations('Response', 2000, 800),
    );

    await draftResponse(sampleQuestion, sampleContent, sampleAnalysis);

    const callArgs = mockCreate.mock.calls[0][0];
    // System prompt is an array with a text block
    const systemText = callArgs.system[0].text;
    expect(systemText).toContain('90-95%');
    expect(systemText).toContain('500-word limit');
  });

  it('omits word limit instruction when limit is null', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseNoCitations('Response', 2000, 800),
    );

    await draftResponse(sampleQuestionNoLimit, sampleContent, sampleAnalysis);

    const callArgs = mockCreate.mock.calls[0][0];
    const systemText = callArgs.system[0].text;
    expect(systemText).toContain('No specific limit');
    expect(systemText).not.toContain('90-95%');
  });

  it('uses correct model for specified tier', async () => {
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseNoCitations('Response', 2000, 800),
    );

    const result = await draftResponse(
      sampleQuestion,
      sampleContent,
      sampleAnalysis,
      'drafting',
    );

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-opus-4-6');
    expect(result.model).toBe('claude-opus-4-6');
  });
});

// ──────────────────────────────────────────
// Full Pipeline Orchestration
// ──────────────────────────────────────────

describe('runDraftingPipeline (Full Orchestration)', () => {
  /** Set up all three passes to succeed with consistent mock data */
  function setupSuccessfulPipeline() {
    // Pass 1 — analysis (Sonnet)
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 500, 200),
    );

    // Pass 2 — drafting (Opus) with citations
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseWithCitations(
        'Drafted response about data security.',
        2000,
        800,
      ),
    );

    // Pass 3 — quality check (Haiku) — handled by mocked checkResponseQuality
    mockCheckResponseQuality.mockResolvedValueOnce({
      qualityData: sampleQualityData,
      tokensUsed: 400,
      inputTokens: 300,
      outputTokens: 100,
      cost: 0.00064,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls all three passes in sequence', async () => {
    setupSuccessfulPipeline();

    await runDraftingPipeline(sampleQuestion, sampleContent);

    // Pass 1 + Pass 2 via mockCreate (Pass 3 is via checkResponseQuality)
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCheckResponseQuality).toHaveBeenCalledTimes(1);
  });

  it('accumulates total tokens across all passes', async () => {
    setupSuccessfulPipeline();

    const result = await runDraftingPipeline(sampleQuestion, sampleContent);

    // Pass 1: 500 + 200 = 700
    // Pass 2: 2000 + 800 = 2800
    // Pass 3: 400 (from mocked checkResponseQuality)
    expect(result.total_tokens).toBe(700 + 2800 + 400);
  });

  it('accumulates total cost across all passes', async () => {
    setupSuccessfulPipeline();

    const result = await runDraftingPipeline(sampleQuestion, sampleContent);

    // Cost should be the sum of all three passes
    expect(result.total_cost).toBeGreaterThan(0);
    // Verify it includes all three pass costs (the exact value depends on
    // the estimateCost mock, but it must include the quality pass cost)
    expect(result.total_cost).toBeGreaterThan(0.00064);
  });

  it('assembles metadata with all three model names', async () => {
    setupSuccessfulPipeline();

    const result = await runDraftingPipeline(sampleQuestion, sampleContent);

    expect(result.metadata.ai_metadata?.model).toBe('claude-opus-4-6');
    expect(result.metadata.ai_metadata?.analysis_model).toBe(
      'claude-sonnet-4-5',
    );
    expect(result.metadata.ai_metadata?.quality_model).toBe('claude-haiku-4-5');
  });

  it('includes generated_at timestamp', async () => {
    setupSuccessfulPipeline();

    const before = new Date().toISOString();
    const result = await runDraftingPipeline(sampleQuestion, sampleContent);
    const after = new Date().toISOString();

    const generatedAt = result.metadata.ai_metadata?.generated_at;
    expect(generatedAt).toBeDefined();
    // Timestamp should be between before and after
    expect(generatedAt! >= before).toBe(true);
    expect(generatedAt! <= after).toBe(true);
  });

  it('passes question analysis to Pass 2', async () => {
    setupSuccessfulPipeline();

    await runDraftingPipeline(sampleQuestion, sampleContent);

    // Pass 2 (second mockCreate call) should include analysis-derived content
    const pass2Args = mockCreate.mock.calls[1][0];
    const systemText = pass2Args.system[0].text;
    // Analysis suggested headings should appear in the system prompt
    expect(systemText).toContain('Encryption Standards');
    expect(systemText).toContain('Certifications');
    // Key points from analysis
    expect(systemText).toContain('AES-256');
    expect(systemText).toContain('ISO 27001');
    expect(systemText).toContain('TLS 1.3');
  });

  it('passes Pass 2 output to Pass 3 quality check', async () => {
    setupSuccessfulPipeline();

    await runDraftingPipeline(sampleQuestion, sampleContent);

    expect(mockCheckResponseQuality).toHaveBeenCalledWith(
      {
        question_text: sampleQuestion.question_text,
        word_limit: sampleQuestion.word_limit,
      },
      'Drafted response about data security.',
      sampleCitations,
      sampleContent.length,
    );
  });

  it('returns citations from Pass 2', async () => {
    setupSuccessfulPipeline();

    const result = await runDraftingPipeline(sampleQuestion, sampleContent);

    expect(result.citations).toEqual(sampleCitations);
    expect(result.citations[0].source_id).toBe('uuid-1');
  });

  it('returns quality data from Pass 3', async () => {
    setupSuccessfulPipeline();

    const result = await runDraftingPipeline(sampleQuestion, sampleContent);

    expect(result.metadata.quality_data).toEqual(sampleQualityData);
    expect(result.metadata.quality_data?.overall_score).toBe(85);
    expect(result.metadata.quality_data?.word_count).toBe(420);
    expect(result.metadata.quality_data?.suggestions).toContain(
      'Consider adding more detail on key rotation schedules',
    );
  });
});

// ──────────────────────────────────────────
// Error Handling
// ──────────────────────────────────────────

describe('runDraftingPipeline (Error Handling)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('propagates Pass 1 API errors', async () => {
    mockCreate.mockRejectedValueOnce(
      new Error('Anthropic API rate limit exceeded'),
    );

    await expect(
      runDraftingPipeline(sampleQuestion, sampleContent),
    ).rejects.toThrow('Anthropic API rate limit exceeded');
  });

  it('propagates Pass 2 API errors', async () => {
    // Pass 1 succeeds
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 500, 200),
    );
    // Pass 2 fails
    mockCreate.mockRejectedValueOnce(new Error('Anthropic API server error'));

    await expect(
      runDraftingPipeline(sampleQuestion, sampleContent),
    ).rejects.toThrow('Anthropic API server error');
  });

  it('propagates Pass 3 API errors', async () => {
    // Pass 1 succeeds
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 500, 200),
    );
    // Pass 2 succeeds
    mockCreate.mockResolvedValueOnce(
      buildPass2ResponseNoCitations('Drafted response.', 2000, 800),
    );
    // Pass 3 fails
    mockCheckResponseQuality.mockRejectedValueOnce(
      new Error('Quality check API timeout'),
    );

    await expect(
      runDraftingPipeline(sampleQuestion, sampleContent),
    ).rejects.toThrow('Quality check API timeout');
  });

  it('does not call Pass 2 if Pass 1 fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Pass 1 failure'));

    await expect(
      runDraftingPipeline(sampleQuestion, sampleContent),
    ).rejects.toThrow('Pass 1 failure');

    // Only one call was made (the failed Pass 1)
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCheckResponseQuality).not.toHaveBeenCalled();
  });

  it('does not call Pass 3 if Pass 2 fails', async () => {
    // Pass 1 succeeds
    mockCreate.mockResolvedValueOnce(
      buildMockApiResponse(JSON.stringify(sampleAnalysis), 500, 200),
    );
    // Pass 2 fails
    mockCreate.mockRejectedValueOnce(new Error('Pass 2 failure'));

    await expect(
      runDraftingPipeline(sampleQuestion, sampleContent),
    ).rejects.toThrow('Pass 2 failure');

    // Two calls: Pass 1 (success) + Pass 2 (failure)
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCheckResponseQuality).not.toHaveBeenCalled();
  });
});
