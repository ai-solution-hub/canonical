import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import type Anthropic from '@anthropic-ai/sdk';
import { extractToolResult } from '@/lib/ai-parse';

// Helper: create a mock Anthropic message
function createMockMessage(
  content: Anthropic.Messages.ContentBlock[],
  overrides?: Partial<Anthropic.Messages.Message>,
): Anthropic.Messages.Message {
  return {
    id: 'msg_test_123',
    type: 'message',
    role: 'assistant',
    container: null,
    content,
    model: 'claude-sonnet-4-6-20250514',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation: null,
      cache_creation_input_tokens: null,
      cache_read_input_tokens: null,
      inference_geo: null,
      server_tool_use: null,
      service_tier: null,
    },
    ...overrides,
  };
}

// Helper: create a tool_use content block
function createToolUseBlock(
  name: string,
  input: Record<string, unknown>,
  id = 'toolu_test_001',
): Anthropic.Messages.ToolUseBlock {
  return {
    type: 'tool_use',
    id,
    name,
    input,
    caller: { type: 'direct' as const },
  };
}

// Helper: create a text content block
function createTextBlock(text: string): Anthropic.Messages.TextBlock {
  return {
    type: 'text',
    text,
    citations: null,
  };
}

// Type used in tests to verify generic typing
interface MockClassification {
  domain: string;
  subtopic: string;
  confidence: number;
}

describe('extractToolResult', () => {
  it('should extract tool result when tool block exists with matching name', () => {
    const expectedInput = {
      domain: 'SECURITY',
      subtopic: 'LLM Applications',
      confidence: 0.95,
    };
    const message = createMockMessage([
      createToolUseBlock('classify_content', expectedInput),
    ]);

    const result = extractToolResult<MockClassification>(
      message,
      'classify_content',
    );

    expect(result).toEqual(expectedInput);
  });

  it('should throw error when no tool_use block exists in response', () => {
    const message = createMockMessage([
      createTextBlock('I could not classify this content.'),
    ]);

    expect(() =>
      extractToolResult<MockClassification>(message, 'classify_content'),
    ).toThrow('Claude did not return a classify_content tool call');
  });

  it('should throw error when tool_use block has wrong name', () => {
    const message = createMockMessage([
      createToolUseBlock('wrong_tool', { some: 'data' }),
    ]);

    expect(() =>
      extractToolResult<MockClassification>(message, 'classify_content'),
    ).toThrow('Claude did not return a classify_content tool call');
  });

  it('should handle response with multiple content blocks (text + tool_use)', () => {
    const expectedInput = {
      domain: 'PRODUCT & DESIGN',
      subtopic: 'UX Research',
      confidence: 0.88,
    };
    const message = createMockMessage([
      createTextBlock('Here is the classification result:'),
      createToolUseBlock('classify_content', expectedInput),
    ]);

    const result = extractToolResult<MockClassification>(
      message,
      'classify_content',
    );

    expect(result).toEqual(expectedInput);
  });

  it('should return first matching tool_use block when multiple exist', () => {
    const firstInput = {
      domain: 'SECURITY',
      subtopic: 'LLM Applications',
      confidence: 0.95,
    };
    const secondInput = {
      domain: 'PRODUCT & DESIGN',
      subtopic: 'UX Research',
      confidence: 0.7,
    };
    const message = createMockMessage([
      createToolUseBlock('classify_content', firstInput, 'toolu_first'),
      createToolUseBlock('classify_content', secondInput, 'toolu_second'),
    ]);

    const result = extractToolResult<MockClassification>(
      message,
      'classify_content',
    );

    expect(result).toEqual(firstInput);
    expect(result.domain).toBe('SECURITY');
  });

  it('should return the input object with correct structure', () => {
    const input = {
      suggested_title: 'How to Build AI Agents',
      summary: 'A guide to building autonomous AI agents.',
      ai_keywords: ['AI', 'agents', 'autonomy'],
      primary_domain: 'SECURITY',
      primary_subtopic: 'AI Agents & Autonomy',
      confidence: 0.92,
      classification_reasoning: 'Content focuses on AI agent architecture.',
    };
    const message = createMockMessage([
      createToolUseBlock('classify_content', input),
    ]);

    const result = extractToolResult<typeof input>(message, 'classify_content');

    expect(result.suggested_title).toBe('How to Build AI Agents');
    expect(result.ai_keywords).toEqual(['AI', 'agents', 'autonomy']);
    expect(result.confidence).toBe(0.92);
    expect(result.classification_reasoning).toBe(
      'Content focuses on AI agent architecture.',
    );
  });

  it('should handle max_tokens stop_reason when tool block is missing', () => {
    const message = createMockMessage(
      [createTextBlock('Partial response that got cut off...')],
      { stop_reason: 'max_tokens' },
    );

    expect(() =>
      extractToolResult<MockClassification>(message, 'classify_content'),
    ).toThrow('Claude did not return a classify_content tool call');
  });

  it('should find correct tool among multiple different tool_use blocks', () => {
    const summaryInput = {
      executive: 'A brief summary',
      model: 'claude-sonnet-4-6',
    };
    const classifyInput = {
      domain: 'LEADERSHIP & MANAGEMENT',
      subtopic: 'Team Building',
      confidence: 0.85,
    };
    const message = createMockMessage([
      createTextBlock('Processing...'),
      createToolUseBlock('generate_summary', summaryInput, 'toolu_summary'),
      createToolUseBlock('classify_content', classifyInput, 'toolu_classify'),
    ]);

    const result = extractToolResult<MockClassification>(
      message,
      'classify_content',
    );

    expect(result).toEqual(classifyInput);
    expect(result.domain).toBe('LEADERSHIP & MANAGEMENT');
  });

  it('should include the tool name in the error message', () => {
    const message = createMockMessage([createTextBlock('No tools here')]);

    expect(() => extractToolResult(message, 'my_special_tool')).toThrow(
      'my_special_tool',
    );
  });

  it('should handle empty content array', () => {
    const message = createMockMessage([]);

    expect(() =>
      extractToolResult<MockClassification>(message, 'classify_content'),
    ).toThrow('Claude did not return a classify_content tool call');
  });

  // ── Schema validation tests ──

  const TestSchema = z.object({
    executive: z.string(),
    detailed: z.string(),
    takeaways: z.array(z.string()),
  });

  type TestSchemaType = z.infer<typeof TestSchema>;

  it('should validate and return parsed data when schema is provided and valid', () => {
    const validInput = {
      executive: 'A brief executive summary.',
      detailed: 'A detailed multi-paragraph summary of the content.',
      takeaways: ['Takeaway one', 'Takeaway two'],
    };
    const message = createMockMessage([
      createToolUseBlock('return_summary', validInput),
    ]);

    const result = extractToolResult<TestSchemaType>(
      message,
      'return_summary',
      TestSchema,
    );

    expect(result).toEqual(validInput);
  });

  it('should fall back to unvalidated result when schema validation fails', () => {
    const invalidInput = {
      executive: 'A summary',
      detailed: 123, // wrong type — should be string
      takeaways: 'not an array', // wrong type — should be array
    };
    const message = createMockMessage([
      createToolUseBlock('return_summary', invalidInput),
    ]);

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = extractToolResult<TestSchemaType>(
      message,
      'return_summary',
      TestSchema,
    );

    // Should fall back to the raw input without throwing
    expect(result).toEqual(invalidInput);
    // Should log the validation error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'AI response validation failed for return_summary',
      ),
      expect.any(Array),
    );

    consoleSpy.mockRestore();
  });

  it('should still work without schema (backwards compatibility)', () => {
    const input = {
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['One'],
    };
    const message = createMockMessage([
      createToolUseBlock('return_summary', input),
    ]);

    // No schema passed — should behave exactly as before
    const result = extractToolResult<TestSchemaType>(message, 'return_summary');

    expect(result).toEqual(input);
  });

  it('should strip extra fields when schema validation succeeds', () => {
    const inputWithExtras = {
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['One'],
      extra_field: 'This should be stripped by Zod',
    };
    const message = createMockMessage([
      createToolUseBlock('return_summary', inputWithExtras),
    ]);

    const result = extractToolResult<TestSchemaType>(
      message,
      'return_summary',
      TestSchema,
    );

    // Zod strips unknown keys by default
    expect(result).toEqual({
      executive: 'Summary',
      detailed: 'Details',
      takeaways: ['One'],
    });
    expect(result).not.toHaveProperty('extra_field');
  });
});
