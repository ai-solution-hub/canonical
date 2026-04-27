// __tests__/lib/intelligence/article-summariser.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateArticleSummary } from '@/lib/intelligence/article-summariser';

const mockCreate = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: vi.fn().mockReturnValue({
    messages: {
      create: (...args: unknown[]) => mockCreate(...args),
    },
  }),
}));

describe('generateArticleSummary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('generates a summary using Claude Haiku', async () => {
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: 'The Department for Education has announced new safeguarding requirements for multi-academy trusts. Schools must implement revised procedures by September 2026.',
        },
      ],
    });

    const summary = await generateArticleSummary(
      'DfE announces safeguarding changes',
      'Long article content about new safeguarding requirements...',
    );

    expect(summary).toContain('Department for Education');
    expect(mockCreate).toHaveBeenCalledOnce();

    // Verify model is Haiku
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5');
  });

  it('sends truncated content (max 4000 chars) to avoid token waste', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Summary of long article.' }],
    });

    const longContent = 'x'.repeat(10000);
    await generateArticleSummary('Title', longContent);

    const callArgs = mockCreate.mock.calls[0][0];
    const userMessage = callArgs.messages[0].content;
    // Content should be truncated to 4000 chars within the user message
    expect(userMessage.length).toBeLessThan(10000);
  });

  it('includes a system prompt requesting UK English and concise format', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'A summary.' }],
    });

    await generateArticleSummary('Title', 'Content');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toContain('UK English');
    expect(callArgs.system).toContain('2-3 sentences');
    expect(callArgs.system).toContain('50-80 words');
  });

  it('trims whitespace from the response', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: '  Summary with spaces.  \n' }],
    });

    const summary = await generateArticleSummary('Title', 'Content');
    expect(summary).toBe('Summary with spaces.');
  });

  it('returns empty string when response has no text block', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'tool_use', id: 'test', name: 'test', input: {} }],
    });

    const summary = await generateArticleSummary('Title', 'Content');
    expect(summary).toBe('');
  });

  it('propagates API errors to caller', async () => {
    mockCreate.mockRejectedValue(new Error('API rate limit exceeded'));

    await expect(generateArticleSummary('Title', 'Content')).rejects.toThrow(
      'API rate limit exceeded',
    );
  });

  it('sets max_tokens to 200 for cost control', async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Summary.' }],
    });

    await generateArticleSummary('Title', 'Content');

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(200);
  });
});
