// __tests__/lib/intelligence/flag-analyser.test.ts
//
// Unit tests for the SI flag analyser. Mocks the Anthropic client and
// exercises the seven scenarios from the spec acceptance criteria:
//
//   1. Zero flags → returns "no refinement needed", does NOT call Claude
//   2. Happy path with 5 flags
//   3. >50 flags → truncated to 50 most recent + flag set
//   4. Mixed FP / FN → both clusters present
//   5. Schema validation failure → throws FlagAnalysisError(cause: 'schema')
//   6. API error → throws FlagAnalysisError(cause: 'api')
//   7. Parse failure (non-JSON response) → throws FlagAnalysisError(cause: 'parse')

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CompanyContext } from '@/lib/intelligence/types';
import {
  analyseFeedFlags,
  buildAnalysisSystemPrompt,
  FlagAnalysisError,
  FlagAnalysisResultSchema,
  MAX_FLAGS_PER_ANALYSIS,
  type FlagAnalysisFlag,
} from '@/lib/intelligence/flag-analyser';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// Mock variables hoisted via vi.hoisted so vi.mock can reference them.
const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
}));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: mocks.createMessage,
    },
  }),
  getModelForTier: vi.fn().mockReturnValue('claude-sonnet-4-5'),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const mockCompany: CompanyContext = {
  name: 'Example Client',
  sectors: ['education', 'safeguarding'],
  services: ['consultancy', 'training'],
  keyTopics: ['KCSIE', 'MAT governance'],
  targetCustomers: 'Multi-academy trusts',
  valueProposition: 'Specialist safeguarding compliance for schools',
};

const PROMPT_TEXT = 'Score articles related to UK education safeguarding.';

function makeFlag(
  index: number,
  overrides: Partial<FlagAnalysisFlag> = {},
): FlagAnalysisFlag {
  return {
    flagType: 'false_positive',
    articleTitle: `Article ${index}`,
    articleUrl: `https://example.com/${index}`,
    relevanceScore: 0.7,
    relevanceReasoning: 'Mentioned education topic',
    relevanceCategory: 'medium',
    userNotes: 'Not actually about safeguarding',
    sourceName: 'Test source',
    // Stable timestamps so we can assert truncation order deterministically.
    createdAt: `2026-03-${String((index % 28) + 1).padStart(2, '0')}T12:00:00Z`,
    ...overrides,
  };
}

/** A complete, valid Claude response shape. */
function buildValidClaudeResponse(overrides?: {
  fpCount?: number;
  fnCount?: number;
}) {
  const fpCount = overrides?.fpCount ?? 1;
  const fnCount = overrides?.fnCount ?? 0;
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          summary:
            'Most flags relate to construction projects in school buildings.',
          false_positive_patterns:
            fpCount > 0
              ? [
                  {
                    pattern: 'School building / construction projects',
                    article_count: fpCount,
                    articles: ['Article 1', 'Article 2'],
                    root_cause:
                      'The HIGH RELEVANCE section is too broad on education',
                  },
                ]
              : [],
          false_negative_patterns:
            fnCount > 0
              ? [
                  {
                    pattern: 'CQC inspection updates',
                    article_count: fnCount,
                    articles: ['Article 3'],
                    root_cause: 'Prompt does not mention CQC',
                  },
                ]
              : [],
          recommendations: [
            {
              type: 'reword',
              section: 'HIGH RELEVANCE',
              current_text: 'education policy',
              proposed_text:
                'safeguarding policy and inspection regimes (KCSIE, CQC)',
              reasoning:
                'Narrows scope away from generic construction projects',
              affected_flags: fpCount + fnCount,
            },
          ],
          proposed_prompt_text:
            'Score articles related to UK education safeguarding policy and inspection regimes (KCSIE, CQC).',
          confidence_notes: 'Sample size is small; monitor next 7 days.',
        }),
      },
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('analyseFeedFlags', () => {
  beforeEach(() => {
    mocks.createMessage.mockReset();
  });

  it('returns a "no refinement needed" result without calling Claude when there are zero flags', async () => {
    const result = await analyseFeedFlags({
      currentPromptText: PROMPT_TEXT,
      flags: [],
      companyContext: mockCompany,
    });

    expect(mocks.createMessage).not.toHaveBeenCalled();
    expect(result.summary).toMatch(/no unresolved flags/i);
    expect(result.falsePositivePatterns).toEqual([]);
    expect(result.falseNegativePatterns).toEqual([]);
    expect(result.recommendations).toEqual([]);
    expect(result.proposedPromptText).toBe('');
    expect(result.analysedFlagCount).toBe(0);
    expect(result.truncated).toBe(false);

    // Result must still satisfy the public schema.
    expect(FlagAnalysisResultSchema.safeParse(result).success).toBe(true);
  });

  it('happy path: parses a valid 5-flag response and returns a typed result', async () => {
    mocks.createMessage.mockResolvedValueOnce(
      buildValidClaudeResponse({ fpCount: 5 }),
    );

    const flags: FlagAnalysisFlag[] = Array.from({ length: 5 }, (_, i) =>
      makeFlag(i + 1),
    );

    const result = await analyseFeedFlags({
      currentPromptText: PROMPT_TEXT,
      flags,
      companyContext: mockCompany,
    });

    expect(mocks.createMessage).toHaveBeenCalledTimes(1);
    expect(result.analysedFlagCount).toBe(5);
    expect(result.truncated).toBe(false);
    expect(result.falsePositivePatterns).toHaveLength(1);
    expect(result.falsePositivePatterns[0].articleCount).toBe(5);
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0].type).toBe('reword');
    expect(result.recommendations[0].currentText).toBe('education policy');
    expect(result.proposedPromptText).toContain('safeguarding policy');

    // System prompt should embed the company name and the flagged articles.
    const callArgs = mocks.createMessage.mock.calls[0][0];
    expect(callArgs.system).toContain('Example Client');
    expect(callArgs.system).toContain('Article 1');
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.max_tokens).toBeGreaterThanOrEqual(2048);
  });

  it('truncates to MAX_FLAGS_PER_ANALYSIS most-recent flags when over the cap', async () => {
    mocks.createMessage.mockResolvedValueOnce(
      buildValidClaudeResponse({ fpCount: MAX_FLAGS_PER_ANALYSIS }),
    );

    // Build 60 flags with explicit, monotonically-increasing timestamps so
    // the most-recent 50 are deterministic.
    const flags: FlagAnalysisFlag[] = Array.from({ length: 60 }, (_, i) => {
      const day = String((i % 28) + 1).padStart(2, '0');
      return makeFlag(i + 1, {
        // Older flags first, newest last.
        createdAt: `2026-${i < 30 ? '01' : '02'}-${day}T12:00:00Z`,
      });
    });

    const result = await analyseFeedFlags({
      currentPromptText: PROMPT_TEXT,
      flags,
      companyContext: mockCompany,
    });

    expect(result.truncated).toBe(true);
    expect(result.analysedFlagCount).toBe(MAX_FLAGS_PER_ANALYSIS);

    // Confirm that the system prompt only contains 50 article entries
    // (count of "[false_positive]" markers in the formatted block).
    const callArgs = mocks.createMessage.mock.calls[0][0];
    const matches = (callArgs.system as string).match(/\[false_positive\]/g);
    expect(matches?.length).toBe(MAX_FLAGS_PER_ANALYSIS);
  });

  it('analyses both false positive and false negative patterns when mixed', async () => {
    mocks.createMessage.mockResolvedValueOnce(
      buildValidClaudeResponse({ fpCount: 2, fnCount: 1 }),
    );

    const flags: FlagAnalysisFlag[] = [
      makeFlag(1, { flagType: 'false_positive' }),
      makeFlag(2, { flagType: 'false_positive' }),
      makeFlag(3, { flagType: 'false_negative', userNotes: 'Should pass' }),
    ];

    const result = await analyseFeedFlags({
      currentPromptText: PROMPT_TEXT,
      flags,
      companyContext: mockCompany,
    });

    expect(result.falsePositivePatterns).toHaveLength(1);
    expect(result.falseNegativePatterns).toHaveLength(1);
    expect(result.falseNegativePatterns[0].pattern).toMatch(/CQC/);

    // Both flag types should be visible in the rendered prompt.
    const callArgs = mocks.createMessage.mock.calls[0][0];
    expect(callArgs.system).toContain('[false_positive]');
    expect(callArgs.system).toContain('[false_negative]');
  });

  it('throws FlagAnalysisError(schema) when the response fails Zod validation', async () => {
    // Missing required fields like `summary` and `recommendations`.
    mocks.createMessage.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ false_positive_patterns: [] }),
        },
      ],
    });

    await expect(
      analyseFeedFlags({
        currentPromptText: PROMPT_TEXT,
        flags: [makeFlag(1)],
        companyContext: mockCompany,
      }),
    ).rejects.toMatchObject({
      name: 'FlagAnalysisError',
      cause: 'schema',
    });
  });

  it('throws FlagAnalysisError(api) when the Claude API call fails', async () => {
    mocks.createMessage.mockRejectedValueOnce(
      new Error('Anthropic 529 Overloaded'),
    );

    let caught: unknown = null;
    try {
      await analyseFeedFlags({
        currentPromptText: PROMPT_TEXT,
        flags: [makeFlag(1)],
        companyContext: mockCompany,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FlagAnalysisError);
    expect((caught as FlagAnalysisError).cause).toBe('api');
    expect((caught as FlagAnalysisError).message).toMatch(/529 Overloaded/);
  });

  it('throws FlagAnalysisError(parse) when the response is not valid JSON', async () => {
    mocks.createMessage.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'I am sorry, I cannot analyse those flags right now.',
        },
      ],
    });

    let caught: unknown = null;
    try {
      await analyseFeedFlags({
        currentPromptText: PROMPT_TEXT,
        flags: [makeFlag(1)],
        companyContext: mockCompany,
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(FlagAnalysisError);
    expect((caught as FlagAnalysisError).cause).toBe('parse');
    expect((caught as FlagAnalysisError).rawResponse).toContain('I am sorry');
  });
});

describe('buildAnalysisSystemPrompt', () => {
  it('embeds company context, current prompt, and formatted flags', () => {
    const flags = [
      makeFlag(1, {
        articleTitle: 'KCSIE Update',
        sourceName: 'Gov.uk',
        userNotes: null,
      }),
    ];
    const prompt = buildAnalysisSystemPrompt(
      mockCompany,
      'Score education-related articles.',
      flags,
    );

    expect(prompt).toContain('Example Client');
    expect(prompt).toContain('Score education-related articles.');
    expect(prompt).toContain('[false_positive] "KCSIE Update"');
    expect(prompt).toContain('Source: Gov.uk');
    expect(prompt).toContain('No notes provided');
  });
});
