/**
 * {132.32} G-LANDING-IMPL — GET /api/okf/[bundleId]/file?path=… (LI-15 per-
 * file read; LI-16 machine-facing-file server-side restriction; LI-17
 * traversal-safety guard; LI-2 auth).
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

import { GET } from '@/app/api/okf/[bundleId]/file/route';

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

  bundleParentDir = mkdtempSync(path.join(tmpdir(), 'okf-file-route-'));
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
  // Sibling directory to prove a traversal escape can't reach it.
  writeFileSync(path.join(bundleParentDir, 'evil.md'), 'secret', 'utf-8');
});

afterEach(() => {
  rmSync(bundleParentDir, { recursive: true, force: true });
  delete process.env.OKF_BUNDLE_ROOT;
});

describe('GET /api/okf/[bundleId]/file', () => {
  it('returns a markdown file within the bundle tree', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: 'theme/concept.md' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe('theme/concept.md');
    expect(body.content).toContain('Body.');
  });

  it('returns the nested index.md at the bundle root', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: 'index.md' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.content).toContain('## Sales');
  });

  it('rejects a non-markdown file (ontology.json) with 400 (LI-16)', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: 'ontology.json' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(400);
  });

  it('rejects a parent-traversal escape with a valid .md suffix (LI-17)', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: '../evil.md' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(400);
  });

  it('rejects an absolute-path traversal attempt (LI-17)', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: '/etc/passwd' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(400);
  });

  it('returns 404 for a within-tree path that does not exist', async () => {
    configureRole(mockSupabase, 'viewer');

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: 'does-not-exist.md' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(404);
  });

  // Security regression (post-{132.32} Checker finding, blocker): a
  // committed symlink in the client-owned, externally-synced bundle repo
  // (DR-016) pointing outside the bundle root must never leak the target's
  // content, even when requested directly by path (bypassing the tree
  // listing entirely — the tree already excludes symlinks, but that alone
  // does not stop a caller who crafts the `path` query param by hand).
  it('rejects a symlinked file whose real target resolves outside the bundle root — checker PoC (LI-17 security)', async () => {
    configureRole(mockSupabase, 'viewer');

    const outsideDir = mkdtempSync(
      path.join(tmpdir(), 'okf-file-route-outside-'),
    );
    const outsideSecretPath = path.join(outsideDir, 'outside-secret.md');
    writeFileSync(outsideSecretPath, 'TOP SECRET HOST CONTENT', 'utf-8');
    const bundleRoot = path.join(bundleParentDir, 'first-client');
    symlinkSync(outsideSecretPath, path.join(bundleRoot, 'leaked.md'));

    try {
      const response = await GET(
        createTestRequest('/api/okf/first-client/file', {
          searchParams: { path: 'leaked.md' },
        }),
        { params: createTestParams({ bundleId: 'first-client' }) },
      );

      // Must be rejected (400/404) — never a 200 carrying the outside file.
      expect([400, 404]).toContain(response.status);
      const body = await response.json();
      expect(JSON.stringify(body)).not.toContain('TOP SECRET HOST CONTENT');
    } finally {
      rmSync(outsideDir, { recursive: true, force: true });
    }
  });

  it('routes an unauthenticated request through authFailureResponse (401)', async () => {
    configureUnauthenticated(mockSupabase);

    const response = await GET(
      createTestRequest('/api/okf/first-client/file', {
        searchParams: { path: 'index.md' },
      }),
      { params: createTestParams({ bundleId: 'first-client' }) },
    );

    expect(response.status).toBe(401);
  });
});
