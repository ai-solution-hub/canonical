import { getAnthropicClient, getAIModel } from '@/lib/anthropic';

/**
 * JSON Schema for tender question extraction from PDF documents.
 */
export const TENDER_QUESTIONS_SCHEMA = {
  name: 'tender_questions',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      sections: {
        type: 'array' as const,
        items: {
          type: 'object' as const,
          properties: {
            section_name: { type: 'string' as const },
            section_sequence: { type: 'integer' as const },
            questions: {
              type: 'array' as const,
              items: {
                type: 'object' as const,
                properties: {
                  question_text: { type: 'string' as const },
                  question_sequence: { type: 'integer' as const },
                  word_limit: { type: ['integer', 'null'] as const },
                  evaluation_weight: { type: ['number', 'null'] as const },
                  category: {
                    type: 'string' as const,
                    enum: ['mandatory', 'desirable', 'informational'],
                  },
                },
                required: ['question_text', 'question_sequence', 'word_limit', 'evaluation_weight', 'category'] as const,
                additionalProperties: false,
              },
            },
          },
          required: ['section_name', 'section_sequence', 'questions'] as const,
          additionalProperties: false,
        },
      },
    },
    required: ['sections'] as const,
    additionalProperties: false,
  },
};

/**
 * JSON Schema for search query generation used in KB matching.
 */
export const SEARCH_QUERIES_SCHEMA = {
  name: 'search_queries',
  strict: true,
  schema: {
    type: 'object' as const,
    properties: {
      queries: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
      primary_topic: { type: 'string' as const },
      content_types_needed: {
        type: 'array' as const,
        items: { type: 'string' as const },
      },
    },
    required: ['queries', 'primary_topic', 'content_types_needed'] as const,
    additionalProperties: false,
  },
};

export interface ExtractedPDFQuestions {
  sections: Array<{
    section_name: string;
    section_sequence: number;
    questions: Array<{
      question_text: string;
      question_sequence: number;
      word_limit: number | null;
      evaluation_weight: number | null;
      category: 'mandatory' | 'desirable' | 'informational';
    }>;
  }>;
}

export interface GeneratedSearchQueries {
  queries: string[];
  primary_topic: string;
  content_types_needed: string[];
}

/**
 * Extract questions from a PDF tender document using Claude tool_use pattern.
 *
 * Uses forced tool_use (tool_choice) to guarantee structured JSON output.
 * The TENDER_QUESTIONS_SCHEMA above is retained for documentation and potential
 * future use with the Anthropic Structured Outputs API (output_config) once
 * it is stable in the SDK.
 */
export async function extractPDFQuestions(pdfBase64: string): Promise<ExtractedPDFQuestions> {
  return extractPDFQuestionsWithToolUse(pdfBase64);
}

/**
 * Fallback: Extract questions using the tool_use pattern (proven in existing codebase).
 */
async function extractPDFQuestionsWithToolUse(pdfBase64: string): Promise<ExtractedPDFQuestions> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 8192,
    system: `You are extracting questions from a UK tender document.
Extract ALL questions that require a written response from the bidder.
Ignore instructions, preamble, and administrative sections.
Group questions by section based on document headings.
Use UK English throughout.
You MUST call the extract_questions tool with your results.`,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: pdfBase64,
            },
          },
          {
            type: 'text',
            text: 'Extract all bid questions from this tender document.',
          },
        ],
      },
    ],
    tools: [
      {
        name: 'extract_questions',
        description: 'Store the extracted questions from the tender document',
        input_schema: {
          type: 'object' as const,
          properties: {
            sections: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  section_name: { type: 'string' },
                  section_sequence: { type: 'integer' },
                  questions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        question_text: { type: 'string' },
                        question_sequence: { type: 'integer' },
                        word_limit: { type: 'integer' },
                        evaluation_weight: { type: 'number' },
                        category: { type: 'string', enum: ['mandatory', 'desirable', 'informational'] },
                      },
                      required: ['question_text', 'question_sequence'],
                    },
                  },
                },
                required: ['section_name', 'section_sequence', 'questions'],
              },
            },
          },
          required: ['sections'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'extract_questions' },
  });

  const toolBlock = response.content.find(block => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No tool_use content in response');
  }
  return toolBlock.input as ExtractedPDFQuestions;
}

/**
 * Generate search queries for KB matching using Claude.
 */
export async function generateSearchQueries(questionText: string): Promise<GeneratedSearchQueries> {
  const anthropic = getAnthropicClient();

  const response = await anthropic.messages.create({
    model: getAIModel(),
    max_tokens: 1024,
    system: 'You generate search queries to find relevant knowledge base content for bid questions. Return 3-5 diverse search queries that would find relevant answers. Use UK English.',
    messages: [
      {
        role: 'user',
        content: `Generate search queries for this bid question: "${questionText}"`,
      },
    ],
    tools: [
      {
        name: 'search_queries',
        description: 'Return the generated search queries',
        input_schema: {
          type: 'object' as const,
          properties: {
            queries: {
              type: 'array',
              items: { type: 'string' },
            },
            primary_topic: { type: 'string' },
            content_types_needed: {
              type: 'array',
              items: { type: 'string' },
            },
          },
          required: ['queries', 'primary_topic', 'content_types_needed'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'search_queries' },
  });

  const toolBlock = response.content.find(block => block.type === 'tool_use');
  if (!toolBlock || toolBlock.type !== 'tool_use') {
    throw new Error('No tool_use content in response');
  }
  return toolBlock.input as GeneratedSearchQueries;
}
