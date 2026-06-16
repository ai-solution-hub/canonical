/**
 * API route integration tests for the health check endpoint.
 *
 * GET /api/health — no authentication required.
 *
 * The health route creates its own Supabase client directly using
 * @supabase/supabase-js createClient (NOT the cookie-based server client).
 * It checks environment variables and Supabase connectivity, returning
 * { status, supabase, env, timestamp }.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @supabase/supabase-js — the health route imports createClient directly
// vi.hoisted() runs before vi.mock() factories — safe to reference in mocks
// ---------------------------------------------------------------------------

const { mockSelect, mockSupabaseDirectClient } = vi.hoisted(() => {
  const mockSelect = vi.fn();
  const mockSupabaseDirectClient = {
    from: vi.fn().mockReturnValue({ select: mockSelect }),
  };
  return { mockSelect, mockSupabaseDirectClient };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn().mockReturnValue(mockSupabaseDirectClient),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks are declared
// ---------------------------------------------------------------------------

import { GET as healthGET } from '@/app/api/health/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ORIGINAL_ENV = { ...process.env };

function setEnvVars(overrides: Record<string, string | undefined> = {}) {
  const defaults: Record<string, string> = {
    NEXT_PUBLIC_SUPABASE_URL: 'https://test.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'test-anon-key',
    ANTHROPIC_API_KEY: 'sk-ant-test',
    OPENAI_API_KEY: 'sk-test',
  };
  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function resetEnv() {
  // Remove any test keys
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.OPENAI_API_KEY;
  // Restore originals
  Object.assign(process.env, ORIGINAL_ENV);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    resetEnv();
  });

  it('returns 200 with status "ok" when all checks pass', async () => {
    setEnvVars();

    mockSelect.mockResolvedValueOnce({ count: 42, error: null });

    const response = await healthGET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.status).toBe('ok');
    expect(body.supabase).toBe(true);
    expect(body.env).toBe(true);
    expect(body.timestamp).toBeDefined();
    expect(typeof body.timestamp).toBe('string');
  });

  it('works without any authentication (no cookies, no auth headers)', async () => {
    setEnvVars();

    mockSelect.mockResolvedValueOnce({ count: 10, error: null });

    // The health route takes no request parameter — it never checks auth
    const response = await healthGET();
    expect([200, 503]).toContain(response.status);

    const body = await response.json();
    expect(body).toHaveProperty('status');
    expect(body).toHaveProperty('timestamp');
    // Critically: no 401 or 403
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it('returns 503 with status "degraded" when Supabase is unreachable', async () => {
    setEnvVars();

    mockSelect.mockResolvedValueOnce({
      count: null,
      error: { message: 'Connection refused' },
    });

    const response = await healthGET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.supabase).toBe(false);
    expect(body.env).toBe(true);
  });

  it('returns 503 when Supabase query throws an exception', async () => {
    setEnvVars();

    mockSelect.mockRejectedValueOnce(new Error('Network failure'));

    const response = await healthGET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.supabase).toBe(false);
  });

  it('returns 503 with env: false when required env vars are missing', async () => {
    setEnvVars({ ANTHROPIC_API_KEY: undefined });

    mockSelect.mockResolvedValueOnce({ count: 10, error: null });

    const response = await healthGET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.env).toBe(false);
    expect(body.supabase).toBe(true);
  });

  it('returns 503 when both env vars and Supabase are broken', async () => {
    setEnvVars({
      ANTHROPIC_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
    });

    mockSelect.mockResolvedValueOnce({
      count: null,
      error: { message: 'DB down' },
    });

    const response = await healthGET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.status).toBe('degraded');
    expect(body.env).toBe(false);
    expect(body.supabase).toBe(false);
  });

  it('returns supabase: false when Supabase env vars are not set', async () => {
    setEnvVars({
      NEXT_PUBLIC_SUPABASE_URL: undefined,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: undefined,
    });

    const response = await healthGET();
    expect(response.status).toBe(503);

    const body = await response.json();
    expect(body.supabase).toBe(false);
    // NEXT_PUBLIC_SUPABASE_URL is in the required env vars list
    expect(body.env).toBe(false);
  });

  it('timestamp is a valid ISO 8601 date string', async () => {
    setEnvVars();

    mockSelect.mockResolvedValueOnce({ count: 1, error: null });

    const response = await healthGET();
    const body = await response.json();

    const parsed = new Date(body.timestamp);
    expect(parsed.toISOString()).toBe(body.timestamp);
  });

  it('returns version from NEXT_PUBLIC_RELEASE_VERSION when set', async () => {
    setEnvVars({ NEXT_PUBLIC_RELEASE_VERSION: 'v1.2.3' });

    mockSelect.mockResolvedValueOnce({ count: 1, error: null });

    const response = await healthGET();
    const body = await response.json();

    expect(body.version).toBe('v1.2.3');
  });

  it('returns version "unknown" when NEXT_PUBLIC_RELEASE_VERSION is absent', async () => {
    setEnvVars();
    delete process.env.NEXT_PUBLIC_RELEASE_VERSION;

    mockSelect.mockResolvedValueOnce({ count: 1, error: null });

    const response = await healthGET();
    const body = await response.json();

    expect(body.version).toBe('unknown');
  });
});
