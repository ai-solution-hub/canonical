/**
 * {132.32} G-LANDING-IMPL — GET /api/okf/[bundleId]/tree (LI-15/LI-16 full-
 * bundle file-tree listing; LI-2 auth; non-regression re: the [bundleId]/graph
 * route's fail-loud-on-unset-root convention, LI-13).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
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

  // Security regression (post-{132.32} Checker finding, blocker): a
  // committed symlink in the client-owned, externally-synced bundle repo
  // (DR-016) pointing outside the bundle root must never be listed —
  // Dirent.isDirectory() is false for it (falls through the file branch)
  // and its own name carries no `..`, so a lexical-only guard alone would
  // have let it through as {type:'file', renderable:true}.
  it('excludes a symlinked file whose target resolves outside the bundle root from the tree (LI-17 security)', async () => {
    configureRole(mockSupabase, 'viewer');

    const outsideDir = mkdtempSync(
      path.join(tmpdir(), 'okf-tree-route-outside-'),
    );
    const outsideSecretPath = path.join(outsideDir, 'outside-secret.md');
    writeFileSync(outsideSecretPath, 'TOP SECRET HOST CONTENT', 'utf-8');
    const bundleRoot = path.join(bundleParentDir, 'first-client');
    symlinkSync(outsideSecretPath, path.join(bundleRoot, 'leaked.md'));

    try {
      const response = await GET(
        createTestRequest('/api/okf/first-client/tree'),
        { params: createTestParams({ bundleId: 'first-client' }) },
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      const names = body.tree.map((n: { name: string }) => n.name);
      expect(names).not.toContain('leaked.md');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  // Hygiene regression (post-{132.32} browser-verify finding): a bundle is
  // a git clone (DR-016), so its `.git/` VCS plumbing must never surface
  // in the explorer tree the route returns.
  it('excludes .git VCS plumbing from the tree response (hygiene)', async () => {
    configureRole(mockSupabase, 'viewer');

    const bundleRoot = path.join(bundleParentDir, 'first-client');
    mkdirSync(path.join(bundleRoot, '.git', 'objects', 'pack'), {
      recursive: true,
    });
    writeFileSync(path.join(bundleRoot, '.git', 'config'), '[core]', 'utf-8');
    writeFileSync(path.join(bundleRoot, '.hidden.md'), 'hidden', 'utf-8');

    const response = await GET(
      createTestRequest('/api/okf/first-client/tree'),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    const names = body.tree.map((n: { name: string }) => n.name);
    expect(names).not.toContain('.git');
    expect(names).not.toContain('.hidden.md');
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
