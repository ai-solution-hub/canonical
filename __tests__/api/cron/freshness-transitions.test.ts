// __tests__/api/cron/freshness-transitions.test.ts
//
// id-369 F5 (semantic): the governance bridge must report the PERSISTED
// state, not the intended one. A row whose `pending` write failed must not
// be counted in auto_governance_triggered and its reviewer must not be
// notified — otherwise the cron reports success for reviews that do not
// exist and sends reviewers to a queue the item is not in. A failed bulk
// notification insert must surface as a cron warning, never vanish.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/cron/freshness-transitions/route';
import { getUsersByRole } from '@/lib/cron-auth';
import {
  createBulkNotifications,
  getExistingNotificationIds,
} from '@/lib/notifications';
import { createServiceClient } from '@/lib/supabase/server';
import { createMockCronRequest } from '../../helpers/factories/cron-request';
import type { NextRequest } from 'next/server';

vi.mock('@/lib/cron-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/cron-auth')>();
  return { ...actual, getUsersByRole: vi.fn() };
});

vi.mock('@/lib/notifications', () => ({
  createBulkNotifications: vi.fn(),
  getExistingNotificationIds: vi.fn(),
}));

vi.mock('@/lib/pipeline/record-run', () => ({
  recordPipelineRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
}));

/** Chainable query stub: every builder method returns the chain; awaiting it
 * resolves `result`. `onEq` lets the governance UPDATE branch fail per-item. */
function queryChain(
  result: unknown,
  onEq?: (args: unknown[]) => unknown,
): Record<string, unknown> {
  const eqArgs: unknown[] = [];
  const chain: Record<string, unknown> = {};
  const self = vi.fn(() => chain);
  for (const m of ['select', 'neq', 'not', 'is', 'lte', 'lt', 'in', 'delete']) {
    chain[m] = self;
  }
  chain.eq = vi.fn((...args: unknown[]) => {
    eqArgs.push(...args);
    return chain;
  });
  chain.then = (
    resolve: (v: unknown) => unknown,
    reject: (e: unknown) => unknown,
  ) => {
    const value = onEq ? onEq(eqArgs) : result;
    return Promise.resolve(value).then(resolve, reject);
  };
  return chain;
}

/** Two unowned stale transitions in a domain whose governance_config has a
 * reviewer. doc-1's `pending` write is made to FAIL; doc-2's succeeds. */
function buildServiceClient(opts: { failPendingWriteFor: string[] }) {
  const transitionsRows = ['doc-1', 'doc-2'].map((id) => ({
    source_document_id: id,
    previous_freshness: 'aging',
    freshness: 'stale',
    lifecycle_type: 'policy',
    content_owner_id: null,
    governance_review_status: null,
    verified_at: null,
    source_documents: {
      id,
      filename: `${id}.pdf`,
      suggested_title: `Title ${id}`,
      primary_domain: 'procurement',
      updated_at: '2026-07-01T00:00:00Z',
    },
  }));

  return {
    from: vi.fn((table: string) => {
      if (table === 'governance_config') {
        return queryChain({
          data: [
            {
              id: 'gc-1',
              domain: 'procurement',
              auto_flag_on_freshness_transition: true,
              auto_flag_cooldown_days: 7,
              reviewer_id: 'reviewer-1',
              timeout_days: 7,
            },
          ],
          error: null,
        });
      }
      if (table === 'record_lifecycle') {
        return {
          select: vi.fn((cols: string) =>
            cols.includes('previous_freshness')
              ? queryChain({ data: transitionsRows, error: null })
              : queryChain({ data: [], error: null }),
          ),
          update: vi.fn(() =>
            queryChain(null, (eqArgs) => {
              const itemId = eqArgs[3] as string; // eq('owner_kind',...) then eq('source_document_id', id)
              return opts.failPendingWriteFor.includes(itemId)
                ? { error: { code: '42501', message: 'RLS denied' } }
                : { error: null };
            }),
          ),
        };
      }
      if (table === 'entity_mentions') {
        return queryChain({ data: [], error: null });
      }
      if (table === 'notifications') {
        return queryChain({ error: null });
      }
      throw new Error(`Unexpected table in test: ${table}`);
    }),
  };
}

type BulkPayload = Array<{ type: string; entityId: string; userId: string }>;

function governancePayloads(): BulkPayload {
  return vi
    .mocked(createBulkNotifications)
    .mock.calls.flatMap(([, rows]) => rows as unknown as BulkPayload)
    .filter((row) => row.type === 'governance_review_needed');
}

const cronRequest = () =>
  createMockCronRequest({
    path: '/api/cron/freshness-transitions',
  }) as unknown as NextRequest;

describe('GET /api/cron/freshness-transitions — governance bridge (id-369 F5)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
    vi.mocked(getUsersByRole).mockImplementation(async (_client, roles) =>
      roles.length === 1 && roles[0] === 'admin'
        ? ['admin-1']
        : ['admin-1', 'editor-1'],
    );
    vi.mocked(getExistingNotificationIds).mockResolvedValue(new Set());
    vi.mocked(createBulkNotifications).mockResolvedValue({
      count: 1,
      error: null,
    });
  });

  it('rejects requests without valid cron auth', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      buildServiceClient({ failPendingWriteFor: [] }) as never,
    );
    const response = await GET(
      createMockCronRequest({
        path: '/api/cron/freshness-transitions',
        secret: 'wrong-secret',
      }) as unknown as NextRequest,
    );
    expect(response.status).toBe(401);
  });

  it('counts and notifies ONLY items whose pending write persisted', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      buildServiceClient({ failPendingWriteFor: ['doc-1'] }) as never,
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    // Persisted count, not intended count: doc-1's write failed.
    expect(body.auto_governance_triggered).toBe(1);

    // The reviewer is notified about doc-2 only — never about the row that
    // was not set to pending.
    const gov = governancePayloads();
    expect(gov.length).toBeGreaterThan(0);
    expect(gov.every((n) => n.entityId === 'doc-2')).toBe(true);

    // The failure is visible: warning recorded, success false.
    expect(body.warnings).toEqual(
      expect.arrayContaining([expect.stringContaining('doc-1')]),
    );
    expect(body.success).toBe(false);
  });

  it('notifies NO reviewer when every pending write failed', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      buildServiceClient({ failPendingWriteFor: ['doc-1', 'doc-2'] }) as never,
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body.auto_governance_triggered).toBe(0);
    expect(governancePayloads()).toHaveLength(0);
    expect(body.success).toBe(false);
  });

  it('surfaces a failed bulk notification insert as a warning instead of swallowing it', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      buildServiceClient({ failPendingWriteFor: [] }) as never,
    );
    vi.mocked(createBulkNotifications).mockResolvedValue({
      count: 0,
      error: { code: '500', message: 'insert exploded' } as never,
    });

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body.notifications_created).toBe(0);
    expect(body.success).toBe(false);
    expect(body.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('notification insert failed'),
      ]),
    );
  });

  it('reports success with all writes and notifications landing', async () => {
    vi.mocked(createServiceClient).mockReturnValue(
      buildServiceClient({ failPendingWriteFor: [] }) as never,
    );

    const response = await GET(cronRequest());
    const body = await response.json();

    expect(body.success).toBe(true);
    expect(body.auto_governance_triggered).toBe(2);
    const gov = governancePayloads();
    expect(gov.map((n) => n.entityId).sort()).toEqual(['doc-1', 'doc-2']);
  });
});
