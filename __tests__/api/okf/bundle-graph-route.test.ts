import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({ mockCookies: vi.fn() }));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Import AFTER mocks are registered.
import { GET } from '@/app/api/okf/[bundleId]/graph/route';

let bundleParentDir: string;

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

  bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-graph-route-'));
  process.env.OKF_BUNDLE_ROOT = bundleParentDir;

  const bundleRoot = path.join(bundleParentDir, 'first-client');
  mkdirSync(path.join(bundleRoot, 'tables'), { recursive: true });
  writeFileSync(
    path.join(bundleRoot, 'tables', 'orders.md'),
    [
      '---',
      'type: BigQuery Table',
      'title: Orders',
      'description: One row per order.',
      '---',
      '',
      'Orders body.',
    ].join('\n'),
    'utf-8',
  );
  writeFileSync(
    path.join(bundleRoot, 'index.md'),
    ['## Sales', '', '* [Orders](tables/orders.md) — One row per order.'].join(
      '\n',
    ),
    'utf-8',
  );
  writeFileSync(
    path.join(bundleRoot, 'log.md'),
    ['## 2026-07-01T09:00:00Z', '', '- Added `tables/orders`.'].join('\n'),
    'utf-8',
  );
});

afterEach(() => {
  rmSync(bundleParentDir, { recursive: true, force: true });
  delete process.env.OKF_BUNDLE_ROOT;
});

describe('GET /api/okf/[bundleId]/graph', () => {
  it('returns the concept graph + nav + log for an authenticated request', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/graph'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nodes).toHaveLength(1);
    expect(body.nodes[0].data.id).toBe('tables/orders');
    expect(body.types).toEqual(['BigQuery Table']);
    expect(body.nav).toHaveLength(1);
    expect(body.nav[0].heading).toBe('Sales');
    expect(body.log).toHaveLength(1);
    expect(body.log[0].heading).toBe('2026-07-01T09:00:00Z');
  });

  it('falls back to a null nav when index.md is absent (soft-dep {132.10})', async () => {
    configureRole(mockSupabase, 'viewer');
    rmSync(path.join(bundleParentDir, 'first-client', 'index.md'));

    const response = await GET(
      createTestRequest('/api/okf/first-client/graph'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.nav).toBeNull();
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(
      createTestRequest('/api/okf/first-client/graph'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 when the bundle directory does not exist', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/no-such-bundle/graph'),
      { params: createTestParams({ bundleId: 'no-such-bundle' }) },
    );

    expect(response.status).toBe(404);
  });
});
