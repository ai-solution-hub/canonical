/**
 * Tests for GET /api/admin/provenance/export/verification-history.
 *
 * Verifies auth gates, default/custom date ranges, invalid date handling,
 * range > 365 days rejection, empty results (valid PDF), and access logging.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '../../../../helpers/mock-supabase';

// ---------------------------------------------------------------------------
// Shared mock client + module mocks
// ---------------------------------------------------------------------------

const mockSupabase: MockSupabaseClient = createMockSupabaseClient();

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>(
    '@/lib/auth',
  );
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn(),
}));

vi.mock('@/lib/users/display-names', () => ({
  resolveUserDisplayNames: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock('@react-pdf/renderer', () => ({
  renderToBuffer: vi.fn().mockResolvedValue(Buffer.from('mock-pdf-content')),
  Document: 'Document',
  Page: 'Page',
  Text: 'Text',
  View: 'View',
  StyleSheet: { create: (s: Record<string, unknown>) => s },
}));

import { GET } from '@/app/api/admin/provenance/export/verification-history/route';
import { getAuthorisedClient } from '@/lib/auth';
import { recordPipelineRun } from '@/lib/pipeline/record-run';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);
const recordPipelineRunMock = vi.mocked(recordPipelineRun);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

function makeRequest(params: Record<string, string> = {}): NextRequest {
  const url = new URL(
    '/api/admin/provenance/export/verification-history',
    'http://localhost:3000',
  );
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

function configureAdminAuth() {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: { id: TEST_USER_ID, email: 'admin@test.com' } as never,
    supabase: mockSupabase as never,
    role: 'admin',
  });
}

function configureEditorAuth() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'forbidden',
  });
}

function configureUnauthenticated() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'unauthenticated',
  });
}

function makeVerificationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vh-001',
    content_item_id: 'ci-001',
    action_type: 'verify',
    performed_by: TEST_USER_ID,
    performed_at: '2026-04-10T14:30:00.000Z',
    note: 'Looks good',
    content_items: {
      suggested_title: 'Test Article',
      governance_review_status: 'verified',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain defaults
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/admin/provenance/export/verification-history', () => {
  describe('Auth gates', () => {
    it('returns 200 for admin users', async () => {
      configureAdminAuth();
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
    });

    it('returns 403 for editor users', async () => {
      configureEditorAuth();

      const res = await GET(makeRequest());
      expect(res.status).toBe(403);
    });

    it('returns 401 for unauthenticated users', async () => {
      configureUnauthenticated();

      const res = await GET(makeRequest());
      expect(res.status).toBe(401);
    });
  });

  describe('Date range handling', () => {
    it('uses default 30-day range when no params provided', async () => {
      configureAdminAuth();
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);

      // Verify the query was called with gte/lte for the date range
      expect(mockSupabase.from).toHaveBeenCalledWith('verification_history');
      expect(mockSupabase._chain.gte).toHaveBeenCalled();
      expect(mockSupabase._chain.lte).toHaveBeenCalled();
    });

    it('uses custom date range when provided', async () => {
      configureAdminAuth();
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

      const res = await GET(
        makeRequest({ from: '2026-03-01', to: '2026-03-31' }),
      );
      expect(res.status).toBe(200);

      // Verify content disposition has correct dates
      const disposition = res.headers.get('Content-Disposition');
      expect(disposition).toContain('2026-03-01');
      expect(disposition).toContain('2026-03-31');
    });

    it('rejects invalid date formats', async () => {
      configureAdminAuth();

      const res = await GET(makeRequest({ from: 'not-a-date' }));
      expect(res.status).toBe(400);
    });

    it('rejects range exceeding 365 days', async () => {
      configureAdminAuth();

      const res = await GET(
        makeRequest({ from: '2024-01-01', to: '2026-01-01' }),
      );
      expect(res.status).toBe(400);
    });

    it('rejects from after to', async () => {
      configureAdminAuth();

      const res = await GET(
        makeRequest({ from: '2026-04-15', to: '2026-04-01' }),
      );
      expect(res.status).toBe(400);
    });
  });

  describe('PDF generation', () => {
    it('returns valid PDF with Content-Disposition header', async () => {
      configureAdminAuth();
      const rows = [makeVerificationRow()];
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: rows, error: null }),
      );

      const res = await GET(
        makeRequest({ from: '2026-04-01', to: '2026-04-15' }),
      );
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(
        'attachment; filename="verification-history-2026-04-01-to-2026-04-15.pdf"',
      );
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    });

    it('returns valid PDF with empty results', async () => {
      configureAdminAuth();
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: [], error: null }),
      );

      const res = await GET(makeRequest());
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('application/pdf');
    });
  });

  describe('Access logging', () => {
    it('records successful pipeline run', async () => {
      configureAdminAuth();
      const rows = [makeVerificationRow()];
      mockSupabase._chain.then.mockImplementation(
        (resolve: (v: unknown) => void) =>
          resolve({ data: rows, error: null }),
      );

      await GET(makeRequest({ from: '2026-04-01', to: '2026-04-15' }));

      expect(recordPipelineRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          pipelineName: 'provenance_audit_pdf',
          status: 'completed',
          itemsProcessed: 1,
          result: expect.objectContaining({
            from: '2026-04-01',
            to: '2026-04-15',
            row_count: 1,
            exported_by: TEST_USER_ID,
          }),
        }),
      );
    });
  });
});
