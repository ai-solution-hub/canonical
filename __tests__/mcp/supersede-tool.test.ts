/**
 * MCP `supersede_content_item` tool tests (S186 WP-B.4).
 *
 * Matrix from docs/specs/supersession-model-spec.md §8.5:
 *   - Admin caller: success.
 *   - Editor caller: forbidden.
 *   - Viewer caller: forbidden.
 *   - old_id === new_id: SupersessionError → isError: true.
 *   - Chain attempt: SupersessionError → isError: true.
 *   - Happy path: structured content carries both row snapshots.
 *   - Supabase write failure: SupabaseError → isError: true.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockMcpServer,
  type MockToolHandler,
} from '@/__tests__/helpers/mcp-server';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  return {
    createMcpClient: vi.fn().mockReturnValue({ from: vi.fn() }),
    getMcpUserId: vi
      .fn()
      .mockReturnValue('11111111-1111-4111-8111-111111111111'),
    getMcpUserRole: vi.fn().mockResolvedValue('admin'),
    setSupersession: vi.fn(),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: vi.fn(),
}));

vi.mock('@/lib/supersession/set', async () => {
  const actual = await vi.importActual<typeof import('@/lib/supersession/set')>(
    '@/lib/supersession/set',
  );
  return {
    ...actual,
    setSupersession: mocks.setSupersession,
  };
});

// Import after mocks
import { registerSupersessionTools } from '@/lib/mcp/tools/supersession';
import {
  SupersessionError,
  type SetSupersessionResult,
} from '@/lib/supersession/set';
import { SupabaseError } from '@/lib/supabase/safe';

// ---------------------------------------------------------------------------
// Harness — uses canonical createMockMcpServer helper
// ---------------------------------------------------------------------------

const MOCK_AUTH_INFO = {
  token: 'test-token',
  clientId: 'test-client',
  scopes: ['read', 'write'],
  extra: {
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'admin',
  },
};

const OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// ID-131.37 F1 (owner S446 ruling): setSupersession operates on q_a_pairs
// (id-120 archived model) — `question_text` + `publication_status`, not
// the retired content_items shape (`title` + `dedup_status`).
const HAPPY_PATH_RESULT: SetSupersessionResult = {
  oldItem: {
    id: OLD_ID,
    question_text: 'Old revision',
    superseded_by: NEW_ID,
    publication_status: 'archived',
  },
  newItem: {
    id: NEW_ID,
    question_text: 'New revision',
    superseded_by: null,
    publication_status: 'published',
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MCP supersede_content_item', () => {
  let supersedeTool: MockToolHandler;

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.getMcpUserRole.mockResolvedValue('admin');
    mocks.getMcpUserId.mockReturnValue('11111111-1111-4111-8111-111111111111');
    mocks.setSupersession.mockResolvedValue(HAPPY_PATH_RESULT);

    const mockServer = createMockMcpServer();
    await registerSupersessionTools(mockServer.server);
    const tool = mockServer.getTool('supersede_content_item');
    if (!tool) throw new Error('supersede_content_item not registered');
    supersedeTool = tool.handler;
  });

  it('admin caller: success — returns structured content with both snapshots', async () => {
    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBeFalsy();
    expect(mocks.setSupersession).toHaveBeenCalledTimes(1);
    expect(mocks.setSupersession).toHaveBeenCalledWith(
      {
        oldId: OLD_ID,
        newId: NEW_ID,
        actorUserId: '11111111-1111-4111-8111-111111111111',
      },
      expect.anything(),
    );
    expect(result.structuredContent).toEqual({
      old_item: HAPPY_PATH_RESULT.oldItem,
      new_item: HAPPY_PATH_RESULT.newItem,
    });
    expect(result.content[0].text).toContain('Supersession recorded');
    expect(result.content[0].text).toContain('Old revision');
    expect(result.content[0].text).toContain('New revision');
  });

  it('editor caller: forbidden — handler short-circuits before hitting the helper', async () => {
    mocks.getMcpUserRole.mockResolvedValue('editor');

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('admin role');
    expect(mocks.setSupersession).not.toHaveBeenCalled();
  });

  it('viewer caller: forbidden', async () => {
    mocks.getMcpUserRole.mockResolvedValue('viewer');

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(mocks.setSupersession).not.toHaveBeenCalled();
  });

  it('old_id === new_id: SupersessionError surfaces as isError + carries the code', async () => {
    mocks.setSupersession.mockRejectedValue(
      new SupersessionError('SAME_ID', 'Cannot supersede an item with itself', {
        oldId: OLD_ID,
        newId: OLD_ID,
      }),
    );

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: OLD_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Cannot supersede');
    expect(result.structuredContent).toMatchObject({
      error_code: 'SAME_ID',
    });
  });

  it('chain attempt (target already superseded): SupersessionError NEW_ALREADY_SUPERSEDED', async () => {
    mocks.setSupersession.mockRejectedValue(
      new SupersessionError(
        'NEW_ALREADY_SUPERSEDED',
        `New item ${NEW_ID} is already superseded by ${OLD_ID}; cannot form a chain`,
        { newId: NEW_ID, existingSupersededBy: OLD_ID },
      ),
    );

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error_code: 'NEW_ALREADY_SUPERSEDED',
    });
    expect(result.content[0].text).toContain('cannot form a chain');
  });

  it('old not found: SupersessionError OLD_NOT_FOUND', async () => {
    mocks.setSupersession.mockRejectedValue(
      new SupersessionError('OLD_NOT_FOUND', `Old item not found: ${OLD_ID}`, {
        oldId: OLD_ID,
      }),
    );

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error_code: 'OLD_NOT_FOUND',
    });
  });

  it('Supabase write failure: returns isError with the SupabaseError message', async () => {
    mocks.setSupersession.mockRejectedValue(
      new SupabaseError(
        {
          message: 'permission denied for table content_items',
          code: '42501',
          details: '',
          hint: '',
          name: 'PostgrestError',
        } as unknown as import('@supabase/supabase-js').PostgrestError,
        'supersession.update_old',
      ),
    );

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Supersession failed');
    expect(result.content[0].text).toContain('permission denied');
  });

  it('unexpected error: returns isError with the raw message', async () => {
    mocks.setSupersession.mockRejectedValue(new Error('disk full'));

    const result = await supersedeTool(
      { old_id: OLD_ID, new_id: NEW_ID },
      { authInfo: MOCK_AUTH_INFO },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Unexpected error');
    expect(result.content[0].text).toContain('disk full');
  });
});
