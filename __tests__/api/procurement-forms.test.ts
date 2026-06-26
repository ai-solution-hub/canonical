import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
  configureUnauthenticated,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ID-130 {130.13} — add-a-form route (B-16/B-19, TECH T-B16). POST mints a
// child form_templates row with a CONFIRMED form_type (confirm-first); PATCH
// overrides an existing form's inferred type.

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { POST, PATCH } from '@/app/api/procurement/[id]/forms/route';

const WS_ID = '00000000-0000-4000-8000-000000000001';
const FORM_ID = '00000000-0000-4000-8000-000000000099';

const CREATED_FORM = {
  id: FORM_ID,
  form_type: 'itt',
  name: 'Untitled form',
  workflow_state: 'draft',
  outcome: null,
  outcome_notes: null,
  deadline: null,
  submission_date: null,
  issuing_organisation: null,
  outcome_recorded_at: null,
  outcome_recorded_by: null,
  created_at: '2026-06-25T00:00:00.000Z',
  updated_at: '2026-06-25T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
  // Restore chainable methods (cleared by clearAllMocks).
  for (const m of [
    'select',
    'insert',
    'update',
    'eq',
    'order',
    'contains',
  ] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }
});

describe('POST /api/procurement/[id]/forms', () => {
  it('creates a form with the confirmed form_type (201) and verifies the row', async () => {
    configureRole(mockSupabase, 'editor');
    // workspace verify
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WS_ID },
      error: null,
    });
    // insert().select() awaited -> the created row
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({ data: [CREATED_FORM], error: null }),
    );

    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: { form_type: 'itt' },
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.form.id).toBe(FORM_ID);
    expect(json.form.form_type).toBe('itt');

    // The insert targets form_templates with the confirmed type + workspace_id.
    expect(mockSupabase.from).toHaveBeenCalledWith('form_templates');
    const insertArg = mockSupabase._chain.insert.mock.calls[0][0];
    expect(insertArg.form_type).toBe('itt');
    expect(insertArg.workspace_id).toBe(WS_ID);
    expect(insertArg.workflow_state).toBe('draft');
    expect(insertArg.ingest_source).toBe('app_upload');
  });

  it('rejects a body with no form_type (confirm-first — never silent-assign) with 400', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: {},
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(400);
    // No insert was attempted.
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('rejects a form_type outside the closed list with 400', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: { form_type: 'not_a_real_type' },
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(400);
    expect(mockSupabase._chain.insert).not.toHaveBeenCalled();
  });

  it('returns 404 when the umbrella is not a procurement workspace', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: null,
      error: { code: 'PGRST116', message: 'no rows' },
    });
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: { form_type: 'itt' },
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(404);
  });

  it('returns 401 for an unauthenticated caller', async () => {
    configureUnauthenticated(mockSupabase);
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: { form_type: 'itt' },
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/procurement/[id]/forms', () => {
  it('overrides an existing form type (B-16) and returns the updated row', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WS_ID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) =>
        resolve({
          data: [{ ...CREATED_FORM, form_type: 'tender' }],
          error: null,
        }),
    );

    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'PATCH',
      body: { form_id: FORM_ID, form_type: 'tender' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.form.form_type).toBe('tender');
    // The update is scoped to the form id AND the umbrella workspace id.
    expect(mockSupabase._chain.update).toHaveBeenCalledWith({
      form_type: 'tender',
    });
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('id', FORM_ID);
    expect(mockSupabase._chain.eq).toHaveBeenCalledWith('workspace_id', WS_ID);
  });

  it('returns 404 when the form does not belong to this procurement', async () => {
    configureRole(mockSupabase, 'editor');
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: { id: WS_ID },
      error: null,
    });
    mockSupabase._chain.then.mockImplementationOnce(
      (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
    );
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'PATCH',
      body: { form_id: FORM_ID, form_type: 'tender' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: WS_ID }) });
    expect(res.status).toBe(404);
  });
});
