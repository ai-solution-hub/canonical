// __tests__/lib/intelligence/relevance-scorer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scoreRelevance, embeddingPreFilter, buildScoringPrompt } from '@/lib/intelligence/relevance-scorer';
import type { CompanyContext } from '@/lib/intelligence/types';

// Mock AI modules
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn(),
}));

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify({
          score: 0.85,
          category: 'high',
          reasoning: 'Directly relevant to education safeguarding.',
          matched_categories: ['education', 'safeguarding'],
        })}],
      }),
    },
  }),
  getModelForTier: vi.fn().mockReturnValue('claude-haiku-4-5'),
}));

const mockCompany: CompanyContext = {
  name: 'example-client Design',
  sectors: ['education', 'safeguarding', 'health-audits'],
  services: ['consultancy', 'training', 'software'],
  keyTopics: ['KCSIE', 'MAT governance', 'safeguarding audits'],
  targetCustomers: 'Multi-academy trusts and local authorities',
  valueProposition: 'Specialist compliance and safeguarding solutions for the education sector',
};

describe('buildScoringPrompt', () => {
  it('includes company context in the prompt', () => {
    const prompt = buildScoringPrompt(mockCompany);
    expect(prompt).toContain('example-client Design');
    expect(prompt).toContain('KCSIE');
    expect(prompt).toContain('education');
  });
});

describe('embeddingPreFilter', () => {
  it('passes articles above threshold', async () => {
    const { generateEmbedding } = await import('@/lib/ai/embed');
    // Only the article embedding is generated — company embedding is passed as parameter
    vi.mocked(generateEmbedding).mockResolvedValueOnce([1, 0, 0]);

    const result = await embeddingPreFilter('education policy article', [0.9, 0.1, 0]);
    expect(result.passed).toBe(true);
  });

  it('filters articles below threshold', async () => {
    const { generateEmbedding } = await import('@/lib/ai/embed');
    // Only the article embedding is generated — company embedding is passed as parameter
    vi.mocked(generateEmbedding).mockResolvedValueOnce([1, 0, 0]);

    const result = await embeddingPreFilter('unrelated cooking article', [0, 0, 1]);
    expect(result.passed).toBe(false);
  });
});

describe('scoreRelevance', () => {
  it('parses Haiku response and returns RelevanceResult', async () => {
    const result = await scoreRelevance('KCSIE Update', 'Updated guidance for schools...', mockCompany);
    expect(result.score).toBe(0.85);
    expect(result.category).toBe('high');
    expect(result.passed).toBe(true);
    expect(result.matchedCategories).toContain('education');
  });
});
