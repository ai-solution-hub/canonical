// __tests__/lib/intelligence/relevance-scorer.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  scoreRelevance,
  embeddingPreFilter,
  buildScoringPrompt,
} from '@/lib/intelligence/relevance-scorer';
import type { CompanyContext } from '@/lib/intelligence/types';

// Mock AI modules
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn(),
  };
});

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              score: 0.85,
              category: 'high',
              reasoning: 'Directly relevant to education safeguarding.',
              matched_categories: ['education', 'safeguarding'],
            }),
          },
        ],
      }),
    },
  }),
  getModelForTier: vi.fn().mockReturnValue('claude-haiku-4-5'),
}));

const mockCompany: CompanyContext = {
  name: 'Example Client',
  sectors: ['education', 'safeguarding', 'health-audits'],
  services: ['consultancy', 'training', 'software'],
  keyTopics: ['KCSIE', 'MAT governance', 'safeguarding audits'],
  targetCustomers: 'Multi-academy trusts and local authorities',
  valueProposition:
    'Specialist compliance and safeguarding solutions for the education sector',
};

describe('buildScoringPrompt', () => {
  it('includes company context in the prompt', () => {
    const prompt = buildScoringPrompt(mockCompany);
    expect(prompt).toContain('Example Client');
    expect(prompt).toContain('KCSIE');
    expect(prompt).toContain('education');
  });

  it('includes custom prompt text when provided', () => {
    const customText =
      'Score DfE announcements as high relevance regardless of topic.';
    const prompt = buildScoringPrompt(mockCompany, customText);
    expect(prompt).toContain('Additional scoring guidance from the team:');
    expect(prompt).toContain(customText);
    expect(prompt).toContain("prefer the team's guidance");
  });

  it('works without custom prompt text (backwards compatible)', () => {
    const prompt = buildScoringPrompt(mockCompany);
    expect(prompt).not.toContain('Additional scoring guidance from the team:');
    expect(prompt).toContain('Respond with JSON only');
  });

  it('omits custom section for empty string', () => {
    const prompt = buildScoringPrompt(mockCompany, '');
    expect(prompt).not.toContain('Additional scoring guidance from the team:');
  });

  it('omits custom section for undefined', () => {
    const prompt = buildScoringPrompt(mockCompany, undefined);
    expect(prompt).not.toContain('Additional scoring guidance from the team:');
  });
});

describe('embeddingPreFilter', () => {
  it('passes articles above threshold', async () => {
    const { generateEmbedding } = await import('@/lib/ai/embed');
    // Only the article embedding is generated — company embedding is passed as parameter
    vi.mocked(generateEmbedding).mockResolvedValueOnce([1, 0, 0]);

    const result = await embeddingPreFilter(
      'education policy article',
      [0.9, 0.1, 0],
    );
    expect(result.passed).toBe(true);
  });

  it('filters articles below threshold', async () => {
    const { generateEmbedding } = await import('@/lib/ai/embed');
    // Only the article embedding is generated — company embedding is passed as parameter
    vi.mocked(generateEmbedding).mockResolvedValueOnce([1, 0, 0]);

    const result = await embeddingPreFilter(
      'unrelated cooking article',
      [0, 0, 1],
    );
    expect(result.passed).toBe(false);
  });
});

describe('scoreRelevance', () => {
  it('parses Haiku response and returns RelevanceResult', async () => {
    const result = await scoreRelevance(
      'KCSIE Update',
      'Updated guidance for schools...',
      mockCompany,
    );
    expect(result.score).toBe(0.85);
    expect(result.category).toBe('high');
    expect(result.passed).toBe(true);
    expect(result.matchedCategories).toContain('education');
  });

  it('passes custom prompt text through to the API call', async () => {
    const { getAnthropicClient } = await import('@/lib/anthropic');
    const mockCreate = vi.mocked(getAnthropicClient)().messages.create;

    const customText =
      'Prioritise articles mentioning DfE safeguarding guidance.';
    await scoreRelevance(
      'KCSIE Update',
      'Content...',
      mockCompany,
      undefined,
      customText,
    );

    // Verify the system prompt included the custom text
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.stringContaining(customText),
      }),
    );
  });

  it('works without custom prompt text', async () => {
    const { getAnthropicClient } = await import('@/lib/anthropic');
    const mockCreate = vi.mocked(getAnthropicClient)().messages.create;

    await scoreRelevance('KCSIE Update', 'Content...', mockCompany);

    // Verify the system prompt did NOT include custom guidance section
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        system: expect.not.stringContaining('Additional scoring guidance'),
      }),
    );
  });
});
