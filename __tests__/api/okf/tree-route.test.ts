/**
 * {132.32} G-LANDING-IMPL — GET /api/okf/[bundleId]/tree (LI-15/LI-16 full-
 * bundle file-tree listing; LI-2 auth; non-regression re: the [bundleId]/graph
 * route's fail-loud-on-unset-root convention, LI-13).
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

import { GET } from '@/app/api/okf/[bundleId]/tree/route';

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

  bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-tree-route-'));
  process.env.OKF_BUNDLE_ROOT = bundleParentDir;

  const bundleRoot = path.join(bundleParentDir, 'first-client');
  mkdirSync(path.join(bundleRoot, 'theme'), { recursive: true });
  writeFileSync(path.join(bundleRoot, 'index.md'), '## Sales\n', 'utf-8');
  writeFileSync(
    path.join(bundleRoot, 'theme', 'concept.md'),
    '---\ntitle: Concept\n---\nBody.',
    'utf-8',
  );
  writeFileSync(
    path.join(bundleRoot, 'ontology.json'),
    '{"concepts":[]}',
    'utf-8',
  );
});

afterEach(() => {
  rmSync(bundleParentDir, { recursive: true, force: true });
  delete process.env.OKF_BUNDLE_ROOT;
});

describe('GET /api/okf/[bundleId]/tree', () => {
  it('returns the full bundle tree, ontology.json listed but non-renderable', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/tree'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.tree.map((n: { name: string }) => n.name).sort();
    expect(names).toEqual(['index.md', 'ontology.json', 'theme']);

    const ontology = body.tree.find(
      (n: { name: string }) => n.name === 'ontology.json',
    );
    expect(ontology.renderable).toBe(false);

    const theme = body.tree.find((n: { name: string }) => n.name === 'theme');
    expect(theme.children[0].path).toBe('theme/concept.md');
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(
      createTestRequest('/api/okf/first-client/tree'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 when the bundle directory does not exist', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/no-such-bundle/tree'),
      { params: createTestParams({ bundleId: 'no-such-bundle' }) },
    );

    expect(response.status).toBe(404);
  });

  it('500s when OKF_BUNDLE_ROOT is unset (matches [bundleId]/graph fail-loud convention)', async () => {
    configureRole(mockSupabase, 'viewer');
    delete process.env.OKF_BUNDLE_ROOT;

    const response = await GET(
      createTestRequest('/api/okf/first-client/tree'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(500);
  });
});
