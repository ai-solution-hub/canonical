import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ---------------------------------------------------------------------------
// Shared mock client — lazy references in vi.mock() avoid hoisting issues
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

// Suppress console.error noise from the route's error handling
vi.spyOn(console, 'error').mockImplementation(() => {});

// ---------------------------------------------------------------------------
// Import handlers under test (AFTER mocks are registered)
//
// DR-075 (ID-147 TECH.md §6 row B, ratified S474): `templates/route.ts`
// (list/create) is RETIRED outright and `templates/[templateId]/route.ts`
// DELETE is dropped (subsumed by the group-A `[id]/route.ts` DELETE) — no
// replacement test surface for either. Only the GET detail handler survives,
// re-keyed + re-pathed to `[id]/fields`.
// ---------------------------------------------------------------------------

import { GET as getFormFields } from '@/app/api/procurement/[id]/fields/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEMPLATE_UUID = '00000000-0000-4000-8000-000000000002';

/** Reset mock state and restore default authenticated user. */
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

// ---------------------------------------------------------------------------
// GET /api/procurement/:id/fields — form field/slot detail
// ---------------------------------------------------------------------------

describe('GET /api/procurement/:id/fields', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest(`/api/procurement/${TEMPLATE_UUID}/fields`);
    const params = createTestParams({ id: TEMPLATE_UUID });
    const res = await getFormFields(req, { params });

    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe('Unauthorised');
  });

  it('returns 400 for invalid UUID', async () => {
    const req = createTestRequest('/api/procurement/bad-id/fields');
    const params = createTestParams({ id: 'bad-id' });
    const res = await getFormFields(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('Invalid ID format');
  });

  it('returns 404 when the form does not exist', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'No rows found' },
    });

    const req = createTestRequest(`/api/procurement/${TEMPLATE_UUID}/fields`);
    const params = createTestParams({ id: TEMPLATE_UUID });
    const res = await getFormFields(req, { params });

    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe('Template not found');
  });

  it('returns 200 with form detail, fields, summary, and completions', async () => {
    const mockTemplate = {
      id: TEMPLATE_UUID,
      name: 'Security Questionnaire',
      description: 'Annual security questionnaire',
      filename: 'security-q.docx',
      storage_path: `${TEMPLATE_UUID}/original.docx`,
      file_size: 45000,
      mime_type:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      processing_status: 'analysed',
      field_count: 3,
      mapped_count: 2,
      structure_path: null,
      created_by: 'test-user-id',
      created_at: '2026-03-01T10:00:00Z',
      updated_at: '2026-03-01T11:00:00Z',
    };

    // first single(): form lookup
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: mockTemplate,
      error: null,
    });

    const mockFields = [
      {
        id: 'field-1',
        form_instance_id: TEMPLATE_UUID,
        field_type: 'table_cell',
        table_index: 0,
        row_index: 1,
        col_index: 1,
        question_text: 'Describe your security policy',
        section_name: 'Security',
        word_limit: null,
        placeholder_text: null,
        question_id: null,
        mapping_status: 'unmapped',
        mapping_confidence: null,
        fill_status: null,
        fill_error: null,
        sequence: 1,
        created_at: '2026-03-01T10:05:00Z',
        updated_at: '2026-03-01T10:05:00Z',
      },
      {
        id: 'field-2',
        form_instance_id: TEMPLATE_UUID,
        field_type: 'table_cell',
        table_index: 0,
        row_index: 2,
        col_index: 1,
        question_text: 'Describe your data retention policy',
        section_name: 'Security',
        word_limit: null,
        placeholder_text: null,
        question_id: null,
        mapping_status: 'confirmed',
        mapping_confidence: 0.9,
        fill_status: 'filled',
        fill_error: null,
        sequence: 2,
        created_at: '2026-03-01T10:05:00Z',
        updated_at: '2026-03-01T10:05:00Z',
      },
    ];

    // then() calls: fields, then completions (no question_id set on any
    // field above, so the questions/responses enrichment queries never fire)
    let thenCallCount = 0;
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => {
        thenCallCount++;
        if (thenCallCount === 1) {
          // Fields query
          return resolve({ data: mockFields, error: null });
        }
        // Completions query and anything else
        return resolve({ data: [], error: null });
      },
    );

    const req = createTestRequest(`/api/procurement/${TEMPLATE_UUID}/fields`);
    const params = createTestParams({ id: TEMPLATE_UUID });
    const res = await getFormFields(req, { params });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.id).toBe(TEMPLATE_UUID);
    expect(json.name).toBe('Security Questionnaire');
    // Shape-sync: `status` no longer exists on the response -- callers read
    // `processing_status` (the {145.15} journal-flagged runtime failure).
    expect(json.processing_status).toBe('analysed');
    expect(json.status).toBeUndefined();
    expect(json.workspace_id).toBeUndefined();
    expect(json.fields).toHaveLength(2);
    expect(json.fields[0].question_text).toBe('Describe your security policy');
    expect(json.fields[0].matched_question).toBeNull();
    // Summary is computed in-process from the fields array (no RPC call --
    // the old get_template_summary RPC has zero working callers, see the
    // route's own header comment).
    expect(json.summary.total_fields).toBe(2);
    expect(json.summary.confirmed_fields).toBe(1);
    expect(json.summary.unmapped_fields).toBe(1);
    expect(json.summary.filled_fields).toBe(1);
    expect(json.completions).toEqual([]);
    expect(mockSupabase.rpc).not.toHaveBeenCalled();
  });
});
