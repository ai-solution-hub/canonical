/**
 * Procurement export API route tests.
 *
 * Tests the bid export endpoints:
 *   - POST /api/bids/:id/export/docx — generate Word document export
 *   - POST /api/bids/:id/export/xlsx — generate Excel spreadsheet export
 *
 * Covers auth enforcement, UUID validation, Content-Type/Content-Disposition headers,
 * bid-not-found handling, and empty questions handling.
 *
 * Export routes return binary blobs — we test headers rather than parsing content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client
// ---------------------------------------------------------------------------

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

// Mock the export generation libraries — they produce binary output we don't need
vi.mock('@/lib/procurement/procurement-export-docx', () => ({
  generateBidDocx: vi.fn().mockResolvedValue(Buffer.from('mock-docx-content')),
}));

vi.mock('@/lib/procurement/procurement-export-xlsx', () => ({
  generateBidXlsx: vi.fn().mockResolvedValue(Buffer.from('mock-xlsx-content')),
}));

// Suppress console.error noise
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import route handlers AFTER mocks
// ---------------------------------------------------------------------------

import { POST as postDocxExport } from '@/app/api/procurement/[id]/export/docx/route';
import { POST as postXlsxExport } from '@/app/api/procurement/[id]/export/xlsx/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BID_UUID = '00000000-0000-4000-8000-000000000001';

// ---------------------------------------------------------------------------
// Reset helper
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  const chainableMethods = [
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
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.maybeSingle.mockResolvedValue({
    data: null,
    error: null,
    count: null,
  });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });
}

/**
 * Helper: configure mocks for a successful export scenario.
 * Sets up bid workspace lookup and questions with responses.
 */
function configureBidWithQuestions(procurementName = 'Test Procurement') {
  // First .single(): bid workspace lookup
  mockSupabase._chain.single.mockResolvedValueOnce({
    data: {
      id: BID_UUID,
      name: procurementName,
      type: 'bid',
      status: 'draft',
      domain_metadata: {
        buyer: 'Test Buyer',
        reference_number: 'REF-001',
        deadline: '2026-06-01',
      },
    },
    error: null,
  });

  // .then(): questions with nested responses
  mockSupabase._chain.then.mockImplementationOnce(
    (resolve: (v: unknown) => void) =>
      resolve({
        data: [
          {
            id: '00000000-0000-4000-8000-000000000010',
            section_name: 'Technical',
            section_sequence: 0,
            question_sequence: 0,
            question_text: 'What is your approach?',
            word_limit: 500,
            evaluation_weight: 30,
            confidence_posture: 'high',
            status: 'complete',
            bid_responses: {
              id: '00000000-0000-4000-8000-000000000020',
              response_text: '<p>Our approach is...</p>',
              response_text_advanced: null,
              review_status: 'approved',
              metadata: {},
              source_content_ids: [],
            },
          },
        ],
        error: null,
      }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Procurement Export API', () => {
  beforeEach(() => {
    resetMocks();
  });

  // =========================================================================
  // DOCX Export
  // =========================================================================

  describe('POST /api/bids/:id/export/docx', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/docx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 404 for non-existent bid', async () => {
      // Procurement lookup returns error
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/docx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toBe('Procurement not found');
    });

    it('returns 400 for invalid bid ID', async () => {
      const request = createTestRequest(
        '/api/procurement/not-a-uuid/export/docx',
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: 'not-a-uuid' }),
      });
      expect(response.status).toBe(400);
    });

    it('returns 404 when bid has no questions', async () => {
      // Procurement exists
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: BID_UUID,
          name: 'Empty Procurement',
          type: 'bid',
          status: 'draft',
          domain_metadata: {},
        },
        error: null,
      });

      // Questions: empty
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/docx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toContain('No questions found');
    });

    it('returns 200 with correct Content-Type for DOCX', async () => {
      configureBidWithQuestions();

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/docx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(200);

      expect(response.headers.get('Content-Type')).toBe(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      );
    });

    it('returns correct Content-Disposition header for DOCX', async () => {
      configureBidWithQuestions('My Test Procurement!');

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/docx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postDocxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(200);

      const disposition = response.headers.get('Content-Disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('.docx');
      // Sanitised filename: special characters removed
      expect(disposition).toContain('my-test-procurement');
    });
  });

  // =========================================================================
  // XLSX Export
  // =========================================================================

  describe('POST /api/bids/:id/export/xlsx', () => {
    it('returns 401 when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/xlsx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(401);
    });

    it('returns 404 for non-existent bid', async () => {
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: null,
        error: { message: 'Not found' },
      });

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/xlsx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(404);
    });

    it('returns 200 with correct Content-Type for XLSX', async () => {
      configureBidWithQuestions();

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/xlsx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(200);

      expect(response.headers.get('Content-Type')).toBe(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
    });

    it('returns correct Content-Disposition header for XLSX', async () => {
      configureBidWithQuestions('Budget Proposal 2026');

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/xlsx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      expect(response.status).toBe(200);

      const disposition = response.headers.get('Content-Disposition');
      expect(disposition).toContain('attachment');
      expect(disposition).toContain('.xlsx');
      expect(disposition).toContain('budget-proposal-2026');
    });

    it('returns 400 for invalid bid ID', async () => {
      const request = createTestRequest(
        '/api/procurement/bad-uuid/export/xlsx',
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: 'bad-uuid' }),
      });
      expect(response.status).toBe(400);
    });

    it('handles bid with no questions gracefully', async () => {
      // Procurement exists
      mockSupabase._chain.single.mockResolvedValueOnce({
        data: {
          id: BID_UUID,
          name: 'Empty Procurement',
          type: 'bid',
          status: 'draft',
          domain_metadata: {},
        },
        error: null,
      });

      // Questions: empty
      mockSupabase._chain.then.mockImplementationOnce(
        (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
      );

      const request = createTestRequest(
        `/api/procurement/${BID_UUID}/export/xlsx`,
        {
          method: 'POST',
          body: {},
        },
      );

      const response = await postXlsxExport(request, {
        params: createTestParams({ id: BID_UUID }),
      });
      // fetchProcurementExportData returns 404 for empty questions
      expect(response.status).toBe(404);

      const body = await response.json();
      expect(body.error).toContain('No questions found');
    });
  });
});
