// lib/intelligence/article-summariser.ts
import { getAnthropicClient } from '@/lib/anthropic';

/**
 * Generate a concise AI summary for a passed article.
 *
 * Uses Claude Haiku for cost efficiency. Produces a 2-3 sentence summary
 * (~50-80 words) suitable for RSS feed descriptions and quick scanning.
 *
 * Only called for articles that pass relevance scoring — filtered articles
 * skip this to avoid unnecessary API costs.
 */
export async function generateArticleSummary(
  title: string,
  content: string,
): Promise<string> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 200,
    system: `You are a professional news summariser. Write a concise summary of the article in 2-3 sentences (50-80 words). Focus on the key facts, decisions, or developments. Do not include opinions or editorialising. Write in UK English.`,
    messages: [
      {
        role: 'user',
        content: `Article title: ${title}\n\nArticle content:\n${content.slice(0, 4000)}`,
      },
    ],
  });

  const text =
    response.content[0].type === 'text' ? response.content[0].text : '';
  return text.trim();
}
