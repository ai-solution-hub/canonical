/**
 * API route tests for POST /api/q-a-pairs/batch — ID-131 {131.21} G-MANUAL-QA.
 *
 * The "Batch Q&A" tab (the shipped manual Q&A editor surviving {131.18}'s
 * "Write content" removal) previously wrote `content_items` rows via
 * POST /api/items/batch. This route is its typed replacement:
 *
 *  - manually authored pairs land in `q_a_pairs`, NEVER `content_items`;
 *  - origin_kind is always 'manually_authored';
 *  - source_document_id is nullable (omitted from the payload when absent);
 *  - auth: admin/editor only, RLS-scoped client (no service-role escalation),
 *    mirroring the app/api/q-a-pairs/promote/route.ts precedent.
 *
 * Mock discipline: shared createMockSupabaseClient() + configureAuth() +
 * createTestRequest() (per __tests__/CLAUDE.md — never hand-roll Supabase
 * mocks). The auth role lookup consumes the FIRST queued `.single()`
 * resolution (configureAuth → configureRole); each subsequent `.single()`
 * queued value corresponds to one q_a_pairs INSERT, in item order — this
 * mirrors the exact pattern in __tests__/api/q-a-pairs-promote.test.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../../../helpers/mock-supabase';
import { configureAuth } from '../../../../helpers/mock-auth';
import { createTestRequest } from '../../../../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock Supabase client
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { POST } from '@/app/api/q-a-pairs/batch/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_DOC_ID = '550e8400-e29b-41d4-a716-446655440000';

function batchRequest(body: Record<string, unknown>) {
  return createTestRequest('/api/q-a-pairs/batch', { method: 'POST', body });
}

/** Queue one successful q_a_pairs INSERT `.single()` resolution. */
function queueInsertSuccess(client: MockSupabaseClient, id: string) {
  client._chain.single.mockResolvedValueOnce({
    data: { id },
    error: null,
  });
}

/** Queue one failed q_a_pairs INSERT `.single()` resolution. */
function queueInsertFailure(client: MockSupabaseClient, message: string) {
  client._chain.single.mockResolvedValueOnce({
    data: null,
    error: { message, code: '23505' },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/q-a-pairs/batch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Auth gating
  // -------------------------------------------------------------------------
  describe('auth gating', () => {
    it('returns 401 when unauthenticated', async () => {
      configureAuth(mockSupabase).asUnauthenticated();

      const res = await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
        }),
      );

      expect(res.status).toBe(401);
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });

    it('returns 403 for a viewer', async () => {
      configureAuth(mockSupabase).asViewer();

      const res = await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
        }),
      );

      expect(res.status).toBe(403);
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });

    it('allows an editor to create pairs', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');

      const res = await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
        }),
      );

      expect(res.status).toBe(201);
    });
  });

  // -------------------------------------------------------------------------
  // Happy path — typed q_a_pairs write
  // -------------------------------------------------------------------------
  describe('happy path', () => {
    it('inserts a q_a_pairs row with origin_kind=manually_authored and no source_document_id when omitted', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');

      const res = await POST(
        batchRequest({
          items: [
            {
              question_text: 'What is the threshold?',
              answer_standard: 'GBP 25,000.',
            },
          ],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.created).toBe(1);
      expect(body.failed).toBe(0);
      expect(body.items[0]).toEqual({
        id: 'pair-1',
        title: 'What is the threshold?',
        status: 'created',
      });

      const insertPayload = mockSupabase._chain.insert.mock.calls[0][0];
      expect(insertPayload.question_text).toBe('What is the threshold?');
      expect(insertPayload.answer_standard).toBe('GBP 25,000.');
      expect(insertPayload.origin_kind).toBe('manually_authored');
      expect(insertPayload.source_document_id).toBeUndefined();
      expect(insertPayload.answer_advanced).toBeUndefined();
    });

    it('includes source_document_id on the insert when supplied', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');

      await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
          source_document_id: SOURCE_DOC_ID,
        }),
      );

      const insertPayload = mockSupabase._chain.insert.mock.calls[0][0];
      expect(insertPayload.source_document_id).toBe(SOURCE_DOC_ID);
    });

    it('includes answer_advanced on the insert when supplied', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');

      await POST(
        batchRequest({
          items: [
            {
              question_text: 'Q?',
              answer_standard: 'A.',
              answer_advanced: 'Advanced A.',
            },
          ],
        }),
      );

      const insertPayload = mockSupabase._chain.insert.mock.calls[0][0];
      expect(insertPayload.answer_advanced).toBe('Advanced A.');
    });

    it('creates multiple pairs in one batch, each with origin_kind=manually_authored', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');
      queueInsertSuccess(mockSupabase, 'pair-2');

      const res = await POST(
        batchRequest({
          items: [
            { question_text: 'Q1?', answer_standard: 'A1.' },
            { question_text: 'Q2?', answer_standard: 'A2.' },
          ],
        }),
      );

      const body = await res.json();
      expect(body.created).toBe(2);
      expect(body.failed).toBe(0);

      const insertCalls = mockSupabase._chain.insert.mock.calls;
      expect(insertCalls).toHaveLength(2);
      for (const [payload] of insertCalls) {
        expect(payload.origin_kind).toBe('manually_authored');
      }
    });

    it('never writes to content_items', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertSuccess(mockSupabase, 'pair-1');

      await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
        }),
      );

      const fromCalls = mockSupabase.from.mock.calls.map((c) => c[0]);
      expect(fromCalls).not.toContain('content_items');
      expect(fromCalls).toContain('q_a_pairs');
    });
  });

  // -------------------------------------------------------------------------
  // Partial failure — one item fails, batch continues
  // -------------------------------------------------------------------------
  describe('partial failure', () => {
    it('marks a failed insert as status=failed with an error message, and still creates the rest', async () => {
      configureAuth(mockSupabase).asEditor();
      queueInsertFailure(
        mockSupabase,
        'duplicate key violates unique constraint',
      );
      queueInsertSuccess(mockSupabase, 'pair-2');

      const res = await POST(
        batchRequest({
          items: [
            { question_text: 'Q1?', answer_standard: 'A1.' },
            { question_text: 'Q2?', answer_standard: 'A2.' },
          ],
        }),
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.created).toBe(1);
      expect(body.failed).toBe(1);
      expect(body.items[0].status).toBe('failed');
      expect(body.items[0].error).toBeDefined();
      expect(body.items[1].status).toBe('created');
      expect(body.items[1].id).toBe('pair-2');
    });
  });

  // -------------------------------------------------------------------------
  // Validation
  // -------------------------------------------------------------------------
  describe('validation', () => {
    it('rejects an empty items array with 400', async () => {
      configureAuth(mockSupabase).asEditor();

      const res = await POST(batchRequest({ items: [] }));
      expect(res.status).toBe(400);
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });

    it('rejects an item missing answer_standard with 400', async () => {
      configureAuth(mockSupabase).asEditor();

      const res = await POST(
        batchRequest({ items: [{ question_text: 'Q?' }] }),
      );
      expect(res.status).toBe(400);
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });

    it('rejects a non-UUID source_document_id with 400', async () => {
      configureAuth(mockSupabase).asEditor();

      const res = await POST(
        batchRequest({
          items: [{ question_text: 'Q?', answer_standard: 'A.' }],
          source_document_id: 'not-a-uuid',
        }),
      );
      expect(res.status).toBe(400);
      expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Proxy-allowlist absence — must stay behind auth middleware
  // -------------------------------------------------------------------------
  describe('proxy-allowlist absence', () => {
    it('isPublicRoute returns false for /api/q-a-pairs/batch', async () => {
      const { isPublicRoute } = await import('@/lib/routes');
      expect(isPublicRoute('/api/q-a-pairs/batch')).toBe(false);
    });

    it('PUBLIC_ROUTES does not include any prefix of /api/q-a-pairs/batch', async () => {
      const { PUBLIC_ROUTES } = await import('@/lib/routes');
      const routePath = '/api/q-a-pairs/batch';
      for (const publicRoute of PUBLIC_ROUTES) {
        expect(routePath.startsWith(publicRoute)).toBe(false);
      }
    });
  });
});
