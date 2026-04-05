// __tests__/api/intelligence-cleanup.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';

// Mock the service client
const mockServiceClient = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockServiceClient,
}));

describe('GET /api/cron/intelligence-cleanup', () => {
  let mockClient: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockSupabaseClient();
    mockServiceClient.mockReturnValue(mockClient);
  });

  async function callRoute(cronSecret?: string) {
    const { GET } = await import(
      '@/app/api/cron/intelligence-cleanup/route'
    );
    const headers = new Headers();
    if (cronSecret) {
      headers.set('authorization', `Bearer ${cronSecret}`);
    }
    const request = new Request('http://localhost/api/cron/intelligence-cleanup', {
      headers,
    });
    return GET(request);
  }

  it('returns 401 when cron secret is missing', async () => {
    const response = await callRoute();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe('Unauthorised');
  });

  it('returns 401 when cron secret is wrong', async () => {
    vi.stubEnv('CRON_SECRET', 'correct-secret');
    const response = await callRoute('wrong-secret');
    expect(response.status).toBe(401);
    vi.unstubAllEnvs();
  });

  it('calls cleanup_filtered_articles RPC and returns count', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockClient.rpc.mockResolvedValue({ data: 42, error: null });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.deletedCount).toBe(42);
    expect(mockClient.rpc).toHaveBeenCalledWith('cleanup_filtered_articles');

    vi.unstubAllEnvs();
  });

  it('returns 0 when no articles to clean up', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockClient.rpc.mockResolvedValue({ data: 0, error: null });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deletedCount).toBe(0);

    vi.unstubAllEnvs();
  });

  it('returns 500 when RPC fails', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockClient.rpc.mockResolvedValue({
      data: null,
      error: { message: 'Connection timeout' },
    });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('Connection timeout');

    vi.unstubAllEnvs();
  });

  it('handles null RPC data as 0 deleted', async () => {
    vi.stubEnv('CRON_SECRET', 'test-secret');
    mockClient.rpc.mockResolvedValue({ data: null, error: null });

    const response = await callRoute('test-secret');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.deletedCount).toBe(0);

    vi.unstubAllEnvs();
  });
});
