/**
 * ID-132 {132.49} G-CONCEPT-GRAPH-UNION — GET /api/okf/union-graph (the
 * deployment-level union across every sibling bundle root). Mirrors
 * `bundles-route.test.ts` (enumerate-all root read) + `bundle-graph-route.test.ts`
 * (real-filesystem concept graph) conventions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
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

import { GET } from '@/app/api/okf/union-graph/route';

let bundleParentDir: string;
const ORIGINAL_ROOT = process.env.OKF_BUNDLE_ROOT;

function writeConceptMd(bundleRoot: string, relPath: string, body: string) {
  const full = path.join(bundleRoot, relPath);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, body, 'utf-8');
}

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

describe('GET /api/okf/union-graph', () => {
  it('returns an empty graph when OKF_BUNDLE_ROOT is unset (never a crash)', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(createTestRequest('/api/okf/union-graph'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ nodes: [], edges: [], bodies: {}, types: [] });
  });

  it('merges every sibling bundle, namespacing node ids by bundleId', async () => {
    configureRole(mockSupabase, 'viewer');
    bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-union-route-'));
    process.env.OKF_BUNDLE_ROOT = bundleParentDir;

    writeConceptMd(
      path.join(bundleParentDir, 'alpha-client'),
      'tables/orders.md',
      [
        '---',
        'type: BigQuery Table',
        'title: Orders',
        '---',
        '',
        'Orders body.',
      ].join('\n'),
    );
    writeConceptMd(
      path.join(bundleParentDir, 'canonical-okf-system'),
      'topics/quality.md',
      ['---', 'type: topic', 'title: Quality', '---', '', 'Quality body.'].join(
        '\n',
      ),
    );

    const response = await GET(createTestRequest('/api/okf/union-graph'));

    expect(response.status).toBe(200);
    const body = await response.json();
    const ids = body.nodes.map((n: { data: { id: string } }) => n.data.id);
    expect(ids).toContain('alpha-client::tables/orders');
    expect(ids).toContain('canonical-okf-system::topics/quality');
    expect(body.types).toEqual(['BigQuery Table', 'topic']);
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(createTestRequest('/api/okf/union-graph'));

    expect(response.status).toBe(401);
  });
});
