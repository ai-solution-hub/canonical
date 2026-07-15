/**
 * ID-145 {145.15} — fill/route.ts BI-23 anchor + BI-22 re-entrant contract.
 *
 * Post-{145.6} W1c: `form_instances` (no `workspace_id`) replaces
 * `form_templates`; `form_instance_fields` (`form_instance_id`) replaces
 * `form_template_fields`; `template_completions` keys on
 * `form_instance_id`. The route now anchors reads/writes on the form's own
 * id (the `templateId` route param) and only fetches mapped fields that are
 * NOT yet filled (BI-22 re-entrancy — a fill pass targets outstanding gaps
 * only; `bid_worker.py`'s `fill_template_job` additionally re-verifies this
 * live before writing).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';
import { _resetRateLimitStore } from '@/lib/rate-limit';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST as fillTemplate } from '@/app/api/procurement/[id]/templates/[templateId]/fill/route';

const PROCUREMENT_ID = '00000000-0000-4000-8000-000000000001';
const FORM_ID = '00000000-0000-4000-8000-000000000099';
const QUESTION_ID = '00000000-0000-4000-8000-000000000050';
const FIELD_ID = '00000000-0000-4000-8000-000000000060';

const CHAINABLE_METHODS = [
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

beforeEach(() => {
  vi.clearAllMocks();
  _resetRateLimitStore();

  mockSupabase._chain.single.mockReset();
  mockSupabase._chain.then.mockReset();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  for (const method of CHAINABLE_METHODS) {
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.single.mockResolvedValue({ data: null, error: null });
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );
  mockSupabase.from.mockReturnValue(mockSupabase._chain);
});

function requestAndParams() {
  const req = createTestRequest(
    `/api/procurement/${PROCUREMENT_ID}/templates/${FORM_ID}/fill`,
    { method: 'POST', body: {} },
  );
  const params = createTestParams({
    id: PROCUREMENT_ID,
    templateId: FORM_ID,
  });
  return { req, params };
}

describe('POST /api/procurement/[id]/templates/[templateId]/fill', () => {
  it('returns 404 when the form does not exist', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: null,
    });

    const { req, params } = requestAndParams();
    const res = await fillTemplate(req, { params });

    expect(res.status).toBe(404);
  });

  it('returns 409 when the form is not analysed or completed', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: FORM_ID, processing_status: 'uploaded' },
      error: null,
    });

    const { req, params } = requestAndParams();
    const res = await fillTemplate(req, { params });

    expect(res.status).toBe(409);
  });

  it('returns 400 when there are no outstanding mapped fields', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: FORM_ID, processing_status: 'analysed' },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { req, params } = requestAndParams();
    const res = await fillTemplate(req, { params });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain('No fields have been mapped');
  });

  it('scopes the fields fetch to this form id, excluding already-filled slots (BI-22)', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: FORM_ID, processing_status: 'analysed' },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );

    const { req, params } = requestAndParams();
    await fillTemplate(req, { params });

    expect(mockSupabase.from).toHaveBeenCalledWith('form_instance_fields');
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith(
      'form_instance_id',
      FORM_ID,
    );
    expect(mockSupabase._chain.neq).toHaveBeenCalledWith(
      'fill_status',
      'filled',
    );
  });

  it('enqueues a flat form_id-keyed payload — no workspace_id/template_id/storage_path (202)', async () => {
    configureRole(mockSupabase, 'editor');

    // 1. form fetch
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: FORM_ID, processing_status: 'analysed' },
      error: null,
    });

    // 2. fields fetch
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              id: FIELD_ID,
              table_index: 0,
              row_index: 0,
              col_index: 1,
              question_id: QUESTION_ID,
              word_limit: null,
              mapping_status: 'confirmed',
              fill_status: 'pending',
            },
          ],
          error: null,
        }),
    );

    // 3. responses fetch
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [
            {
              question_id: QUESTION_ID,
              response_text: 'Our approach is...',
              review_status: 'approved',
              version: 1,
            },
          ],
          error: null,
        }),
    );

    // 4. update-to-filling falls through to the default {data:[],error:null}

    // 5. processing_queue job insert
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: 'job-1' },
      error: null,
    });

    const { req, params } = requestAndParams();
    const res = await fillTemplate(req, { params });

    expect(res.status).toBe(202);
    const json = await res.json();
    expect(json.job_id).toBe('job-1');

    expect(mockSupabase.from).toHaveBeenCalledWith('processing_queue');
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0] as {
      job_type: string;
      payload: Record<string, unknown>;
    };
    expect(insertArg.job_type).toBe('template_fill');
    expect(insertArg.payload.form_id).toBe(FORM_ID);
    expect(insertArg.payload).not.toHaveProperty('workspace_id');
    expect(insertArg.payload).not.toHaveProperty('template_id');
    expect(insertArg.payload).not.toHaveProperty('storage_path');
    const fieldMappings = insertArg.payload.field_mappings as Array<{
      field_id: string;
    }>;
    expect(fieldMappings).toHaveLength(1);
    expect(fieldMappings[0].field_id).toBe(FIELD_ID);
  });
});
