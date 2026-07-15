import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

// ID-145 {145.19} groups A+C (DR-075 §6 ruling, ratified S474): this route is
// RETIRED — the workspace-holds-many-forms container it used to mutate
// (`form_templates.workspace_id`) no longer exists post-W1c. Sibling-form
// creation/type-override is not a v1 affordance (PRODUCT §A3: engagement
// grouping is read-only lineage only) — both handlers return 410 Gone
// unconditionally, with no Supabase read/write.

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { POST, PATCH } from '@/app/api/procurement/[id]/forms/route';

const WS_ID = '00000000-0000-4000-8000-000000000001';
const FORM_ID = '00000000-0000-4000-8000-000000000099';

beforeEach(() => {
  vi.clearAllMocks();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });
});

describe('POST /api/procurement/[id]/forms (retired, DR-075 §6)', () => {
  it('returns 410 Gone unconditionally, without touching Supabase', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'POST',
      body: { form_type: 'itt' },
    });
    const res = await POST(req, { params: createTestParams({ id: WS_ID }) });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/retired/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/procurement/[id]/forms (retired, DR-075 §6)', () => {
  it('returns 410 Gone unconditionally, without touching Supabase', async () => {
    configureRole(mockSupabase, 'editor');
    const req = createTestRequest(`/api/procurement/${WS_ID}/forms`, {
      method: 'PATCH',
      body: { form_id: FORM_ID, form_type: 'tender' },
    });
    const res = await PATCH(req, { params: createTestParams({ id: WS_ID }) });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/retired/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
