// __tests__/api/cron/datapath-watch.test.ts
//
// Route-adapter tests for the {66.15} datapath monitor re-homed as a Vercel cron
// (S311). The PURE stall predicate (`detectStalls`) is exhaustively covered in
// `__tests__/deploy/onprem/monitor/datapath-watch.test.ts`; these tests cover the
// route wiring only — cron auth, the service-client read, and that an alerting
// row flows through the predicate into the response digest.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

const mockServiceClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockServiceClient,
}));

describe('GET /api/cron/datapath-watch', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    mockServiceClient.mockReturnValue(mockClient);
  });

  async function callRoute(cronSecret?: string) {
    const { GET } = await import('@/app/api/cron/datapath-watch/route');
    const headers = new Headers();
    if (cronSecret) {
      headers.set('authorization', `Bearer ${cronSecret}`);
    }
    const request = new Request('http://localhost/api/cron/datapath-watch', {
      headers,
    });
    return GET(request);
  }

  /** Point the awaited `from().select().gte().order()` chain at a fixed result. */
  function stubRows(result: { data: unknown; error: unknown }) {
    mockClient._chain.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve(result),
    );
  }

  it('returns 401 when the cron secret is missing', async () => {
    const response = await callRoute();
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe('Unauthorised');
  });

  it('returns 401 when the cron secret is wrong', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const response = await callRoute('wrong-secret');
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('returns 200 with zero alerts when there are no pipeline_runs rows', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    stubRows({ data: [], error: null });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.rowsScanned).toBe(0);
    expect(body.alertCount).toBe(0);

    vi.unstubAllEnvs();
  });

  it('surfaces a condition-B alert when a failed run is present', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    stubRows({
      data: [
        {
          pipeline_name: 'cocoindex',
          status: 'failed',
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          op_id: 'op-123',
          error_message: 'stage 3 boom',
        },
      ],
      error: null,
    });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.rowsScanned).toBe(1);
    expect(body.alertCount).toBe(1);
    expect(body.alerts[0].condition).toBe('B');

    vi.unstubAllEnvs();
  });

  it('returns 500 when the pipeline_runs read fails', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    stubRows({ data: null, error: { message: 'connection refused' } });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(500);
    expect((await response.json()).error).toContain('connection refused');

    vi.unstubAllEnvs();
  });
});
