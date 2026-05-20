/**
 * Quality check for AI-drafted bid responses.
 * Combines deterministic checks (word count, citation coverage) with an
 * AI-assisted check (Haiku via Structured Outputs) for unsupported claims.
 */

import type {
  CitationEntry,
  QualityData,
  QualityIssueEntry,
} from '@/types/procurement-metadata';
import { countWords } from '@/lib/editor-utils';
import { stripMarkdown } from '@/lib/content/strip-markdown';
import {
  getAnthropicClient,
  getModelForTier,
  estimateCost,
} from '@/lib/anthropic';

/** Minimal question shape for quality checks */
export interface QualityCheckQuestion {
  question_text: string;
  word_limit: number | null;
}

/** JSON schema for the AI quality check response (used with Structured Outputs) */
const qualityCheckSchema = {
  type: 'object',
  properties: {
    unsupported_claims: {
      type: 'array',
      items: { type: 'string' },
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
    },
    overall_score: {
      type: 'integer',
    },
  },
  required: ['unsupported_claims', 'suggestions', 'overall_score'],
  additionalProperties: false,
} as const;

/** Result from the AI quality check pass */
interface AIQualityResult {
  unsupported_claims: string[];
  suggestions: string[];
  overall_score: number;
}

/**
 * Run deterministic quality checks on a response.
 * These don't require AI and can run on client or server.
 */
export function runDeterministicChecks(
  responseMarkdown: string,
  citations: CitationEntry[],
  question: QualityCheckQuestion,
  matchedContentCount: number,
): { wordCount: number; issues: QualityIssueEntry[] } {
  const issues: QualityIssueEntry[] = [];
  const plainText = stripMarkdown(responseMarkdown);
  const wordCount = countWords(plainText);

  // Word count compliance
  if (question.word_limit && wordCount > question.word_limit) {
    issues.push({
      type: 'word_limit',
      severity: 'error',
      message: `Response is ${wordCount - question.word_limit} words over the ${question.word_limit}-word limit`,
    });
  } else if (question.word_limit && wordCount < question.word_limit * 0.7) {
    issues.push({
      type: 'word_limit',
      severity: 'warning',
      message: `Response is only ${wordCount} words (${Math.round((wordCount / question.word_limit) * 100)}% of ${question.word_limit}-word limit). Consider adding more detail.`,
    });
  }

  // Citation coverage
  if (citations.length === 0 && matchedContentCount > 0) {
    issues.push({
      type: 'unsupported_claim',
      severity: 'warning',
      message: 'Response has no citations despite KB content being available',
    });
  }

  // Empty response
  if (wordCount === 0) {
    issues.push({
      type: 'missing_section',
      severity: 'error',
      message: 'Response is empty',
    });
  }

  return { wordCount, issues };
}

/**
 * Run the AI-assisted quality check using Haiku with Structured Outputs.
 * Returns unsupported claims, suggestions, and an overall score.
 */
async function runAIQualityCheck(
  question: QualityCheckQuestion,
  responseMarkdown: string,
  citations: CitationEntry[],
  matchedContentCount: number,
): Promise<{
  result: AIQualityResult;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}> {
  const anthropic = getAnthropicClient();
  const model = getModelForTier('quality');
  const plainText = stripMarkdown(responseMarkdown);

  const aiCheck = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system:
      'You are a bid quality reviewer. Check the response for unsupported claims, weak language, and completeness. Be concise. Score 0-100 where 100 is perfect.',
    messages: [
      {
        role: 'user',
        content: `Question: "${question.question_text}"
Response: "${plainText}"
Number of citations: ${citations.length}
Available KB sources: ${matchedContentCount}

Check for:
1. Any claims not supported by the cited KB content
2. Weak or vague language that should be more specific
3. Whether all key aspects of the question are addressed`,
      },
    ],
    output_config: {
      format: {
        type: 'json_schema' as const,
        schema: qualityCheckSchema,
      },
    },
  });

  // Structured Outputs guarantees valid JSON in response.content[0].text
  const textBlock = aiCheck.content.find((b) => b.type === 'text');
  let aiResult: AIQualityResult = {
    unsupported_claims: [],
    suggestions: [
      'Quality check could not parse AI response — manual review recommended',
    ],
    overall_score: 0,
  };

  if (textBlock?.type === 'text') {
    try {
      aiResult = JSON.parse(textBlock.text);
    } catch {
      // Structured Outputs should guarantee valid JSON, but handle edge cases
      // (e.g., stop_reason: 'max_tokens' or content filtering)
    }
  }

  const inputTokens = aiCheck.usage.input_tokens;
  const outputTokens = aiCheck.usage.output_tokens;
  const tokensUsed = inputTokens + outputTokens;
  const cost = estimateCost(model, {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    cache_creation_input_tokens:
      aiCheck.usage.cache_creation_input_tokens ?? undefined,
    cache_read_input_tokens: aiCheck.usage.cache_read_input_tokens ?? undefined,
  });

  return { result: aiResult, tokensUsed, inputTokens, outputTokens, cost };
}

/**
 * Full quality check: deterministic + AI-assisted.
 * Returns QualityData suitable for storing in bid_responses.metadata.
 */
export async function checkResponseQuality(
  question: QualityCheckQuestion,
  responseMarkdown: string,
  citations: CitationEntry[],
  matchedContentCount: number,
): Promise<{
  qualityData: QualityData;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
}> {
  // Deterministic checks first
  const { wordCount, issues } = runDeterministicChecks(
    responseMarkdown,
    citations,
    question,
    matchedContentCount,
  );

  // AI-assisted check
  const {
    result: aiResult,
    tokensUsed,
    inputTokens,
    outputTokens,
    cost,
  } = await runAIQualityCheck(
    question,
    responseMarkdown,
    citations,
    matchedContentCount,
  );

  // Merge AI issues into deterministic issues
  for (const claim of aiResult.unsupported_claims) {
    issues.push({
      type: 'unsupported_claim',
      severity: 'warning',
      message: claim,
    });
  }

  const qualityData: QualityData = {
    overall_score: aiResult.overall_score,
    word_count: wordCount,
    word_limit_compliance: question.word_limit
      ? wordCount <= question.word_limit
      : true,
    citation_count: citations.length,
    unsupported_claims: aiResult.unsupported_claims,
    suggestions: aiResult.suggestions,
    issues,
  };

  return { qualityData, tokensUsed, inputTokens, outputTokens, cost };
}
