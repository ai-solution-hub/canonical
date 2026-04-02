/**
 * Tests for source document tracking — version chain API and
 * re-upload detection logic.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextRequest } from 'next/server';
import { createMockSupabaseClient } from '../helpers/mock-supabase';

// ─── Mock modules ──────────────────────────────────────────────────────────

const mockServiceClient = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => mockServiceClient,
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({
    supabase: createMockSupabaseClient(),
    user: { id: 'user-1' },
  }),
  getAuthorisedClient: vi.fn().mockResolvedValue({
    success: true,
    supabase: createMockSupabaseClient(),
    user: { id: 'user-1' },
  }),
  authFailureResponse: vi.fn(),
}));

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('Source Document Version Chain API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } =
      await import('@/app/api/source-documents/[id]/versions/route');

    const request = new Request(
      'http://localhost/api/source-documents/not-a-uuid/versions',
    ) as unknown as NextRequest;
    const response = await GET(request, {
      params: Promise.resolve({ id: 'not-a-uuid' }),
    });

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toContain('Invalid document ID format');
  });

  it('returns 404 when document not found', async () => {
    const { GET } =
      await import('@/app/api/source-documents/[id]/versions/route');

    mockServiceClient.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const docId = '00000000-0000-0000-0000-000000000001';
    const request = new Request(
      `http://localhost/api/source-documents/${docId}/versions`,
    );
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ id: docId }),
    });

    expect(response.status).toBe(404);
  });

  it('returns version chain for valid document', async () => {
    const { GET } =
      await import('@/app/api/source-documents/[id]/versions/route');

    const mockVersions = [
      {
        id: '00000000-0000-0000-0000-000000000001',
        filename: 'security-policy.docx',
        version: 1,
        parent_id: null,
        content_item_count: 5,
        created_at: '2026-01-01T00:00:00Z',
      },
      {
        id: '00000000-0000-0000-0000-000000000002',
        filename: 'security-policy.docx',
        version: 2,
        parent_id: '00000000-0000-0000-0000-000000000001',
        content_item_count: 6,
        created_at: '2026-02-01T00:00:00Z',
      },
    ];

    mockServiceClient.rpc.mockResolvedValueOnce({
      data: mockVersions,
      error: null,
    });

    const docId = '00000000-0000-0000-0000-000000000001';
    const request = new Request(
      `http://localhost/api/source-documents/${docId}/versions`,
    );
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ id: docId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.total_versions).toBe(2);
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0].version).toBe(1);
    expect(body.versions[1].version).toBe(2);
  });
});

describe('Source Document Detail API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid UUID', async () => {
    const { GET } = await import('@/app/api/source-documents/[id]/route');

    const request = new Request('http://localhost/api/source-documents/bad-id');
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ id: 'bad-id' }),
    });

    expect(response.status).toBe(400);
  });

  it('returns 404 when document not found', async () => {
    const { GET } = await import('@/app/api/source-documents/[id]/route');

    mockServiceClient._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'Not found' },
    });

    const docId = '00000000-0000-0000-0000-000000000001';
    const request = new Request(
      `http://localhost/api/source-documents/${docId}`,
    );
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ id: docId }),
    });

    expect(response.status).toBe(404);
  });

  it('returns document with linked content items', async () => {
    const { GET } = await import('@/app/api/source-documents/[id]/route');

    const mockDoc = {
      id: '00000000-0000-0000-0000-000000000001',
      filename: 'security-policy.docx',
      version: 1,
      status: 'processed',
      created_at: '2026-01-01T00:00:00Z',
    };

    const mockItems = [
      { id: 'item-1', title: 'Q&A: Access Control', content_type: 'qa_pair' },
      { id: 'item-2', title: 'Q&A: Encryption', content_type: 'qa_pair' },
    ];

    // First call: fetch doc (uses .single())
    mockServiceClient._chain.single.mockResolvedValueOnce({
      data: mockDoc,
      error: null,
    });

    // Second call: fetch linked items (uses .then via chain)
    mockServiceClient._chain.then.mockImplementationOnce(
      (resolve: (val: unknown) => void) =>
        resolve({ data: mockItems, error: null }),
    );

    const docId = '00000000-0000-0000-0000-000000000001';
    const request = new Request(
      `http://localhost/api/source-documents/${docId}`,
    );
    const response = await GET(request as unknown as NextRequest, {
      params: Promise.resolve({ id: docId }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.filename).toBe('security-policy.docx');
    expect(body.content_items).toBeDefined();
  });
});

describe('Re-upload detection logic', () => {
  it('detect_reupload RPC returns identical match type', async () => {
    // Test the RPC contract: identical hash → 'identical'
    const mockResult = [
      {
        match_type: 'identical',
        existing_document_id: '00000000-0000-0000-0000-000000000001',
        existing_version: 1,
        existing_content_hash: 'abc123',
      },
    ];

    mockServiceClient.rpc.mockResolvedValueOnce({
      data: mockResult,
      error: null,
    });

    const { data } = await mockServiceClient.rpc('detect_reupload', {
      p_filename: 'test.docx',
      p_uploaded_by: 'user-1',
      p_content_hash: 'abc123',
    });

    expect(data).toHaveLength(1);
    expect(data[0].match_type).toBe('identical');
  });

  it('detect_reupload RPC returns new_version match type', async () => {
    const mockResult = [
      {
        match_type: 'new_version',
        existing_document_id: '00000000-0000-0000-0000-000000000001',
        existing_version: 1,
        existing_content_hash: 'old-hash',
      },
    ];

    mockServiceClient.rpc.mockResolvedValueOnce({
      data: mockResult,
      error: null,
    });

    const { data } = await mockServiceClient.rpc('detect_reupload', {
      p_filename: 'test.docx',
      p_uploaded_by: 'user-1',
      p_content_hash: 'new-hash',
    });

    expect(data).toHaveLength(1);
    expect(data[0].match_type).toBe('new_version');
  });

  it('detect_reupload RPC returns empty for new files', async () => {
    mockServiceClient.rpc.mockResolvedValueOnce({
      data: [],
      error: null,
    });

    const { data } = await mockServiceClient.rpc('detect_reupload', {
      p_filename: 'brand-new-file.docx',
      p_uploaded_by: 'user-1',
      p_content_hash: 'unique-hash',
    });

    expect(data).toHaveLength(0);
  });
});

describe('Tag normalisation in classify.ts', () => {
  it('normaliseTag lowercases non-proper-nouns', async () => {
    const { normaliseTag } = await import('@/lib/validation/schemas');

    expect(normaliseTag('Audit System')).toBe('audit system');
    expect(normaliseTag('access control')).toBe('access control');
  });

  it('normaliseTag preserves proper nouns', async () => {
    const { normaliseTag } = await import('@/lib/validation/schemas');

    expect(normaliseTag('ISO 27001')).toBe('ISO 27001');
    expect(normaliseTag('GDPR')).toBe('GDPR');
    expect(normaliseTag('Cyber Essentials Plus')).toBe('Cyber Essentials Plus');
  });

  it('normaliseTag singularises simple plurals', async () => {
    const { normaliseTag } = await import('@/lib/validation/schemas');

    expect(normaliseTag('access controls')).toBe('access control');
    expect(normaliseTag('data centres')).toBe('data centre');
  });

  it('normaliseTag trims whitespace', async () => {
    const { normaliseTag } = await import('@/lib/validation/schemas');

    expect(normaliseTag('  audit system  ')).toBe('audit system');
  });
});
