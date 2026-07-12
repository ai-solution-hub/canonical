/**
 * Unit tests for get_question_matches MCP tool.
 *
 * ID-145 {145.17} — BI-36: form-scoped reader over question_match_search.
 * Covers: registration annotations, happy path, empty state, RPC error
 * surfacing, optional question_kind/limit pass-through.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockMcpServer,
  createMockExtra,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: vi.fn().mockReturnValue({ rpc: mocks.rpc }),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { registerQuestionMatchTools } from '@/lib/mcp/tools/question-matches';

const QUESTION_UUID = '00000000-0000-4000-8000-000000000001';

describe('get_question_matches MCP tool', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockServer = createMockMcpServer();
    await registerQuestionMatchTools(mockServer.server);
  });

  it('registers with READ_ONLY annotations', () => {
    const tool = mockServer.getTool('get_question_matches');
    expect(tool).toBeDefined();
    expect(tool!.config.annotations).toEqual({
      readOnlyHint: true,
      idempotentHint: true,
      destructiveHint: false,
      openWorldHint: false,
    });
  });

  it('returns matches with markdown + structuredContent on the happy path', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: [
        {
          q_a_pair_id: 'pair-1',
          question_text_preview: 'How do we demonstrate GDPR compliance?',
          answer_standard_preview: 'We operate documented DPAs.',
          embedding_score: 0.83,
          fulltext_score: 0.5,
          scope_tag: ['itt', 'construction'],
          publication_status: 'published',
        },
      ],
      error: null,
    });

    const handler = mockServer.getHandler('get_question_matches')!;
    const result = await handler(
      { question_id: QUESTION_UUID },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(mocks.rpc).toHaveBeenCalledWith('question_match_search', {
      p_form_question_id: QUESTION_UUID,
      p_question_kind: undefined,
      p_limit: 20,
    });
    expect(result.content[0].text).toContain('GDPR compliance');
    expect(result.content[0].text).toContain('pair-1');
    expect(result.structuredContent.question_id).toBe(QUESTION_UUID);
    expect(result.structuredContent.count).toBe(1);
    expect(result.structuredContent.matches[0].q_a_pair_id).toBe('pair-1');
  });

  it('passes question_kind and limit through to the RPC when provided', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const handler = mockServer.getHandler('get_question_matches')!;
    await handler(
      { question_id: QUESTION_UUID, question_kind: 'itt', limit: 5 },
      createMockExtra(),
    );

    expect(mocks.rpc).toHaveBeenCalledWith('question_match_search', {
      p_form_question_id: QUESTION_UUID,
      p_question_kind: 'itt',
      p_limit: 5,
    });
  });

  it('returns a friendly empty-state message when there are no matches', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [], error: null });

    const handler = mockServer.getHandler('get_question_matches')!;
    const result = await handler(
      { question_id: QUESTION_UUID },
      createMockExtra(),
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain('No corpus matches found');
    expect(result.structuredContent.count).toBe(0);
  });

  it('returns isError when the RPC call fails', async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused' },
    });

    const handler = mockServer.getHandler('get_question_matches')!;
    const result = await handler(
      { question_id: QUESTION_UUID },
      createMockExtra(),
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Failed to get question matches');
  });

  it('never requires a workspace id in its input schema', () => {
    const config = mockServer.getTool('get_question_matches')!.config as {
      inputSchema: Record<string, unknown>;
    };
    expect(config.inputSchema.workspace_id).toBeUndefined();
    expect(config.inputSchema.question_id).toBeDefined();
  });
});
