/**
 * Tests for `lib/pipeline/start-run.ts`.
 *
 * S212 W2 (Pattern E retrofit): the at-start INSERT helper is the FAIL-FAST
 * surface of the lifecycle (mid-flight UPDATEs are silent-catch; terminal
 * UPDATE is also fail-fast). Tests assert:
 *   1. INSERT carries pipeline_name + status='running' + started_at + the
 *      caller-supplied progress JSONB.
 *   2. Adopts caller-supplied UUID verbatim when provided (Pattern E
 *      client-UUID flow).
 *   3. Reads back the DB-generated id when no UUID is supplied.
 *   4. THROWS on insert failure (NOT silent-catch) and emits a Sentry error.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Sentry BEFORE importing the module under test.
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
}));

// Mock the service client factory so we control its return value per-test.
const { mockServiceClient, createServiceClientMock } = vi.hoisted(() => {
  return {
    mockServiceClient: { from: vi.fn() },
    createServiceClientMock: vi.fn(),
  };
});

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: createServiceClientMock,
}));

import * as Sentry from '@sentry/nextjs';
import { startPipelineRun } from '@/lib/pipeline/start-run';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

interface InsertResult {
  data: { id: string } | null;
  error: { message: string } | null;
}

/**
 * Build a chain that resolves
 * `from('pipeline_runs').insert(...).select('id').single()` with the
 * supplied result. Returns the spies so tests can assert on them.
 */
function configureChain(result: InsertResult) {
  const single = vi.fn().mockResolvedValue(result);
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  const from = vi.fn(() => ({ insert }));
  mockServiceClient.from = from;
  createServiceClientMock.mockReturnValue(mockServiceClient);
  return { from, insert, select, single };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('startPipelineRun', () => {
  it('INSERTs a pipeline_runs row with status=running + the supplied progress JSONB', async () => {
    const chain = configureChain({
      data: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
      error: null,
    });

    await startPipelineRun({
      pipelineName: 'upload_markdown_batch',
      createdBy: 'user-uuid-1',
      progress: {
        step: 'starting',
        files_completed: 0,
        files_total: 5,
        detail: 'Beginning batch import (5 files)…',
      },
    });

    expect(chain.from).toHaveBeenCalledWith('pipeline_runs');
    expect(chain.insert).toHaveBeenCalledTimes(1);
    const payload = (chain.insert.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.pipeline_name).toBe('upload_markdown_batch');
    expect(payload.status).toBe('running');
    expect(payload.created_by).toBe('user-uuid-1');
    expect(payload.items_created).toEqual([]);
    expect(typeof payload.started_at).toBe('string');
    expect(payload.progress).toMatchObject({
      step: 'starting',
      files_completed: 0,
      files_total: 5,
      detail: 'Beginning batch import (5 files)…',
    });
    expect(chain.select).toHaveBeenCalledWith('id');
  });

  it('adopts caller-supplied UUID verbatim (Pattern E client-UUID flow)', async () => {
    const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const chain = configureChain({
      data: { id: clientId },
      error: null,
    });

    const returnedId = await startPipelineRun({
      id: clientId,
      pipelineName: 'upload_markdown_batch',
      createdBy: 'user-uuid-1',
      progress: { step: 'starting', detail: 'go' },
    });

    expect(returnedId).toBe(clientId);
    const payload = (chain.insert.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.id).toBe(clientId);
  });

  it('omits the id field when not supplied (so DB column DEFAULT generates)', async () => {
    const chain = configureChain({
      data: { id: 'db-generated-id' },
      error: null,
    });

    const returnedId = await startPipelineRun({
      pipelineName: 'upload_markdown_batch',
      createdBy: 'user-uuid-1',
      progress: { step: 'starting', detail: 'go' },
    });

    expect(returnedId).toBe('db-generated-id');
    const payload = (chain.insert.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty('id');
  });

  it('THROWS on insert failure and emits a Sentry error', async () => {
    configureChain({
      data: null,
      error: { message: 'connection refused' },
    });

    await expect(
      startPipelineRun({
        pipelineName: 'upload_markdown_batch',
        createdBy: 'user-uuid-1',
        progress: { step: 'starting', detail: 'go' },
      }),
    ).rejects.toThrow(/Failed to start pipeline_run for upload_markdown_batch/);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining(
        'startPipelineRun failed for upload_markdown_batch',
      ),
      expect.objectContaining({ level: 'error' }),
    );
  });

  it('propagates source_filename when supplied (EP3 single-file uses)', async () => {
    const chain = configureChain({
      data: { id: 'abc' },
      error: null,
    });

    await startPipelineRun({
      pipelineName: 'file_upload',
      createdBy: 'user-uuid-1',
      sourceFilename: 'capability.docx',
      progress: { step: 'uploading', detail: 'go' },
    });

    const payload = (chain.insert.mock.calls[0] as unknown[])[0] as Record<
      string,
      unknown
    >;
    expect(payload.source_filename).toBe('capability.docx');
  });
});
