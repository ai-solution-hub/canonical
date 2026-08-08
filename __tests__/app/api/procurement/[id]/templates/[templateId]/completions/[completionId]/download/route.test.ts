/**
 * GET /api/procurement/[id]/templates/[templateId]/completions/[completionId]/download
 *
 * Split out of the former `__tests__/app/api/remaining-routes.test.ts`
 * catch-all (test-tree workstream 2b) so each production route has exactly one
 * test file. The describe title there still read `/api/bids/:id/...`; the route
 * has been under `/api/procurement/` since the bids→procurement rename, so the
 * title is corrected here.
 *
 * DR-075 (ID-147 TECH.md §6 row B, ratified S474): the route was RE-KEYED in
 * place — path unchanged, tables -> form_instances /
 * template_completions.form_instance_id, plus a bucket-fallback storage read
 * (tender-documents, falling back to the legacy templates bucket for
 * pre-{145.15}-cutover completions).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import {
  createTestRequest,
  createTestParams,
} from '@/__tests__/helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

// Import the route AFTER mocks are registered
import { GET as completionDownloadGet } from '@/app/api/procurement/[id]/templates/[templateId]/completions/[completionId]/download/route';

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const VALID_UUID_2 = 'b2c3d4e5-f6a7-8901-bcde-f12345678901';
const VALID_UUID_3 = 'c3d4e5f6-a7b8-9012-cdef-123456789012';

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  // Chainable methods return the chain
  for (const m of ['select', 'eq'] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  // Terminal methods — reset to avoid leftover mockResolvedValueOnce calls
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });

  // Storage mock — createSignedUrl is the download route's only storage call
  mockSupabase.storage.from.mockReturnValue({
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed-url' },
      error: null,
    }),
  });
});

describe('GET /api/procurement/:id/templates/:templateId/completions/:completionId/download', () => {
  const params = createTestParams({
    id: VALID_UUID,
    templateId: VALID_UUID_2,
    completionId: VALID_UUID_3,
  });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid UUID in any param', async () => {
    const badParams = createTestParams({
      id: 'bad-id',
      templateId: VALID_UUID_2,
      completionId: VALID_UUID_3,
    });

    const req = createTestRequest(
      `/api/procurement/bad-id/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid ID format/);
  });

  it('returns 404 when template not found for the procurement form', async () => {
    // Template lookup — not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Template not found');
  });

  it('returns 404 when completion not found', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — not found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows', code: 'PGRST116' },
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Completion not found');
  });

  it('returns 200 with signed download URL on success', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        storage_path: 'completions/file.docx',
        fields_filled: 5,
      },
      error: null,
    });

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.download_url).toBe('https://example.com/signed-url');
    expect(body.expires_in).toBe(300);
    // Tries the post-{145.15} bucket first.
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('tender-documents');
  });

  it('falls back to the legacy templates bucket when the tender-documents lookup fails', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — found (a pre-{145.15}-cutover row)
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        storage_path: 'completions/pre-cutover.docx',
        fields_filled: 5,
      },
      error: null,
    });

    // tender-documents fails, templates succeeds.
    const tenderDocumentsBucket = {
      createSignedUrl: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Not found' },
      }),
    };
    const templatesBucket = {
      createSignedUrl: vi.fn().mockResolvedValue({
        data: { signedUrl: 'https://example.com/legacy-signed-url' },
        error: null,
      }),
    };
    mockSupabase.storage.from.mockImplementation((bucket: string) =>
      bucket === 'tender-documents' ? tenderDocumentsBucket : templatesBucket,
    );

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.download_url).toBe('https://example.com/legacy-signed-url');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('tender-documents');
    expect(mockSupabase.storage.from).toHaveBeenCalledWith('templates');
  });

  it('returns 500 when signed URL generation fails', async () => {
    // Template lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID_2 },
      error: null,
    });

    // Completion lookup — found
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        id: VALID_UUID_3,
        storage_path: 'completions/file.docx',
        fields_filled: 5,
      },
      error: null,
    });

    // Override storage mock to fail
    const failBucket = {
      createSignedUrl: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Storage error' },
      }),
    };
    mockSupabase.storage.from.mockReturnValue(failBucket);

    const req = createTestRequest(
      `/api/procurement/${VALID_UUID}/templates/${VALID_UUID_2}/completions/${VALID_UUID_3}/download`,
    );

    const res = await completionDownloadGet(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to generate download link');
  });
});
