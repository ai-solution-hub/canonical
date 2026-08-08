/**
 * GET /api/oauth/grants — the Connected Apps list in settings.
 *
 * Split out of the former `__tests__/app/api/remaining-routes.test.ts`
 * catch-all (test-tree workstream 2b) so each production route has exactly one
 * test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

// Import the route AFTER mocks are registered
import { GET as oauthGrantsGet } from '@/app/api/oauth/grants/route';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';

/**
 * The OAuth surface (`supabase.auth.oauth`) is not part of the shared mock
 * client's shape, so it is attached per-test-file.
 */
interface OAuthGrantsMocks {
  listGrants: ReturnType<typeof vi.fn>;
}

let oauth: OAuthGrantsMocks;

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  oauth = {
    listGrants: vi.fn().mockResolvedValue({ data: [], error: null }),
  };
  (mockSupabase.auth as unknown as { oauth: OAuthGrantsMocks }).oauth = oauth;
});

describe('GET /api/oauth/grants', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const res = await oauthGrantsGet();
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 200 with empty grants list', async () => {
    const res = await oauthGrantsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.grants).toEqual([]);
  });

  it('returns 200 with grants data', async () => {
    const grants = [
      {
        id: VALID_UUID,
        client_id: VALID_UUID_2,
        client_name: 'Test App',
        scopes: ['read', 'write'],
        granted_at: '2026-03-01T00:00:00Z',
      },
    ];
    oauth.listGrants.mockResolvedValueOnce({ data: grants, error: null });

    const res = await oauthGrantsGet();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.grants).toHaveLength(1);
    expect(body.grants[0].client_name).toBe('Test App');
  });

  it('returns 500 when listGrants fails', async () => {
    oauth.listGrants.mockResolvedValueOnce({
      data: null,
      error: { message: 'Service unavailable' },
    });

    const res = await oauthGrantsGet();
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
