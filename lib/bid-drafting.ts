/**
 * Three-pass AI response drafting pipeline for bid questions.
 *
 * Pass 1 (Sonnet): Question analysis — identify topics, structure, tone
 * Pass 2 (Opus):   Response drafting — Search Result Citations for sourced responses
 * Pass 3 (Haiku):  Quality check — deterministic + AI verification
 *
 * Citations and Structured Outputs are incompatible in the Claude API,
 * so these MUST remain as separate API calls.
 */

import type { CitationEntry } from '@/types/bid-metadata';
import type { BidResponseMetadata } from '@/types/bid-metadata';
import {
  getAnthropicClient,
  getModelForTier,
  estimateCost,
  type ModelTier,
} from '@/lib/anthropic';
import { extractCitedResponse, type CitationSourceItem } from '@/lib/citations';
import { checkResponseQuality, type QualityCheckQuestion } from '@/lib/quality-check';

// ──────────────────────────────────────────
// Types
// ──────────────────────────────────────────

export interface ResponseStructure {
  suggested_headings: string[];
  word_allocation: Record<string, number>;
}

export interface QuestionAnalysis {
  primary_topic: string;
  content_types_needed: string[];
  response_structure: ResponseStructure;
  key_points_to_cover: string[];
  tone: 'formal' | 'technical' | 'conversational';
}

/** Minimal bid question shape for the drafting pipeline */
export interface DraftableQuestion {
  id: string;
  question_text: string;
  word_limit: number | null;
  section_name: string | null;
  confidence_posture: string | null;
}

/** Content item shape needed for drafting (with full text) */
export interface DraftableContent extends CitationSourceItem {
  content_type: string | null;
  ai_summary: string | null;
}

/** Result from the full drafting pipeline */
export interface DraftResult {
  response_text: string;
  citations: CitationEntry[];
  source_content_ids: string[];
  analysis: QuestionAnalysis;
  metadata: BidResponseMetadata;
  total_tokens: number;
  total_cost: number;
}

// ──────────────────────────────────────────
// Pass 1: Question Analysis (Sonnet)
// ──────────────────────────────────────────

const questionAnalysisSchema = {
  type: 'object',
  properties: {
    primary_topic: { type: 'string' },
    content_types_needed: {
      type: 'array',
      items: { type: 'string' },
    },
    response_structure: {
      type: 'object',
      properties: {
        suggested_headings: {
          type: 'array',
          items: { type: 'string' },
        },
        word_allocation: {
          type: 'object',
          additionalProperties: { type: 'integer' },
        },
      },
      required: ['suggested_headings', 'word_allocation'],
      additionalProperties: false,
    },
    key_points_to_cover: {
      type: 'array',
      items: { type: 'string' },
    },
    tone: {
      type: 'string',
      enum: ['formal', 'technical', 'conversational'],
    },
  },
  required: [
    'primary_topic',
    'content_types_needed',
    'response_structure',
    'key_points_to_cover',
    'tone',
  ],
  additionalProperties: false,
} as const;

export async function analyseQuestion(
  question: DraftableQuestion,
  matchedContent: DraftableContent[],
): Promise<{ analysis: QuestionAnalysis; tokensUsed: number; inputTokens: number; outputTokens: number; cost: number }> {
  const anthropic = getAnthropicClient();
  const model = getModelForTier('analysis');

  const response = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    system: `You are a UK bid writing analyst. Analyse this bid question and suggest how to structure the response.
Consider the word limit and the available KB content.
Use UK English throughout.`,
    messages: [
      {
        role: 'user',
        content: `Question: "${question.question_text}"
Word limit: ${question.word_limit ?? 'No limit specified'}
Section: ${question.section_name ?? 'Not specified'}
Available KB content summaries:
${matchedContent.map((c, i) => `${i + 1}. [${c.content_type}] ${c.title}: ${c.ai_summary}`).join('\n')}`,
      },
    ],
    output_config: {
      format: {
        type: 'json_schema' as const,
        schema: questionAnalysisSchema,
      },
    },
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  let analysis: QuestionAnalysis = {
    primary_topic: question.question_text.slice(0, 100),
    content_types_needed: [],
    response_structure: { suggested_headings: [], word_allocation: {} },
    key_points_to_cover: [],
    tone: 'formal',
  };

  if (textBlock?.type === 'text') {
    try {
      analysis = JSON.parse(textBlock.text);
    } catch {
      // Fall through to default
    }
  }

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const tokensUsed = inputTokens + outputTokens;
  const cost = estimateCost(model, response.usage);

  return { analysis, tokensUsed, inputTokens, outputTokens, cost };
}

// ──────────────────────────────────────────
// Pass 2: Response Drafting with Citations (Opus)
// ──────────────────────────────────────────

interface Pass2Result {
  responseText: string;
  citations: CitationEntry[];
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  cost: number;
  model: string;
}

export async function draftResponse(
  question: DraftableQuestion,
  matchedContent: DraftableContent[],
  analysis: QuestionAnalysis,
  modelTier: ModelTier = 'drafting',
  regenerationInstructions?: string,
): Promise<Pass2Result> {
  const anthropic = getAnthropicClient();
  const model = getModelForTier(modelTier);

  // Build search result blocks from KB entries with citations enabled
  const sourceBlocks = matchedContent.map((item) => ({
    type: 'search_result' as const,
    source: `/item/${item.id}`,
    title: item.title ?? 'Untitled',
    content: [
      {
        type: 'text' as const,
        text: item.content ?? '',
      },
    ],
    citations: { enabled: true },
    cache_control: { type: 'ephemeral' as const },
  }));

  const wordLimitInstruction = question.word_limit
    ? `Aim for 90-95% of the ${question.word_limit}-word limit`
    : 'No specific limit, but be concise and thorough';

  const headings = analysis.response_structure.suggested_headings.join(' > ');
  const keyPoints = analysis.key_points_to_cover.join(', ');

  let systemText = `You are a professional UK bid writer for a technology company.

RULES:
- Write in UK English throughout
- Be specific and factual, citing the provided KB content
- Word limit: ${wordLimitInstruction}
- Structure: ${headings}
- Key points to cover: ${keyPoints}
- Tone: ${analysis.tone}
- NEVER fabricate information not in the KB content
- If the KB content does not cover a point, say "Our documentation on [topic] is being updated" rather than guessing
- Use the company's own language and terminology from the KB content
- Every factual claim MUST be supported by the provided KB content`;

  if (regenerationInstructions) {
    systemText += `\n\nADDITIONAL INSTRUCTIONS FROM REVIEWER:\n${regenerationInstructions}`;
  }

  const response = await anthropic.messages.create({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          ...sourceBlocks,
          {
            type: 'text',
            text: `\n\nDraft a response to this bid question:\n\n"${question.question_text}"`,
          },
        ],
      },
    ],
  });

  const { text, citations } = extractCitedResponse(response, matchedContent);

  const inputTokens = response.usage.input_tokens;
  const outputTokens = response.usage.output_tokens;
  const tokensUsed = inputTokens + outputTokens;
  const cost = estimateCost(model, response.usage);

  return { responseText: text, citations, tokensUsed, inputTokens, outputTokens, cost, model };
}

// ──────────────────────────────────────────
// Pass 2 Streaming Variant
// ──────────────────────────────────────────

/**
 * Stream Pass 2 (response drafting) token-by-token. Returns an async
 * generator that yields text deltas, plus a `finalise()` function that
 * returns the complete Pass2Result with extracted citations.
 *
 * Usage:
 *   const stream = draftResponseStreaming(question, content, analysis);
 *   for await (const chunk of stream.textStream) { write(chunk); }
 *   const result = await stream.finalise();
 */
export function draftResponseStreaming(
  question: DraftableQuestion,
  matchedContent: DraftableContent[],
  analysis: QuestionAnalysis,
  modelTier: ModelTier = 'drafting',
  regenerationInstructions?: string,
): { textStream: AsyncIterable<string>; finalise: () => Promise<Pass2Result> } {
  const anthropic = getAnthropicClient();
  const model = getModelForTier(modelTier);

  const sourceBlocks = matchedContent.map((item) => ({
    type: 'search_result' as const,
    source: `/item/${item.id}`,
    title: item.title ?? 'Untitled',
    content: [
      {
        type: 'text' as const,
        text: item.content ?? '',
      },
    ],
    citations: { enabled: true },
    cache_control: { type: 'ephemeral' as const },
  }));

  const wordLimitInstruction = question.word_limit
    ? `Aim for 90-95% of the ${question.word_limit}-word limit`
    : 'No specific limit, but be concise and thorough';

  const headings = analysis.response_structure.suggested_headings.join(' > ');
  const keyPoints = analysis.key_points_to_cover.join(', ');

  let systemText = `You are a professional UK bid writer for a technology company.

RULES:
- Write in UK English throughout
- Be specific and factual, citing the provided KB content
- Word limit: ${wordLimitInstruction}
- Structure: ${headings}
- Key points to cover: ${keyPoints}
- Tone: ${analysis.tone}
- NEVER fabricate information not in the KB content
- If the KB content does not cover a point, say "Our documentation on [topic] is being updated" rather than guessing
- Use the company's own language and terminology from the KB content
- Every factual claim MUST be supported by the provided KB content`;

  if (regenerationInstructions) {
    systemText += `\n\nADDITIONAL INSTRUCTIONS FROM REVIEWER:\n${regenerationInstructions}`;
  }

  const messageStream = anthropic.messages.stream({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: systemText,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          ...sourceBlocks,
          {
            type: 'text',
            text: `\n\nDraft a response to this bid question:\n\n"${question.question_text}"`,
          },
        ],
      },
    ],
  });

  // Create async iterable from the stream's text events
  const textStream: AsyncIterable<string> = {
    async *[Symbol.asyncIterator]() {
      for await (const event of messageStream) {
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          yield event.delta.text;
        }
      }
    },
  };

  // Finalise: collect the complete message and extract citations + usage
  async function finalise(): Promise<Pass2Result> {
    const finalMessage = await messageStream.finalMessage();
    const { text, citations } = extractCitedResponse(finalMessage, matchedContent);
    const inputTokens = finalMessage.usage.input_tokens;
    const outputTokens = finalMessage.usage.output_tokens;
    const tokensUsed = inputTokens + outputTokens;
    const cost = estimateCost(model, finalMessage.usage);

    return { responseText: text, citations, tokensUsed, inputTokens, outputTokens, cost, model };
  }

  return { textStream, finalise };
}

// ──────────────────────────────────────────
// Full Pipeline Orchestrator
// ──────────────────────────────────────────

/**
 * Run the full three-pass drafting pipeline for a single question.
 * Returns the drafted response with citations, quality data, and metadata.
 */
export async function runDraftingPipeline(
  question: DraftableQuestion,
  matchedContent: DraftableContent[],
  modelTier: ModelTier = 'drafting',
  regenerationInstructions?: string,
): Promise<DraftResult> {
  let totalTokens = 0;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  // Pass 1: Analyse the question
  const {
    analysis,
    tokensUsed: analysisTokens,
    inputTokens: analysisInput,
    outputTokens: analysisOutput,
    cost: analysisCost,
  } = await analyseQuestion(question, matchedContent);
  totalTokens += analysisTokens;
  totalInputTokens += analysisInput;
  totalOutputTokens += analysisOutput;
  totalCost += analysisCost;

  // Pass 2: Draft the response with citations
  const {
    responseText,
    citations,
    tokensUsed: draftTokens,
    inputTokens: draftInput,
    outputTokens: draftOutput,
    cost: draftCost,
    model: draftModel,
  } = await draftResponse(question, matchedContent, analysis, modelTier, regenerationInstructions);
  totalTokens += draftTokens;
  totalInputTokens += draftInput;
  totalOutputTokens += draftOutput;
  totalCost += draftCost;

  // Pass 3: Quality check
  const qualityQuestion: QualityCheckQuestion = {
    question_text: question.question_text,
    word_limit: question.word_limit,
  };
  const {
    qualityData,
    tokensUsed: qualityTokens,
    inputTokens: qualityInput,
    outputTokens: qualityOutput,
    cost: qualityCost,
  } = await checkResponseQuality(qualityQuestion, responseText, citations, matchedContent.length);
  totalTokens += qualityTokens;
  totalInputTokens += qualityInput;
  totalOutputTokens += qualityOutput;
  totalCost += qualityCost;

  // Assemble metadata
  const metadata: BidResponseMetadata = {
    citations_data: {
      citations,
      source_content_ids: matchedContent.map((c) => c.id),
    },
    quality_data: qualityData,
    ai_metadata: {
      model: draftModel,
      tokens_input: totalInputTokens,
      tokens_output: totalOutputTokens,
      cost_estimate: totalCost,
      generated_at: new Date().toISOString(),
      analysis_model: getModelForTier('analysis'),
      quality_model: getModelForTier('quality'),
      regeneration_instructions: regenerationInstructions,
    },
  };

  return {
    response_text: responseText,
    citations,
    source_content_ids: matchedContent.map((c) => c.id),
    analysis,
    metadata,
    total_tokens: totalTokens,
    total_cost: totalCost,
  };
}
