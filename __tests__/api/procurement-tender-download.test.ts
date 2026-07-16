/**
 * GET /api/procurement/[id]/tender/download — ID-145 {145.19} folded-in gap
 * (journalled S479, DR-068 §A6).
 *
 * Prior behaviour: the path-prefix guard only accepted
 * `${procurementId}/...` (this form's own storage prefix), so an
 * engagement-scoped attachment (`engagement/<groupId>/...`, {147.7}
 * `form_attachments`) always 403'd — engagement attachments listed in the
 * Documents tab but could never preview.
 *
 * Fix: extend the path-prefix guard to ALSO accept `engagement/<groupId>/...`
 * PROVIDED `<groupId>` matches the REQUESTING form's own
 * `form_instances.engagement_group_id` — a parent-child predicate, not a
 * blanket `engagement/*` allow (an ungrouped form, or a form in a DIFFERENT
 * group, must not be able to read another group's attachment by guessing its
 * path).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../helpers/mock-supabase';
import { createTestRequest, createTestParams } from '../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { GET } from '@/app/api/procurement/[id]/tender/download/route';

const FORM_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ENGAGEMENT_ID = 'c3d4e5f6-a7b8-4012-cdef-123456789012';
const OTHER_ENGAGEMENT_ID = 'd4e5f6a7-b8c9-4123-def0-234567890123';

function formRow(engagementGroupId: string | null) {
  return { id: FORM_ID, engagement_group_id: engagementGroupId };
}

function request(path: string) {
  return createTestRequest(`/api/procurement/${FORM_ID}/tender/download`, {
    searchParams: { path },
  });
}

beforeEach(() => {
  vi.clearAllMocks();

  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  for (const m of ['select', 'eq'] as const) {
    mockSupabase._chain[m].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase.storage.from.mockReturnValue({
    createSignedUrl: vi.fn().mockResolvedValue({
      data: { signedUrl: 'https://example.com/signed.pdf' },
      error: null,
    }),
  });
});

describe('GET /api/procurement/[id]/tender/download', () => {
  it('signs a form-scoped attachment path (unchanged existing behaviour)', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: formRow(null),
      error: null,
    });

    const res = await GET(request(`${FORM_ID}/attachments/att-1-cv.pdf`), {
      params: createTestParams({ id: FORM_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.download_url).toBe('https://example.com/signed.pdf');
  });

  it("signs an engagement-scoped attachment path when it matches the requesting form's own engagement group", async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: formRow(ENGAGEMENT_ID),
      error: null,
    });

    const res = await GET(request(`engagement/${ENGAGEMENT_ID}/att-3-cv.pdf`), {
      params: createTestParams({ id: FORM_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.download_url).toBe('https://example.com/signed.pdf');
  });

  it('rejects an engagement-scoped path for a DIFFERENT engagement group than the requesting form belongs to', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: formRow(ENGAGEMENT_ID),
      error: null,
    });

    const res = await GET(
      request(`engagement/${OTHER_ENGAGEMENT_ID}/att-9-cv.pdf`),
      { params: createTestParams({ id: FORM_ID }) },
    );

    expect(res.status).toBe(403);
  });

  it('rejects an engagement-scoped path when the requesting form is ungrouped', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: formRow(null),
      error: null,
    });

    const res = await GET(request(`engagement/${ENGAGEMENT_ID}/att-3-cv.pdf`), {
      params: createTestParams({ id: FORM_ID }),
    });

    expect(res.status).toBe(403);
  });

  it('rejects a path matching neither this form nor its engagement group', async () => {
    mockSupabase._chain.single.mockResolvedValueOnce({
      data: formRow(ENGAGEMENT_ID),
      error: null,
    });

    const res = await GET(request(`some-other-form-id/attachments/x.pdf`), {
      params: createTestParams({ id: FORM_ID }),
    });

    expect(res.status).toBe(403);
  });
});
