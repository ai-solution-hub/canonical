/**
 * API route test for GET /api/engagement-groups — ID-145 {145.35}. Lists
 * engagement groups for the browse/library bulk "Assign to engagement
 * group" picker (BI-33 owner ruling, S479) — mirrors GET /api/workspaces'
 * shape/auth posture (any authenticated member may read, per the
 * engagement_groups SELECT policy, W1c STEP 6).
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureUnauthenticated,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

vi.spyOn(console, 'error').mockImplementation(() => {});

import { GET as listEngagementGroups } from '@/app/api/engagement-groups/route';

function resetMocks() {
  vi.clearAllMocks();

  const chainableMethods = ['select', 'eq', 'order'] as const;
  for (const method of chainableMethods) {
    mockSupabase._chain[method].mockReset();
    mockSupabase._chain[method].mockReturnValue(mockSupabase._chain);
  }

  mockSupabase._chain.then.mockReset();
  mockSupabase._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null }),
  );

  mockSupabase.auth.getUser.mockReset();
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: 'test-user-id', email: 'test@example.com' } },
    error: null,
  });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
}

describe('GET /api/engagement-groups', () => {
  beforeEach(resetMocks);

  it('returns 401 when unauthenticated', async () => {
    configureUnauthenticated(mockSupabase);

    const req = createTestRequest('/api/engagement-groups');
    const res = await listEngagementGroups(req);

    expect(res.status).toBe(401);
  });

  it('returns 200 with the engagement group list ordered by name', async () => {
    const groups = [
      { id: '11111111-1111-4111-8111-111111111111', name: 'Alpha Tender' },
      { id: '22222222-2222-4222-8222-222222222222', name: 'Beta ITT' },
    ];
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) => resolve({ data: groups, error: null }),
    );

    const req = createTestRequest('/api/engagement-groups');
    const res = await listEngagementGroups(req);

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(groups);
    expect(mockSupabase.from).toHaveBeenCalledWith('engagement_groups');
    expect(mockSupabase._chain.order).toHaveBeenCalledWith('name');
  });

  it('returns 500 when the Supabase query fails', async () => {
    mockSupabase._chain.then.mockImplementation(
      (resolve: (v: unknown) => void) =>
        resolve({ data: null, error: { message: 'Connection failed' } }),
    );

    const req = createTestRequest('/api/engagement-groups');
    const res = await listEngagementGroups(req);

    expect(res.status).toBe(500);
  });
});
