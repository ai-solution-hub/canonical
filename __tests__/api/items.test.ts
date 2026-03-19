import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
// ---------------------------------------------------------------------------

const mockSupabase = createMockSupabaseClient();

// Extra mocks that need hoisting for vi.mock() factory references
const {
  mockCookies,
  mockGenerateEmbedding,
  mockCheckRateLimit,
  mockGenerateSingleFieldChangeSummary,
  mockClassifyContent,
  mockGenerateSummary,
} = vi.hoisted(() => ({
  mockCookies: vi.fn(),
  mockGenerateEmbedding: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockGenerateSingleFieldChangeSummary: vi.fn(),
  mockClassifyContent: vi.fn(),
  mockGenerateSummary: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mockGenerateEmbedding,
}));

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: mockCheckRateLimit,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mockClassifyContent,
}));

vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: mockGenerateSummary,
}));

vi.mock('@/lib/change-summary', () => ({
  generateSingleFieldChangeSummary: mockGenerateSingleFieldChangeSummary,
}));

// Import routes AFTER mocks are registered
import { POST } from '@/app/api/items/route';
import { PATCH, DELETE } from '@/app/api/items/[id]/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

function validCreateBody(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Test Article',
    content: '<p>Some test content for the knowledge base.</p>',
    content_type: 'article',
    auto_classify: false,
    auto_summarise: false,
    auto_embed: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset mocks before each test
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();

  // Re-wire next/headers mock (cleared by clearAllMocks)
  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  // Re-wire Supabase client mocks
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  mockSupabase.rpc.mockResolvedValue({ data: null, error: null });

  // Chainable methods return the chain
  const chainable = [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'in', 'is', 'not', 'ilike', 'contains',
    'gte', 'lte', 'gt', 'lt', 'or', 'order', 'limit', 'range',
  ] as const;
  for (const m of chainable) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  // Terminal methods — mockReset clears both base implementations AND queued
  // mockResolvedValueOnce calls that may not have been consumed by prior tests
  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.maybeSingle.mockReset();
  mockSupabase._chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.csv.mockReset();
  mockSupabase._chain.csv.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation(
    (resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null, count: 0 }),
  );

  // Storage mocks
  const storageBucket = {
    upload: vi.fn().mockResolvedValue({ data: { path: 'test-path' }, error: null }),
    download: vi.fn().mockResolvedValue({ data: new Blob(), error: null }),
    remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    list: vi.fn().mockResolvedValue({ data: [], error: null }),
    getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://example.com/file' } }),
  };
  mockSupabase.storage.from.mockReturnValue(storageBucket);

  // Auth admin mocks
  mockSupabase.auth.admin.listUsers.mockResolvedValue({ data: { users: [] }, error: null });
  mockSupabase.auth.admin.createUser.mockResolvedValue({ data: { user: null }, error: null });
  mockSupabase.auth.admin.updateUserById.mockResolvedValue({ data: { user: null }, error: null });
  mockSupabase.auth.admin.deleteUser.mockResolvedValue({ data: null, error: null });

  // Re-set external dependency mocks
  mockGenerateEmbedding.mockResolvedValue(new Array(1024).fill(0));
  mockCheckRateLimit.mockReturnValue({ allowed: true, remaining: 19 });
  mockGenerateSingleFieldChangeSummary.mockReturnValue('Field updated');
  mockClassifyContent.mockResolvedValue({ domains: [] });
  mockGenerateSummary.mockResolvedValue({ summary_data: {} });
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/items
// ═══════════════════════════════════════════════════════════════════════════

describe('POST /api/items', () => {
  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody(),
    });

    const res = await POST(req);
    expect(res.status).toBe(401);

    const body = await res.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 403 when user has viewer role (requires editor+)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody(),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 with validation details for missing required fields', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: { content_type: 'article' },
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details).toBeInstanceOf(Array);

    const fieldNames = body.details.map((d: { field: string }) => d.field);
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('content');
  });

  it('returns 400 for invalid content_type', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({ content_type: 'invalid_type' }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.some((d: { field: string }) => d.field === 'content_type')).toBe(true);
  });

  it('returns 201 with created item data on success', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'Test Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody(),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.title).toBe('Test Article');
    expect(body.content_type).toBe('article');
    expect(body.created_at).toBe('2026-03-05T12:00:00Z');
  });

  it('returns 500 when Supabase insert fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'RLS policy violation', code: '42501' },
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody(),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to create content item');
  });

  it('passes optional metadata fields through to Supabase insert', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'Tagged Article',
      content_type: 'note',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({
        title: 'Tagged Article',
        content_type: 'note',
        primary_domain: 'Engineering',
        priority: 'high',
        user_tags: ['important', 'urgent'],
        author_name: 'Test Author',
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    expect(mockSupabase.from).toHaveBeenCalledWith('content_items');

    const insertCall = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertCall.primary_domain).toBe('Engineering');
    expect(insertCall.priority).toBe('high');
    expect(insertCall.user_tags).toEqual(['important', 'urgent']);
    expect(insertCall.author_name).toBe('Test Author');
    expect(insertCall.platform).toBe('manual');
    expect(insertCall.created_by).toBe('test-user-id');
  });

  it('returns empty warnings array when AI options succeed', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'AI Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({
        auto_classify: true,
        auto_summarise: true,
        auto_embed: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.warnings).toEqual([]);
    expect(mockClassifyContent).toHaveBeenCalled();
    expect(mockGenerateSummary).toHaveBeenCalled();
  });

  it('awaits classification and summarisation before returning', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'AI Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({
        auto_classify: true,
        auto_summarise: true,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    // Verify both AI functions were called with the correct item ID
    expect(mockClassifyContent).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: VALID_UUID, force: true }),
    );
    expect(mockGenerateSummary).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: VALID_UUID, force: true }),
    );
  });

  it('returns warnings when classification fails but still creates item', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'Warn Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    mockClassifyContent.mockRejectedValueOnce(new Error('Claude API quota exceeded'));

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({ auto_classify: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('Classification failed');
    expect(body.warnings[0]).toContain('Claude API quota exceeded');
  });

  it('returns warnings when summarisation fails but still creates item', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'Warn Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    mockGenerateSummary.mockRejectedValueOnce(new Error('Model overloaded'));

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({ auto_summarise: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toContain('Summary generation failed');
    expect(body.warnings[0]).toContain('Model overloaded');
  });

  it('returns multiple warnings when both AI steps fail', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'Double Fail',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    mockClassifyContent.mockRejectedValueOnce(new Error('API error'));
    mockGenerateSummary.mockRejectedValueOnce(new Error('Timeout'));

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({ auto_classify: true, auto_summarise: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.id).toBe(VALID_UUID);
    expect(body.warnings).toHaveLength(2);
    expect(body.warnings[0]).toContain('Classification failed');
    expect(body.warnings[1]).toContain('Summary generation failed');
  });

  it('does not call classify/summarise when options are disabled', async () => {
    configureRole(mockSupabase, 'editor');

    const createdItem = {
      id: VALID_UUID,
      title: 'No AI Article',
      content_type: 'article',
      created_at: '2026-03-05T12:00:00Z',
    };
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: createdItem,
      error: null,
    });

    const req = createTestRequest('/api/items', {
      method: 'POST',
      body: validCreateBody({
        auto_classify: false,
        auto_summarise: false,
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.warnings).toEqual([]);
    expect(mockClassifyContent).not.toHaveBeenCalled();
    expect(mockGenerateSummary).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/items/[id]
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/items/[id]', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'suggested_title', value: 'New Title' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for viewer role', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'suggested_title', value: 'New Title' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID format', async () => {
    configureRole(mockSupabase, 'editor');

    const badParams = createTestParams({ id: 'not-a-uuid' });
    const req = createTestRequest('/api/items/not-a-uuid', {
      method: 'PATCH',
      body: { field: 'suggested_title', value: 'New Title' },
    });

    const res = await PATCH(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 400 for invalid field name', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'nonexistent_field', value: 'test' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('returns 400 when value is null for NOT NULL field (content)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'content', value: null },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(body.details.some(
      (d: { message: string }) => d.message.includes('cannot be null'),
    )).toBe(true);
  });

  it('returns 404 when item not found', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'suggested_title', value: 'Updated Title' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 200 on successful update', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        title: 'Old Title',
        content: '<p>Content</p>',
        brief: null,
        detail: null,
        reference: null,
        suggested_title: 'Old Title',
        ai_keywords: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        priority: null,
        ai_summary: null,
        content_type: 'article',
        platform: 'manual',
        author_name: null,
        user_tags: null,
      },
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { version: 1 },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'suggested_title', value: 'Updated Title' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.success).toBe(true);

    const updateCall = mockSupabase._chain.update.mock.calls[0][0];
    expect(updateCall.suggested_title).toBe('Updated Title');
    expect(updateCall.updated_by).toBe('test-user-id');
  });

  it('returns 500 when Supabase update fails', async () => {
    configureRole(mockSupabase, 'editor');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: {
        title: 'Existing',
        content: '<p>Content</p>',
        brief: null,
        detail: null,
        reference: null,
        suggested_title: 'Existing',
        ai_keywords: null,
        primary_domain: null,
        primary_subtopic: null,
        secondary_domain: null,
        secondary_subtopic: null,
        priority: null,
        ai_summary: null,
        content_type: 'article',
        platform: 'manual',
        author_name: null,
        user_tags: null,
      },
      error: null,
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'DB error', code: '50000' } }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'PATCH',
      body: { field: 'priority', value: 'high' },
    });

    const res = await PATCH(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to update item');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DELETE /api/items/[id]
// ═══════════════════════════════════════════════════════════════════════════

describe('DELETE /api/items/[id]', () => {
  const params = createTestParams({ id: VALID_UUID });

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(401);
  });

  it('returns 403 for editor role (requires admin)', async () => {
    configureRole(mockSupabase, 'editor');

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 403 for viewer role (requires admin)', async () => {
    configureRole(mockSupabase, 'viewer');

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(403);
  });

  it('returns 400 for invalid UUID format', async () => {
    configureRole(mockSupabase, 'admin');

    const badParams = createTestParams({ id: 'bad-id' });
    const req = createTestRequest('/api/items/bad-id', {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: badParams });
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toMatch(/Invalid item ID/);
  });

  it('returns 404 when item not found', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { message: 'No rows found', code: 'PGRST116' },
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(404);

    const body = await res.json();
    expect(body.error).toBe('Item not found');
  });

  it('returns 200 with deleted confirmation on success', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, title: 'Item To Delete' },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe(VALID_UUID);
  });

  it('only deletes content_items (related records cascade)', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, title: 'Item To Delete' },
      error: null,
    });

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    await DELETE(req, { params });

    const fromCalls = mockSupabase.from.mock.calls.map(
      (c: unknown[]) => c[0],
    );

    // Should only touch content_items (existence check + delete) — no manual cascade
    const contentItemsCalls = fromCalls.filter((t: unknown) => t === 'content_items');
    expect(contentItemsCalls.length).toBe(2); // select + delete

    expect(fromCalls).not.toContain('ingestion_quality_log');
    expect(fromCalls).not.toContain('read_marks');
    expect(fromCalls).not.toContain('content_history');
    expect(fromCalls).not.toContain('content_item_workspaces');
  });

  it('returns 500 when the content_items delete fails', async () => {
    configureRole(mockSupabase, 'admin');

    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: VALID_UUID, title: 'Item To Delete' },
      error: null,
    });

    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: null,
          error: { message: 'FK constraint violation', code: '23503' },
        }),
    );

    const req = createTestRequest(`/api/items/${VALID_UUID}`, {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params });
    expect(res.status).toBe(500);

    const body = await res.json();
    expect(body.error).toBe('Failed to delete content item');
  });
});
