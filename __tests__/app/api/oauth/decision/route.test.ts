/**
 * POST /api/oauth/decision — the consent page's approve/deny form target.
 *
 * Split out of the former `__tests__/app/api/remaining-routes.test.ts`
 * catch-all (test-tree workstream 2b) so each production route has exactly one
 * test file.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

// Import the route AFTER mocks are registered
import { POST as oauthDecisionPost } from '@/app/api/oauth/decision/route';

/**
 * The OAuth surface (`supabase.auth.oauth`) is not part of the shared mock
 * client's shape, so it is attached per-test-file.
 */
interface OAuthDecisionMocks {
  approveAuthorization: ReturnType<typeof vi.fn>;
  denyAuthorization: ReturnType<typeof vi.fn>;
}

let oauth: OAuthDecisionMocks;

/**
 * Create a Request with FormData body (the consent page posts a form).
 */
function createFormDataRequest(
  path: string,
  fields: Record<string, string>,
): Request {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.append(key, value);
  }
  return new Request(new URL(path, 'http://localhost:3000'), {
    method: 'POST',
    body: formData,
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  oauth = {
    approveAuthorization: vi.fn().mockResolvedValue({
      data: { redirect_url: 'https://example.com/callback?code=abc' },
      error: null,
    }),
    denyAuthorization: vi.fn().mockResolvedValue({
      data: { redirect_url: 'https://example.com/callback?error=denied' },
      error: null,
    }),
  };
  (mockSupabase.auth as unknown as { oauth: OAuthDecisionMocks }).oauth = oauth;
});

describe('POST /api/oauth/decision', () => {
  it('returns 400 for missing form fields', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {});
    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 for invalid decision value', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'maybe',
      authorization_id: 'auth-123',
    });
    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 303 redirect on successful approve', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'approve',
      authorization_id: 'auth-123',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(
      'https://example.com/callback?code=abc',
    );
  });

  it('returns 303 redirect on successful deny', async () => {
    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'deny',
      authorization_id: 'auth-123',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(303);
    expect(res.headers.get('Location')).toBe(
      'https://example.com/callback?error=denied',
    );
  });

  it('returns 400 when approve fails', async () => {
    oauth.approveAuthorization.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid authorization_id' },
    });

    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'approve',
      authorization_id: 'bad-auth-id',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('returns 400 when deny fails', async () => {
    oauth.denyAuthorization.mockResolvedValueOnce({
      data: null,
      error: { message: 'Invalid authorization_id' },
    });

    const req = createFormDataRequest('/api/oauth/decision', {
      decision: 'deny',
      authorization_id: 'bad-auth-id',
    });

    const res = await oauthDecisionPost(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});
