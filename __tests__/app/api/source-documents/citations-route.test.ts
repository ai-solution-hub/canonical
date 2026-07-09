/**
 * API route tests for GET /api/source-documents/[id]/citations — ID-135.12.
 *
 * TECH §3 BI-27 + §4, AAT-4 (id-135-okf-human-search-browse-ui): the citations
 * panel ({135.16}) reads the id-131 BI-23 CITE-EXT `cited_target_kind` enum
 * (`q_a_pair | reference_item | source_document | concept`). `citations` is
 * 0 rows in production today — the route MUST return HTTP 200 with an empty
 * grouped payload, never an error. The route is built + tested against the
 * EXTENDED contract (AAT-4, in flight via the id-131 G-cluster) using MOCKED
 * rows — the citations contract is a Task-level dependency on id-131, not a
 * subtask dependency, so live data is never exercised here.
 *
 * Mock discipline: shared createMockSupabaseClient() + createTestRequest() +
 * createTestParams() (per __tests__/CLAUDE.md — never hand-roll Supabase
 * mocks). getAuthenticatedClient() only calls auth.getUser() (no role
 * lookup), so the default mock user is already "authenticated" — only the
 * unauthenticated case needs explicit configuration. The citations SELECT
 * resolves through the chain's `.then()` terminator (array response, not
 * `.single()`), mirroring __tests__/api/guides.test.ts.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
  type MockSupabaseClient,
} from '../../../helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '../../../helpers/mock-next';

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

import { GET } from '@/app/api/source-documents/[id]/citations/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DOC_ID = '550e8400-e29b-41d4-a716-446655440000';

function citationsRequest() {
  return GET(createTestRequest(`/api/source-documents/${DOC_ID}/citations`), {
    params: createTestParams({ id: DOC_ID }),
  });
}

/** Queue a resolved value for the citations SELECT (array-returning chain). */
function queueCitationsRows(
  client: MockSupabaseClient,
  rows: Record<string, unknown>[],
) {
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: rows, error: null }),
  );
}

function queueCitationsError(client: MockSupabaseClient, message: string) {
  client._chain.then.mockImplementationOnce((resolve: (v: unknown) => void) =>
    resolve({ data: null, error: { message, code: 'PGRST000' } }),
  );
}

function citationRow(overrides: Record<string, unknown>) {
  return {
    id: 'citation-1',
    cited_kind: 'q_a_pair',
    citing_kind: 'form_response',
    citation_type: 'grounding',
    cited_text: 'quoted text',
    cited_q_a_pair_id: null,
    cited_reference_item_id: null,
    cited_source_document_id: null,
    cited_concept_path: null,
    created_at: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/source-documents/[id]/citations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'test-user-id', email: 'test@example.com' } },
      error: null,
    });
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null, count: 0 }),
    );
  });

  // -------------------------------------------------------------------------
  // Auth gating
  // -------------------------------------------------------------------------
  describe('auth gating', () => {
    it('returns 401 via authFailureResponse when unauthenticated', async () => {
      configureUnauthenticated(mockSupabase);

      const res = await citationsRequest();

      expect(res.status).toBe(401);
      expect(mockSupabase.from).not.toHaveBeenCalledWith('citations');
    });
  });

  // -------------------------------------------------------------------------
  // Invalid id gating
  // -------------------------------------------------------------------------
  describe('id validation', () => {
    it('returns 400 for a non-UUID id, never reaching the citations query', async () => {
      const res = await GET(
        createTestRequest('/api/source-documents/not-a-uuid/citations'),
        { params: createTestParams({ id: 'not-a-uuid' }) },
      );

      expect(res.status).toBe(400);
      expect(mockSupabase.from).not.toHaveBeenCalledWith('citations');
    });
  });

  // -------------------------------------------------------------------------
  // Empty payload — the production-today case (0 rows)
  // -------------------------------------------------------------------------
  describe('no citations', () => {
    it('returns HTTP 200 with every cited_target_kind bucket present and empty, not an error', async () => {
      queueCitationsRows(mockSupabase, []);

      const res = await citationsRequest();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.document_id).toBe(DOC_ID);
      expect(body.citations).toEqual({
        q_a_pair: [],
        reference_item: [],
        source_document: [],
        concept: [],
      });
    });
  });

  // -------------------------------------------------------------------------
  // Grouped-by-kind payload — MOCKED rows against the extended AAT-4 contract
  // -------------------------------------------------------------------------
  describe('citations grouped by cited_target_kind', () => {
    it('buckets mocked rows spanning all four target kinds', async () => {
      queueCitationsRows(mockSupabase, [
        citationRow({
          id: 'c-qa',
          cited_kind: 'q_a_pair',
          cited_q_a_pair_id: 'qa-1',
        }),
        citationRow({
          id: 'c-ref',
          cited_kind: 'reference_item',
          cited_reference_item_id: 'ref-1',
        }),
        citationRow({
          id: 'c-doc',
          cited_kind: 'source_document',
          cited_source_document_id: 'doc-1',
        }),
        citationRow({
          id: 'c-concept',
          cited_kind: 'concept',
          cited_concept_path: 'procurement.thresholds',
        }),
      ]);

      const res = await citationsRequest();

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.citations.q_a_pair).toHaveLength(1);
      expect(body.citations.q_a_pair[0].id).toBe('c-qa');
      expect(body.citations.reference_item).toHaveLength(1);
      expect(body.citations.reference_item[0].id).toBe('c-ref');
      expect(body.citations.source_document).toHaveLength(1);
      expect(body.citations.source_document[0].id).toBe('c-doc');
      expect(body.citations.concept).toHaveLength(1);
      expect(body.citations.concept[0].id).toBe('c-concept');
    });

    it('groups multiple rows of the same kind into one bucket', async () => {
      queueCitationsRows(mockSupabase, [
        citationRow({ id: 'c-1', cited_kind: 'q_a_pair' }),
        citationRow({ id: 'c-2', cited_kind: 'q_a_pair' }),
      ]);

      const res = await citationsRequest();
      const body = await res.json();

      expect(body.citations.q_a_pair).toHaveLength(2);
      expect(body.citations.reference_item).toEqual([]);
    });

    it('queries the citations table scoped to the document id', async () => {
      queueCitationsRows(mockSupabase, []);

      await citationsRequest();

      expect(mockSupabase.from).toHaveBeenCalledWith('citations');
      expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
        'cited_source_document_id',
        DOC_ID,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Query failure — a genuine DB error is not silently swallowed as empty
  // -------------------------------------------------------------------------
  describe('query failure', () => {
    it('returns a 500 error response when the citations query fails', async () => {
      queueCitationsError(mockSupabase, 'connection reset');

      const res = await citationsRequest();

      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Proxy-allowlist absence — this route is authenticated, never public
  // -------------------------------------------------------------------------
  describe('proxy-allowlist absence', () => {
    it('isPublicRoute returns false for the citations route', async () => {
      const { isPublicRoute } = await import('@/lib/routes');
      expect(isPublicRoute(`/api/source-documents/${DOC_ID}/citations`)).toBe(
        false,
      );
    });

    it('PUBLIC_ROUTES does not include any prefix of the citations route', async () => {
      const { PUBLIC_ROUTES } = await import('@/lib/routes');
      const routePath = `/api/source-documents/${DOC_ID}/citations`;
      for (const publicRoute of PUBLIC_ROUTES) {
        expect(routePath.startsWith(publicRoute)).toBe(false);
      }
    });
  });
});
