/**
 * API route tests for GET /api/provenance/item/[id]
 *
 * Tests auth gates, UUID validation, not-found handling, and response shape
 * including drafted_by attribution for both AI and human drafts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { configureAuth } from '../helpers/mock-auth';
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

// Mock getItemProvenance to control server-side responses independently
const mockGetItemProvenance = vi.fn();
vi.mock('@/lib/provenance/item-provenance', () => ({
  getItemProvenance: (...args: unknown[]) => mockGetItemProvenance(...args),
}));

// ---------------------------------------------------------------------------
// Import route handler AFTER mocks
// ---------------------------------------------------------------------------

import { GET } from '@/app/api/provenance/item/[id]/route';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const PIPELINE_SYSTEM_USER_ID = 'a0000000-0000-4000-8000-000000000001';
const HUMAN_USER_ID = 'b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildProvenanceResponse(overrides?: Record<string, unknown>) {
  return {
    itemId: VALID_UUID,
    classification: {
      confidence: 0.86,
      primaryDomain: 'health-safety',
      primarySubtopic: 'cdm-regulations',
      secondaryDomain: 'construction',
      secondarySubtopic: 'procurement',
      reasoning: 'The document sets out duty-holder responsibilities...',
      classifiedAt: '2026-04-10T12:00:00Z',
    },
    processing: {
      classificationModel: 'claude-opus-4-6',
      classificationModelSource: 'recorded',
      embeddingModel: 'text-embedding-3-large',
      embeddingModelSource: 'recorded',
      classificationTokensIn: 1420,
      classificationTokensOut: 312,
      classificationCacheCreation: 0,
      classificationCacheRead: 0,
      embeddingTokens: 890,
      estimatedClassifyCost: 0.0447,
      estimatedEmbedCost: 0.0001157,
    },
    drafting: {
      recentDrafts: [
        {
          responseId: 'resp-1',
          bidId: 'bid-1',
          bidName: 'Manchester Schools Refurb',
          questionText: 'Describe your H&S policy',
          draftedAt: '2026-04-11T10:00:00Z',
          attribution: {
            kind: 'claude',
            label: 'Knowledge Hub',
            userId: PIPELINE_SYSTEM_USER_ID,
          },
        },
      ],
      totalDraftCount: 1,
    },
    ...overrides,
  };
}

function resetMocks() {
  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({
    data: null,
    error: null,
  });

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  // Re-establish chainable returns
  const chain = mockSupabase._chain;
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
    chain[method].mockReturnValue(chain);
  }

  mockGetItemProvenance.mockReset();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/provenance/item/[id]', () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Auth gates
  // -------------------------------------------------------------------------

  it('returns 401 for unauthenticated requests', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(401);
  });

  it('returns 200 for admin users', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(buildProvenanceResponse());

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
  });

  it('returns 403 for editor users', async () => {
    configureAuth(mockSupabase).asEditor();

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer users', async () => {
    configureAuth(mockSupabase).asViewer();

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(403);
  });

  // -------------------------------------------------------------------------
  // UUID validation
  // -------------------------------------------------------------------------

  it('returns 400 for invalid UUID', async () => {
    configureAuth(mockSupabase).asAdmin();

    const req = createTestRequest('/api/provenance/item/not-a-uuid');
    const params = createTestParams({ id: 'not-a-uuid' });
    const res = await GET(req, { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('Invalid');
  });

  // -------------------------------------------------------------------------
  // Not found
  // -------------------------------------------------------------------------

  it('returns 404 when item does not exist', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(null);

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain('not found');
  });

  // -------------------------------------------------------------------------
  // drafted_by attribution
  // -------------------------------------------------------------------------

  it('maps PIPELINE_SYSTEM_USER_ID to kind=claude, label=Knowledge Hub', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(
      buildProvenanceResponse({
        drafting: {
          recentDrafts: [
            {
              responseId: 'resp-1',
              bidId: 'bid-1',
              bidName: 'Test Bid',
              questionText: 'Test question',
              draftedAt: '2026-04-11T10:00:00Z',
              attribution: {
                kind: 'claude',
                label: 'Knowledge Hub',
                userId: PIPELINE_SYSTEM_USER_ID,
              },
            },
          ],
          totalDraftCount: 1,
        },
      }),
    );

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    const draft = body.drafting.recentDrafts[0];
    expect(draft.attribution.kind).toBe('claude');
    expect(draft.attribution.label).toBe('Knowledge Hub');
  });

  it('maps null drafted_by to kind=claude, label=Knowledge Hub', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(
      buildProvenanceResponse({
        drafting: {
          recentDrafts: [
            {
              responseId: 'resp-1',
              bidId: 'bid-1',
              bidName: 'Test Bid',
              questionText: 'Test question',
              draftedAt: '2026-04-11T10:00:00Z',
              attribution: {
                kind: 'claude',
                label: 'Knowledge Hub',
                userId: null,
              },
            },
          ],
          totalDraftCount: 1,
        },
      }),
    );

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    const draft = body.drafting.recentDrafts[0];
    expect(draft.attribution.kind).toBe('claude');
    expect(draft.attribution.label).toBe('Knowledge Hub');
  });

  it('maps human UUID to kind=human with display name', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(
      buildProvenanceResponse({
        drafting: {
          recentDrafts: [
            {
              responseId: 'resp-2',
              bidId: 'bid-1',
              bidName: 'Test Bid',
              questionText: 'Test question',
              draftedAt: '2026-04-11T10:00:00Z',
              attribution: {
                kind: 'human',
                label: 'Alice Johnson',
                userId: HUMAN_USER_ID,
              },
            },
          ],
          totalDraftCount: 1,
        },
      }),
    );

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    const draft = body.drafting.recentDrafts[0];
    expect(draft.attribution.kind).toBe('human');
    expect(draft.attribution.label).toBe('Alice Johnson');
    expect(draft.attribution.userId).toBe(HUMAN_USER_ID);
  });

  // -------------------------------------------------------------------------
  // Cost fields
  // -------------------------------------------------------------------------

  it('includes cost data when tokens are present', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(buildProvenanceResponse());

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processing.estimatedClassifyCost).toBeGreaterThan(0);
    expect(body.processing.estimatedEmbedCost).toBeGreaterThan(0);
    expect(body.processing.classificationTokensIn).toBe(1420);
    expect(body.processing.classificationTokensOut).toBe(312);
  });

  it('returns null cost when tokens are not recorded', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockResolvedValue(
      buildProvenanceResponse({
        processing: {
          classificationModel: 'claude-opus-4-6',
          classificationModelSource: 'env_default',
          embeddingModel: 'text-embedding-3-large',
          embeddingModelSource: 'env_default',
          classificationTokensIn: null,
          classificationTokensOut: null,
          classificationCacheCreation: null,
          classificationCacheRead: null,
          embeddingTokens: null,
          estimatedClassifyCost: null,
          estimatedEmbedCost: null,
        },
      }),
    );

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.processing.estimatedClassifyCost).toBeNull();
    expect(body.processing.estimatedEmbedCost).toBeNull();
    expect(body.processing.classificationTokensIn).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Server error
  // -------------------------------------------------------------------------

  it('returns 500 on internal error', async () => {
    configureAuth(mockSupabase).asAdmin();
    mockGetItemProvenance.mockRejectedValue(new Error('DB down'));

    const req = createTestRequest('/api/provenance/item/' + VALID_UUID);
    const params = createTestParams({ id: VALID_UUID });
    const res = await GET(req, { params });

    expect(res.status).toBe(500);
  });
});
