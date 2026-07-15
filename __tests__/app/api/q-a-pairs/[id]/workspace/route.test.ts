/**
 * API route test for PATCH /api/q-a-pairs/[id]/workspace — ID-145 {145.23}
 * round-2 (mandatory extra #4).
 *
 * RETIRED (410 Gone), mirroring the {145.19}
 * `app/api/procurement/[id]/forms/route.ts` retirement test pattern:
 * `q_a_pairs.source_workspace_id` — the sole column this route ever
 * wrote — was DROPPED outright by W1c with no replacement (workspace
 * lineage retired system-wide for Q&A pairs). See the route file's header
 * comment for the full adjudication + the flagged live-UI-caller finding.
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockSupabaseClient } from '../../../../../helpers/mock-supabase';
import { createTestRequest } from '../../../../../helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ getAll: () => [], set: () => {} }),
}));

import { PATCH } from '@/app/api/q-a-pairs/[id]/workspace/route';

const PAIR_ID = '55555555-5555-4555-8555-555555555555';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /api/q-a-pairs/[id]/workspace (retired, {145.23} round-2)', () => {
  it('returns 410 Gone unconditionally, without touching Supabase', async () => {
    const req = createTestRequest(`/api/q-a-pairs/${PAIR_ID}/workspace`, {
      method: 'PATCH',
      body: { source_workspace_id: '66666666-6666-4666-8666-666666666666' },
    });
    const res = await PATCH(req, {
      params: Promise.resolve({ id: PAIR_ID }),
    });

    expect(res.status).toBe(410);
    const body = await res.json();
    expect(body.error).toMatch(/retired/i);
    expect(mockSupabase.from).not.toHaveBeenCalled();
  });
});
