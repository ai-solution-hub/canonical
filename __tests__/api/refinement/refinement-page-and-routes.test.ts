/**
 * ID-104.16 — /admin/refinement stub-spine integration assertions.
 *
 * Tests:
 *  1. Non-admin rejection via authFailureResponse(auth) on all 4 API routes.
 *  2. Admin listing: registry_version + per-touchpoint unprocessed-signal count.
 *  3. patterns/proposals return empty-200 (present-but-empty, NOT 404/absent).
 *  4. Zero-egress network assertion: no raindrop.ai POST path in any of the
 *     new route files (T21/B-INV-21 — Workshop empty writeKey; no client-data egress).
 *
 * Spec: specs/id-104-eval-engine/TECH.md §T20/T21/T22, PRODUCT.md §B-INV-20/21/22.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
  },
  getRequestContext: () => undefined,
  runWithRequestContext: <T>(_ctx: unknown, fn: () => T) => fn(),
  updateRequestContext: vi.fn(),
  withRequestContext: <T>(handler: T) => handler,
  withRequestContextBare: <T>(handler: T) => handler,
  applyRequestContextToSentry: vi.fn(),
}));

import { GET as signalsGET } from '@/app/api/refinement/touchpoints/[id]/signals/route';
import { GET as patternsGET } from '@/app/api/refinement/touchpoints/[id]/patterns/route';
import { GET as proposalsGET } from '@/app/api/refinement/touchpoints/[id]/proposals/route';
import { GET as versionHistoryGET } from '@/app/api/refinement/touchpoints/[id]/version-history/route';

const TOUCHPOINT_ID = 'mcp:test-tool';

const TOUCHPOINT_ROW = {
  touchpoint_id: TOUCHPOINT_ID,
  kind: 'mcp-tool',
  owner: 'test',
  suite_name: 'l1',
  grounding_shape: 'test-shape',
  severity_on_fail: 'warn',
  variance_band: 0.02,
  graduation_metric: null,
  contract_version: 1,
  registry_version: 1,
  file_sha256: null,
};

function resetMocks() {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'admin-user-id', email: 'admin@example.com' } },
    error: null,
  });
  const chainable = [
    'select',
    'insert',
    'update',
    'upsert',
    'delete',
    'eq',
    'neq',
    'in',
    'is',
    'not',
    'ilike',
    'contains',
    'gte',
    'lte',
    'gt',
    'lt',
    'or',
    'order',
    'limit',
    'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
}

// ---------------------------------------------------------------------------
// Route boundary — auth rejection on all 4 endpoints
// ---------------------------------------------------------------------------

describe('ID-104.16 /api/refinement/touchpoints/[id]/* — non-admin rejection', () => {
  beforeEach(() => {
    resetMocks();
  });

  const routes = [
    { name: 'signals', handler: signalsGET },
    { name: 'patterns', handler: patternsGET },
    { name: 'proposals', handler: proposalsGET },
    { name: 'version-history', handler: versionHistoryGET },
  ] as const;

  for (const { name, handler } of routes) {
    describe(name, () => {
      it('rejects unauthenticated requests with 401', async () => {
        configureUnauthenticated(mockSupabase);
        const req = createTestRequest(
          `/api/refinement/touchpoints/${TOUCHPOINT_ID}/${name}`,
        );
        const res = await handler(req, {
          params: createTestParams({ id: TOUCHPOINT_ID }),
        });
        expect(res.status).toBe(401);
      });

      it('rejects editor role with 403', async () => {
        configureRole(mockSupabase, 'editor');
        const req = createTestRequest(
          `/api/refinement/touchpoints/${TOUCHPOINT_ID}/${name}`,
        );
        const res = await handler(req, {
          params: createTestParams({ id: TOUCHPOINT_ID }),
        });
        expect(res.status).toBe(403);
      });
    });
  }
});

// ---------------------------------------------------------------------------
// Admin — registry listing data (signals route returns unprocessed count)
// ---------------------------------------------------------------------------

describe('ID-104.16 signals endpoint — admin sees count + touchpoint_id', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns touchpoint_id + signals array for admin', async () => {
    configureRole(mockSupabase, 'admin');
    const signalRows = [
      {
        id: '1',
        touchpoint_id: TOUCHPOINT_ID,
        outcome_signal: 'win',
        created_at: '2026-06-01T10:00:00Z',
      },
    ];
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: signalRows, error: null, count: 1 }),
    );

    const req = createTestRequest(
      `/api/refinement/touchpoints/${TOUCHPOINT_ID}/signals`,
    );
    const res = await signalsGET(req, {
      params: createTestParams({ id: TOUCHPOINT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.touchpoint_id).toBe(TOUCHPOINT_ID);
    expect(body.signals).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// patterns + proposals — present-but-empty (deferred organ anchor)
// ---------------------------------------------------------------------------

describe('ID-104.16 patterns + proposals — present-but-empty (B-INV-22)', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('patterns: admin receives 200 with empty patterns array + deferred:true', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest(
      `/api/refinement/touchpoints/${TOUCHPOINT_ID}/patterns`,
    );
    const res = await patternsGET(req, {
      params: createTestParams({ id: TOUCHPOINT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.patterns).toEqual([]);
    expect(body.deferred).toBe(true);
  });

  it('proposals: admin receives 200 with empty proposals array + deferred:true', async () => {
    configureRole(mockSupabase, 'admin');
    const req = createTestRequest(
      `/api/refinement/touchpoints/${TOUCHPOINT_ID}/proposals`,
    );
    const res = await proposalsGET(req, {
      params: createTestParams({ id: TOUCHPOINT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposals).toEqual([]);
    expect(body.deferred).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// version-history — returns contract_version + registry_version
// ---------------------------------------------------------------------------

describe('ID-104.16 version-history — admin sees contract + registry versions', () => {
  beforeEach(() => {
    resetMocks();
  });

  it('returns contract_version and registry_version for a registered touchpoint', async () => {
    configureRole(mockSupabase, 'admin');
    mockSupabase._chain.maybeSingle.mockResolvedValueOnce({
      data: TOUCHPOINT_ROW,
      error: null,
    });

    const req = createTestRequest(
      `/api/refinement/touchpoints/${TOUCHPOINT_ID}/version-history`,
    );
    const res = await versionHistoryGET(req, {
      params: createTestParams({ id: TOUCHPOINT_ID }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.touchpoint_id).toBe(TOUCHPOINT_ID);
    expect(typeof body.contract_version).toBe('number');
    expect(typeof body.registry_version).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Zero-egress network assertion — B-INV-21 / T21
// Confirm no raindrop.ai POST path appears in the new route source files.
// ---------------------------------------------------------------------------

describe('ID-104.16 zero-egress assertion (B-INV-21)', () => {
  const routeFiles = [
    'app/api/refinement/touchpoints/[id]/signals/route.ts',
    'app/api/refinement/touchpoints/[id]/patterns/route.ts',
    'app/api/refinement/touchpoints/[id]/proposals/route.ts',
    'app/api/refinement/touchpoints/[id]/version-history/route.ts',
    'app/admin/refinement/page.tsx',
  ];

  // __dirname = <root>/__tests__/api/refinement → up 3 to repo root (worktree-safe).
  const repoRoot = path.resolve(__dirname, '../../..');

  for (const relPath of routeFiles) {
    it(`${relPath} contains no raindrop.ai reference`, () => {
      const absPath = path.join(repoRoot, relPath);
      const content = fs.readFileSync(absPath, 'utf-8');
      expect(content).not.toMatch(/raindrop\.ai/);
      expect(content).not.toMatch(/writeKey/);
    });
  }
});
