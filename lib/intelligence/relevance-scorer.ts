// lib/intelligence/relevance-scorer.ts
import { getAnthropicClient, getModelForTier } from '@/lib/anthropic';
import { generateEmbedding } from '@/lib/ai/embed';
import type { CompanyContext, RelevanceResult, PreFilterResult } from './types';
import { EMBEDDING_PRE_FILTER_THRESHOLD, DEFAULT_RELEVANCE_THRESHOLD } from './types';

/** Cosine similarity between two vectors */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

/** Stage 1: Embedding pre-filter — fast, cheap elimination of obviously irrelevant articles */
export async function embeddingPreFilter(
  articleText: string,
  companyEmbedding: number[],
): Promise<PreFilterResult> {
  const articleEmbedding = await generateEmbedding(articleText.slice(0, 8000));
  const similarity = cosineSimilarity(articleEmbedding, companyEmbedding);
  return {
    similarity,
    passed: similarity >= EMBEDDING_PRE_FILTER_THRESHOLD,
  };
}

/** Build the system prompt for relevance scoring */
export function buildScoringPrompt(
  company: CompanyContext,
  customPromptText?: string,
): string {
  let prompt = `You are an intelligence analyst for ${company.name}.

Company context:
- Sectors: ${company.sectors.join(', ')}
- Services: ${company.services.join(', ')}
- Key topics: ${company.keyTopics.join(', ')}
- Target customers: ${company.targetCustomers ?? 'Not specified'}
- Value proposition: ${company.valueProposition ?? 'Not specified'}

Your task: score the relevance of an article to this company's business interests.

Score using these categories:
- high (0.8-1.0): Directly relevant to the company's sectors, services, or key topics. Would inform a sales conversation, bid, or product decision.
- medium (0.5-0.79): Tangentially relevant. Related sector or topic but not directly actionable.
- low (0.2-0.49): Loosely connected. Same broad industry but unlikely to be useful.
- irrelevant (0.0-0.19): No connection to the company's business.`;

  if (customPromptText) {
    prompt += `

Additional scoring guidance from the team:
${customPromptText}

Use the above guidance to refine your scoring. If the guidance conflicts with the base criteria, prefer the team's guidance.`;
  }

  prompt += `

Respond with JSON only:
{
  "score": <number 0.0-1.0>,
  "category": "<high|medium|low|irrelevant>",
  "reasoning": "<1-2 sentences explaining the score>",
  "matched_categories": ["<list of company topics/sectors this matches>"]
}`;

  return prompt;
}

/** Stage 2: LLM categorical relevance scoring via Claude Haiku */
export async function scoreRelevance(
  articleTitle: string,
  articleContent: string,
  company: CompanyContext,
  threshold: number = DEFAULT_RELEVANCE_THRESHOLD,
  customPromptText?: string,
): Promise<RelevanceResult> {
  const anthropic = getAnthropicClient();
  const model = getModelForTier('quality');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 300,
    system: buildScoringPrompt(company, customPromptText),
    messages: [
      {
        role: 'user',
        content: `Article title: ${articleTitle}\n\nArticle content (first 3000 chars):\n${articleContent.slice(0, 3000)}`,
      },
    ],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';

  try {
    const parsed = JSON.parse(text);
    const score = Number(parsed.score);
    const category = parsed.category as RelevanceResult['category'];
    return {
      score: isNaN(score) ? 0 : score,
      category: ['high', 'medium', 'low', 'irrelevant'].includes(category) ? category : 'irrelevant',
      reasoning: parsed.reasoning ?? '',
      matchedCategories: Array.isArray(parsed.matched_categories) ? parsed.matched_categories : [],
      passed: score >= threshold,
    };
  } catch {
    // Failed to parse JSON — treat as irrelevant
    return {
      score: 0,
      category: 'irrelevant',
      reasoning: `Failed to parse scoring response: ${text.slice(0, 200)}`,
      matchedCategories: [],
      passed: false,
    };
  }
}
