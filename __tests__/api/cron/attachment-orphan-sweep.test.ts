// __tests__/api/cron/attachment-orphan-sweep.test.ts
//
// ID-147 {147.8} — the `form_attachments` orphan-sweep backstop. Two layers:
// (1) `findOrphanPaths` is a PURE reconciliation function, exhaustively
//     unit-tested with no mocking (test-philosophy: behaviour-first).
// (2) The route-level test covers cron-auth gating and one end-to-end pass
//     (one engagement folder, one form) proving the wiring: bucket listing
//     -> DB row diff -> best-effort remove() of exactly the orphaned paths.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

const mockServiceClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockServiceClient,
}));

import {
  GET,
  findOrphanPaths,
} from '@/app/api/cron/attachment-orphan-sweep/route';

const FORM_ID = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
const ENGAGEMENT_ID = 'c3d4e5f6-a7b8-4012-cdef-123456789012';

describe('findOrphanPaths', () => {
  it('returns listed paths with no matching expected path', () => {
    const result = findOrphanPaths(
      ['a/1.pdf', 'a/2.pdf', 'a/3.pdf'],
      new Set(['a/1.pdf', 'a/3.pdf']),
    );
    expect(result).toEqual(['a/2.pdf']);
  });

  it('returns an empty array when every listed path is expected', () => {
    expect(findOrphanPaths(['a/1.pdf'], new Set(['a/1.pdf']))).toEqual([]);
  });

  it('returns every listed path when nothing is expected (all rows cascade-deleted)', () => {
    expect(findOrphanPaths(['a/1.pdf', 'a/2.pdf'], new Set())).toEqual([
      'a/1.pdf',
      'a/2.pdf',
    ]);
  });

  it('returns an empty array when nothing is listed', () => {
    expect(findOrphanPaths([], new Set(['a/1.pdf']))).toEqual([]);
  });
});

describe('GET /api/cron/attachment-orphan-sweep', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    mockServiceClient.mockReturnValue(mockClient);
  });

  async function callRoute(cronSecret?: string, limit?: string) {
    const headers: Record<string, string> = {};
    if (cronSecret) headers.authorization = `Bearer ${cronSecret}`;
    const request = createTestRequest('/api/cron/attachment-orphan-sweep', {
      method: 'GET',
      headers,
      searchParams: limit ? { limit } : undefined,
    });
    return GET(request);
  }

  it('returns 401 when the cron secret is missing', async () => {
    const res = await callRoute();
    expect(res.status).toBe(401);
  });

  it('returns 401 when the cron secret is wrong', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const res = await callRoute('wrong-secret');
    expect(res.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('reconciles both scopes: removes an engagement-scoped and a form-scoped orphan, keeps referenced files', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');

    const listMock = vi.fn((path: string) => {
      if (path === 'engagement') {
        return Promise.resolve({
          data: [{ name: ENGAGEMENT_ID, id: null }],
          error: null,
        });
      }
      if (path === `engagement/${ENGAGEMENT_ID}`) {
        return Promise.resolve({
          data: [
            { name: 'keep-me.pdf', id: 'file-1' },
            { name: 'orphan.pdf', id: 'file-2' },
          ],
          error: null,
        });
      }
      if (path === `${FORM_ID}/attachments`) {
        return Promise.resolve({
          data: [{ name: 'orphan-form.pdf', id: 'file-3' }],
          error: null,
        });
      }
      return Promise.resolve({ data: [], error: null });
    });
    const removeMock = vi.fn().mockResolvedValue({ data: [], error: null });
    mockClient.storage.from.mockReturnValue({
      list: listMock,
      remove: removeMock,
    });

    // Call order (route is fully sequential, no concurrency):
    //   1. form_attachments rows for the engagement folder found above
    //   2. form_instances page (the form-scoped sweep's candidate list)
    //   3. form_attachments rows for that form
    mockClient._chain.then
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({
          data: [{ storage_path: `engagement/${ENGAGEMENT_ID}/keep-me.pdf` }],
          error: null,
        }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [{ id: FORM_ID }], error: null }),
      )
      .mockImplementationOnce((resolve: (v: unknown) => void) =>
        resolve({ data: [], error: null }),
      );

    const res = await callRoute('test-secret');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.engagement.removed).toBe(1);
    expect(body.form.removed).toBe(1);
    expect(body.form.formsScanned).toBe(1);

    expect(removeMock).toHaveBeenCalledWith([
      `engagement/${ENGAGEMENT_ID}/orphan.pdf`,
    ]);
    expect(removeMock).toHaveBeenCalledWith([
      `${FORM_ID}/attachments/orphan-form.pdf`,
    ]);
    // The referenced file must never be passed to remove().
    expect(removeMock).not.toHaveBeenCalledWith(
      expect.arrayContaining([`engagement/${ENGAGEMENT_ID}/keep-me.pdf`]),
    );

    vi.unstubAllEnvs();
  });

  it('respects the ?limit= query param for the form-scoped page size', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockClient.storage.from.mockReturnValue({
      list: vi.fn().mockResolvedValue({ data: [], error: null }),
      remove: vi.fn().mockResolvedValue({ data: [], error: null }),
    });
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );

    const res = await callRoute('test-secret', '50');
    expect(res.status).toBe(200);
    expect(mockClient._chain.limit).toHaveBeenCalledWith(50);

    vi.unstubAllEnvs();
  });
});
