/**
 * {132.32} G-LANDING-IMPL — GET /api/okf/bundles (LI-3(a)/LI-14 enumerate-all
 * root read; LI-4(a)/(b) graceful empty states; LI-2 auth).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest } from '../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

import { GET } from '@/app/api/okf/bundles/route';

let bundleParentDir: string;
const ORIGINAL_ROOT = process.env.OKF_BUNDLE_ROOT;

beforeEach(() => {
  vi.clearAllMocks();
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  const chainable = ['select', 'eq'] as const;
  for (const method of chainable) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({
    data: { role: 'viewer' },
    error: null,
  });
  delete process.env.OKF_BUNDLE_ROOT;
});

afterEach(() => {
  if (bundleParentDir)
    rmSync(bundleParentDir, { recursive: true, force: true });
  if (ORIGINAL_ROOT === undefined) delete process.env.OKF_BUNDLE_ROOT;
  else process.env.OKF_BUNDLE_ROOT = ORIGINAL_ROOT;
});

describe('GET /api/okf/bundles', () => {
  it('returns configured:false and an empty list when OKF_BUNDLE_ROOT is unset (LI-4(a))', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(createTestRequest('/api/okf/bundles'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ bundles: [], configured: false });
  });

  it('returns configured:true and an empty list when the root has no bundle subdirs (LI-4(b))', async () => {
    configureRole(mockSupabase, 'viewer');
    bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-bundles-route-'));
    process.env.OKF_BUNDLE_ROOT = bundleParentDir;

    const response = await GET(createTestRequest('/api/okf/bundles'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ bundles: [], configured: true });
  });

  it('lists every bundle subdir when configured (LI-14)', async () => {
    configureRole(mockSupabase, 'viewer');
    bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-bundles-route-'));
    mkdirSync(path.join(bundleParentDir, 'zeta-client'));
    mkdirSync(path.join(bundleParentDir, 'alpha-client'));
    process.env.OKF_BUNDLE_ROOT = bundleParentDir;

    const response = await GET(createTestRequest('/api/okf/bundles'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      bundles: ['alpha-client', 'zeta-client'],
      configured: true,
    });
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(createTestRequest('/api/okf/bundles'));

    expect(response.status).toBe(401);
  });
});
