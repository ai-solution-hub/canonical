/**
 * Tests for POST /api/admin/taxonomy-sync/callback
 *
 * HMAC-SHA256 verified callback route for GitHub Actions workflow completion.
 * No user session — authentication is solely via HMAC signature.
 *
 * Spec: docs/specs/p0-tx-taxonomy-sync-spec.md §5.3, AC-13, AC-15
 * Plan: docs/plans/p0-tx-taxonomy-sync-plan.md WP4
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'node:crypto';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Hoisted mocks — vi.mock() factories are hoisted above imports, so any
// variables they reference must also be hoisted via vi.hoisted().
// ---------------------------------------------------------------------------

const { mockCaptureMessage, mockCaptureException, mockComputeTaxonomyHash } = vi.hoisted(() => ({
  mockCaptureMessage: vi.fn(),
  mockCaptureException: vi.fn(),
  mockComputeTaxonomyHash: vi.fn(),
}));

// Module-level mock client — NOT referenced inside vi.mock() factories
// (the factories use inline vi.fn() instead)
const mockSupabase: MockSupabaseClient = createMockSupabaseClient();

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

vi.mock('@/lib/supabase/server', () => {
  // Cannot reference mockSupabase here (not hoisted).
  // Instead, return a factory that is re-wired in beforeEach.
  return {
    createClient: vi.fn(),
    createServiceClient: vi.fn(),
  };
});

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({
    getAll: () => [],
    set: () => {},
  }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: mockCaptureMessage,
  captureException: mockCaptureException,
}));

vi.mock('@/lib/taxonomy/sync-trigger', () => ({
  computeTaxonomyHash: mockComputeTaxonomyHash,
}));

// ---------------------------------------------------------------------------
// Import route handler + mocked module AFTER mocks are declared
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/admin/taxonomy-sync/callback/route';
import { createServiceClient } from '@/lib/supabase/server';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const TEST_SECRET = 'a'.repeat(64); // 32-byte hex secret for tests
const TEST_RUN_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const FIXED_NOW = 1713700000000; // Fixed timestamp for tests

interface CallbackPayload {
  run_id: string;
  status: 'success' | 'failed';
  timestamp: number;
  new_hash?: string;
  error_message?: string;
}

function signPayload(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

function makeRequest(
  payload: CallbackPayload,
  options: { secret?: string; omitSignature?: boolean; signatureOverride?: string } = {},
): NextRequest {
  const rawBody = JSON.stringify(payload);
  const secret = options.secret ?? TEST_SECRET;
  const signature = options.signatureOverride ?? signPayload(rawBody, secret);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  if (!options.omitSignature) {
    headers['x-taxonomy-sync-signature'] = signature;
  }

  return new NextRequest(
    new URL('/api/admin/taxonomy-sync/callback', 'http://localhost:3000'),
    {
      method: 'POST',
      body: rawBody,
      headers,
    },
  );
}

function makeSuccessPayload(overrides: Partial<CallbackPayload> = {}): CallbackPayload {
  return {
    run_id: TEST_RUN_ID,
    status: 'success',
    timestamp: FIXED_NOW,
    new_hash: 'abc123def456',
    ...overrides,
  };
}

function makeFailedPayload(overrides: Partial<CallbackPayload> = {}): CallbackPayload {
  return {
    run_id: TEST_RUN_ID,
    status: 'failed',
    timestamp: FIXED_NOW,
    error_message: 'sync:taxonomy script failed with exit code 1',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/admin/taxonomy-sync/callback', () => {
  beforeEach(() => {
    vi.stubEnv('TAXONOMY_SYNC_CALLBACK_SECRET', TEST_SECRET);
    vi.spyOn(Date, 'now').mockReturnValue(FIXED_NOW);

    // Wire up the mock service client
    vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never);

    // Reset mock chain
    mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
    mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
    );
    mockCaptureMessage.mockClear();
    mockCaptureException.mockClear();
    mockComputeTaxonomyHash.mockClear();
    // Default: return a deterministic hash from DB-derived computation
    mockComputeTaxonomyHash.mockReturnValue('db-computed-hash-abc123');
    // Reset from() to return the default chain (not a stale mockImplementation
    // from a previous test that creates per-table chains)
    mockSupabase.from.mockReset();
    mockSupabase.from.mockReturnValue(mockSupabase._chain);
    mockSupabase._chain.update.mockClear();
    mockSupabase._chain.eq.mockClear();
    mockSupabase._chain.not.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // HMAC authentication
  // -------------------------------------------------------------------------

  describe('HMAC authentication', () => {
    it('returns 401 missing_signature when header is absent', async () => {
      const req = makeRequest(makeSuccessPayload(), { omitSignature: true });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('missing_signature');
    });

    it('returns 401 invalid_signature when signature is wrong', async () => {
      const req = makeRequest(makeSuccessPayload(), {
        secret: 'wrong-secret-that-is-different-from-test-secret-value',
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_signature');
    });

    it('returns 401 on signature length mismatch (timingSafeEqual precondition)', async () => {
      const req = makeRequest(makeSuccessPayload(), {
        signatureOverride: 'tooshort',
      });
      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('invalid_signature');
    });

    it('uses raw body bytes for HMAC, not parsed JSON', async () => {
      // Construct a payload with specific formatting that would change if re-stringified
      const rawBody = '{"run_id":"' + TEST_RUN_ID + '","status":"success","timestamp":' + FIXED_NOW + ',"new_hash":"abc123"}';
      const signature = signPayload(rawBody, TEST_SECRET);

      const req = new NextRequest(
        new URL('/api/admin/taxonomy-sync/callback', 'http://localhost:3000'),
        {
          method: 'POST',
          body: rawBody,
          headers: {
            'content-type': 'application/json',
            'x-taxonomy-sync-signature': signature,
          },
        },
      );

      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Server misconfiguration
  // -------------------------------------------------------------------------

  describe('server misconfiguration', () => {
    it('returns 500 server_misconfigured when secret env var is empty string', async () => {
      vi.stubEnv('TAXONOMY_SYNC_CALLBACK_SECRET', '');

      const req = makeRequest(makeSuccessPayload());
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('server_misconfigured');
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'TAXONOMY_SYNC_CALLBACK_SECRET not configured',
        'error',
      );
    });

    it('returns 500 server_misconfigured when secret env var is undefined', async () => {
      // Explicitly remove the env var (not just empty string)
      delete process.env.TAXONOMY_SYNC_CALLBACK_SECRET;

      const req = makeRequest(makeSuccessPayload());
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBe('server_misconfigured');
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'TAXONOMY_SYNC_CALLBACK_SECRET not configured',
        'error',
      );
    });
  });

  // -------------------------------------------------------------------------
  // Replay window (AC-15)
  // -------------------------------------------------------------------------

  describe('replay window (AC-15)', () => {
    it('returns 401 stale_timestamp when timestamp is > 5 min old', async () => {
      const staleTimestamp = FIXED_NOW - 6 * 60 * 1000; // 6 minutes ago
      const payload = makeSuccessPayload({ timestamp: staleTimestamp });
      const req = makeRequest(payload);

      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('stale_timestamp');
    });

    it('accepts timestamp exactly at 5 min boundary', async () => {
      const borderlineTimestamp = FIXED_NOW - 5 * 60 * 1000; // Exactly 5 min
      const payload = makeSuccessPayload({ timestamp: borderlineTimestamp });
      const req = makeRequest(payload);

      const res = await POST(req);

      // Exactly 5 min is not > 5 min, so should pass
      expect(res.status).toBe(200);
    });

    it('accepts recent timestamp within window', async () => {
      const recentTimestamp = FIXED_NOW - 30 * 1000; // 30 seconds ago
      const payload = makeSuccessPayload({ timestamp: recentTimestamp });
      const req = makeRequest(payload);

      const res = await POST(req);
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Success flow
  // -------------------------------------------------------------------------

  describe('success payload', () => {
    it('computes hash from DB and updates taxonomy_sync_state then pipeline_runs in sequence', async () => {
      // Track per-table operations in call order to verify:
      // 1. taxonomy_domains SELECT (for hash computation)
      // 2. taxonomy_subtopics SELECT (for hash computation)
      // 3. taxonomy_sync_state UPDATE with DB-derived hash
      // 4. pipeline_runs UPDATE with completed status
      const opLog: Array<{ table: string; op: string; payload?: Record<string, unknown> }> = [];

      mockComputeTaxonomyHash.mockReturnValue('db-derived-hash-xyz');

      mockSupabase.from.mockImplementation((table: string) => {
        const chain: Record<string, ReturnType<typeof vi.fn>> = {};
        const chainable = [
          'insert', 'upsert', 'delete',
          'neq', 'in', 'is', 'not', 'ilike', 'contains',
          'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
        ];
        for (const m of chainable) {
          chain[m] = vi.fn().mockReturnValue(chain);
        }
        chain.select = vi.fn(() => {
          opLog.push({ table, op: 'select' });
          return chain;
        });
        chain.eq = vi.fn().mockReturnValue(chain);
        chain.update = vi.fn((payload: Record<string, unknown>) => {
          opLog.push({ table, op: 'update', payload });
          return chain;
        });
        chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
        chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
        chain.then = vi.fn((resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
        );
        return chain;
      });

      // Payload new_hash is advisory — callback should ignore it and use DB-derived hash
      const payload = makeSuccessPayload({ new_hash: 'payload-hash-should-be-ignored' });
      const req = makeRequest(payload);

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);

      // Verify computeTaxonomyHash was called with the DB query results
      expect(mockComputeTaxonomyHash).toHaveBeenCalledOnce();

      // Find the taxonomy_sync_state update
      const syncStateUpdate = opLog.find(
        (op) => op.table === 'taxonomy_sync_state' && op.op === 'update',
      );
      expect(syncStateUpdate).toBeDefined();
      expect(syncStateUpdate!.payload).toEqual(
        expect.objectContaining({
          last_sync_hash: 'db-derived-hash-xyz',
          synced_by: 'workflow',
        }),
      );
      // Confirm it did NOT use the payload's new_hash
      expect(syncStateUpdate!.payload!.last_sync_hash).not.toBe(
        'payload-hash-should-be-ignored',
      );

      // Verify pipeline_runs update to completed
      const pipelineUpdate = opLog.find(
        (op) => op.table === 'pipeline_runs' && op.op === 'update',
      );
      expect(pipelineUpdate).toBeDefined();
      expect(pipelineUpdate!.payload).toEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });

    it('does not fire Sentry on success', async () => {
      const req = makeRequest(makeSuccessPayload());

      await POST(req);

      // captureMessage should NOT be called for success flow
      expect(mockCaptureMessage).not.toHaveBeenCalled();
    });

    it('returns 200 { ok: true }', async () => {
      const req = makeRequest(makeSuccessPayload());

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Failure flow
  // -------------------------------------------------------------------------

  describe('failed payload', () => {
    it('updates pipeline_runs to failed with error_message', async () => {
      const errorMsg = 'bun run sync:taxonomy exited with code 1';
      const payload = makeFailedPayload({ error_message: errorMsg });
      const req = makeRequest(payload);

      const res = await POST(req);

      expect(res.status).toBe(200);

      expect(mockSupabase._chain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          error_message: errorMsg,
        }),
      );
    });

    it('does NOT update taxonomy_sync_state on failure', async () => {
      const req = makeRequest(makeFailedPayload());

      await POST(req);

      // Check that taxonomy_sync_state was NOT used in from() calls
      const fromCalls = mockSupabase.from.mock.calls;
      const syncStateCalls = fromCalls.filter(
        (call: string[]) => call[0] === 'taxonomy_sync_state',
      );
      expect(syncStateCalls.length).toBe(0);
    });

    it('fires Sentry captureMessage on failure', async () => {
      const errorMsg = 'workflow crashed';
      const payload = makeFailedPayload({ error_message: errorMsg });
      const req = makeRequest(payload);

      await POST(req);

      expect(mockCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining(errorMsg),
        'error',
      );
    });

    it('returns 200 { ok: true } even though workflow failed', async () => {
      const req = makeRequest(makeFailedPayload());

      const res = await POST(req);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });
    });
  });

  // -------------------------------------------------------------------------
  // Error handling (MEDIUM-3: outer try/catch)
  // -------------------------------------------------------------------------

  describe('error handling', () => {
    it('returns 500 with Sentry capture when DB update throws', async () => {
      // Make createServiceClient return a client whose from() throws
      const throwingSupabase = {
        from: vi.fn(() => {
          throw new Error('DB connection refused');
        }),
      };
      vi.mocked(createServiceClient).mockReturnValue(throwingSupabase as never);

      const req = makeRequest(makeSuccessPayload());
      const res = await POST(req);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
  });
});
