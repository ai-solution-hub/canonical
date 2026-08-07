// __tests__/api/cron/intelligence-poll.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/cron/intelligence-poll/route';

vi.mock('@/lib/intelligence/pipeline', () => ({
  runPipeline: vi.fn().mockResolvedValue({
    runId: 'test-run',
    startedAt: '2026-04-01T10:00:00Z',
    completedAt: '2026-04-01T10:01:00Z',
    sourcesProcessed: 2,
    totalArticlesFound: 10,
    totalArticlesNew: 5,
    totalArticlesPassed: 3,
    feedResults: [],
    errors: [],
  }),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn().mockReturnValue({}),
}));

describe('GET /api/cron/intelligence-poll', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-secret';
  });

  it('rejects requests without valid auth', async () => {
    const request = new Request('http://localhost/api/cron/intelligence-poll', {
      headers: { authorization: 'Bearer wrong-secret' },
    });
    const response = await GET(request);
    expect(response.status).toBe(401);
  });

  it('accepts requests with valid CRON_SECRET', async () => {
    const request = new Request('http://localhost/api/cron/intelligence-poll', {
      headers: { authorization: 'Bearer test-secret' },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.sourcesProcessed).toBe(2);
  });
});
