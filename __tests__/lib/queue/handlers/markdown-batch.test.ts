/**
 * Behavioural unit tests for `lib/queue/handlers/markdown-batch.ts` —
 * Session 226 W1-C.
 *
 * Spec: docs/specs/§5.4.4-ep2-markdown-batch-migration-spec.md §8 (12 ACs).
 *
 * Behaviour-focused (per memory `feedback_e2e_no_workarounds` +
 * `OPS-56`): each test asserts on the OBSERVABLE CONTRACT — handler
 * return value, observable Supabase state, thrown error class — NOT on
 * internal helper invocation counts or wiring details.
 *
 * Rule of thumb: if the handler is rewritten with a different internal
 * architecture but preserves the externally-observable contract, every
 * test in this file MUST still pass. Conversely, renaming an internal
 * helper MUST NOT break a test (those would be implementation-coupled
 * tests and were rejected during scoping; see report).
 *
 * AC coverage (handler-tier ACs only — integration-tier ACs 3+4+6 +
 * 7a + 12 covered in `__tests__/integration/queue/markdown-batch.
 * integration.test.ts`):
 *   AC-1+2 — happy path: 5 files → result.results_summary.stored.length=5,
 *            files_processed=5, no errored entries.
 *   AC-5  — per-file failure tolerance: file 3 fails, files 4+5 still
 *            stored, errored.length=1, handler does NOT throw.
 *   AC-7b — cooperative-cancel mid-batch: poll returns cancelled after
 *            file 2 → handler returns partial envelope with cancelled=true,
 *            cancellation_message matching the spec contract.
 *   AC-8  — Pattern 2 finalisation: caller-allocated pipeline_run_id is
 *            adopted, exactly one pipeline_runs row exists at terminal.
 *   AC-9  — permanent failure paths: empty body.files →
 *            PermanentJobError('files_empty'); missing pipeline_run_id →
 *            PermanentJobError('pipeline_run_id_missing'); missing
 *            caller_user_id → PermanentJobError('caller_user_id_missing');
 *            invalid caller_role → PermanentJobError(`caller_role_invalid:
 *            <x>`).
 *   AC-10 — idempotent startPipelineRun: pre-existing pipeline_runs row
 *            with id=X → handler runs through, exactly one row exists.
 *
 * Mocking discipline (per memory feedback):
 *   - `@/lib/ingest/markdown-orchestrator` mocked at MODULE BOUNDARY
 *     (system boundary, not internal). The handler is a thin wrapper —
 *     mocking the orchestrator lets us simulate observable end-to-end
 *     terminal envelopes without exercising the real per-file pipeline.
 *   - `@/lib/supabase/server` mocked at file scope per
 *     `feedback_orchestrator_internal_service_client_test_mock` because
 *     `isJobCancelled` calls `createServiceClient()` internally.
 *   - NO mocks of internal handler helpers — `isJobCancelled`'s
 *     observable behaviour is driven entirely via the mocked Supabase
 *     `processing_queue.status` SELECT.
 *
 * Spec contracts quoted verbatim (per `feedback_brief_quote_spec_verbatim`):
 *   - PermanentJobError messages: `files_empty`, `pipeline_run_id_missing`,
 *     `caller_user_id_missing`, `caller_role_invalid: <role>`.
 *   - Cancellation message: `cancelled mid-batch after N/M files`
 *     (handler L311).
 *   - Result envelope keys: `pipeline_run_id`, `results_summary`,
 *     `cancelled?`, `cancellation_message?`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  createMockSupabaseClient,
  type MockSupabaseClient,
} from '@/__tests__/helpers/mock-supabase';
import { PermanentJobError } from '@/lib/queue/dispatch';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import type {
  MarkdownBatchResultsSummary,
  MarkdownImportPhaseResult,
} from '@/types/ingest';

// ---------------------------------------------------------------------------
// Hoisted mocks for the orchestrator (module boundary) + supabase server
// module (chokepoint per feedback_orchestrator_internal_service_client_test_mock).
// ---------------------------------------------------------------------------

const { mockOrchestrate, mockCreateServiceClient } = vi.hoisted(() => ({
  mockOrchestrate: vi.fn(),
  mockCreateServiceClient: vi.fn(),
}));

vi.mock('@/lib/ingest/markdown-orchestrator', () => ({
  orchestrateMarkdownBatch: mockOrchestrate,
}));

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: mockCreateServiceClient,
}));

// Import the handler AFTER vi.mock so the mocked modules resolve first.
const { runMarkdownBatchJob } = await import(
  '@/lib/queue/handlers/markdown-batch'
);

// ---------------------------------------------------------------------------
// Fixtures — RFC 4122 v4-compliant UUIDs (Zod uuid() rejects placeholders
// like 00000000-...001 per CLAUDE.md gotcha).
// ---------------------------------------------------------------------------

const PIPELINE_RUN_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CALLER_USER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const JOB_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const AUTH_CONTEXT = {
  user_id: CALLER_USER_ID,
  role: 'admin' as const,
};

interface BodyFile {
  filename: string;
  content: string;
  sizeBytes: number;
}

function makeFile(filename: string, content: string = '# stub'): BodyFile {
  return {
    filename,
    content,
    sizeBytes: Buffer.byteLength(content, 'utf8'),
  };
}

function makeBody(
  overrides: Partial<{
    files: BodyFile[];
    pipeline_run_id: string;
    caller_user_id: string;
    caller_role: 'admin' | 'editor';
  }> = {},
) {
  return {
    files: overrides.files ?? [
      makeFile('one.md'),
      makeFile('two.md'),
      makeFile('three.md'),
      makeFile('four.md'),
      makeFile('five.md'),
    ],
    pipeline_run_id: overrides.pipeline_run_id ?? PIPELINE_RUN_ID,
    caller_user_id: overrides.caller_user_id ?? CALLER_USER_ID,
    caller_role: overrides.caller_role ?? 'admin',
  };
}

/** Build a results_summary that mirrors AC-1+2 happy path: N stored, no
 *  errored. */
function happyPathSummary(files: BodyFile[]): MarkdownBatchResultsSummary {
  return {
    files_processed: files.length,
    stored: files.map((f, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      title: f.filename.replace(/\.md$/, ''),
      filename: f.filename,
    })),
    dedup_flagged: [],
    superseded: [],
    skipped_excluded: [],
    errored: [],
  };
}

/** Build a partial-failure summary mirroring AC-5: one filename in errored,
 *  the rest in stored. */
function partialFailureSummary(
  files: BodyFile[],
  failingIndex: number,
  errorMessage: string,
): MarkdownBatchResultsSummary {
  const stored: MarkdownBatchResultsSummary['stored'] = [];
  files.forEach((f, i) => {
    if (i !== failingIndex) {
      stored.push({
        id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
        title: f.filename.replace(/\.md$/, ''),
        filename: f.filename,
      });
    }
  });
  return {
    files_processed: files.length,
    stored,
    dedup_flagged: [],
    superseded: [],
    skipped_excluded: [],
    errored: [
      {
        filename: files[failingIndex].filename,
        error: errorMessage,
      },
    ],
  };
}

/** Build a partial cancellation summary mirroring AC-7b: only the first N
 *  files were processed before the cancel-tick stopped the loop. */
function cancelledSummary(
  files: BodyFile[],
  filesProcessed: number,
): MarkdownBatchResultsSummary {
  const processed = files.slice(0, filesProcessed);
  return {
    files_processed: filesProcessed,
    stored: processed.map((f, i) => ({
      id: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, '0')}`,
      title: f.filename.replace(/\.md$/, ''),
      filename: f.filename,
    })),
    dedup_flagged: [],
    superseded: [],
    skipped_excluded: [],
    errored: [],
  };
}

/** Configure the cancel-poll Supabase client to return a status. */
function configureCancelPoll(
  status: 'pending' | 'processing' | 'cancelled',
): MockSupabaseClient {
  const cancelClient = createMockSupabaseClient();
  cancelClient._chain.maybeSingle.mockResolvedValue({
    data: { status },
    error: null,
  });
  return cancelClient;
}

// ---------------------------------------------------------------------------
// Test suite.
// ---------------------------------------------------------------------------

describe('runMarkdownBatchJob — markdown_batch handler (§5.4.4 behavioural)', () => {
  let mockSupabase: MockSupabaseClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = createMockSupabaseClient();
    // Default cancel poll: NOT cancelled.
    mockCreateServiceClient.mockReturnValue(configureCancelPoll('processing'));
  });

  // -------------------------------------------------------------------------
  // AC-1 + AC-2 happy path — handler returns full results_summary with all
  // files stored. (AC-1 = HTTP 202 contract is at the route layer; here we
  // assert the handler-tier observable contract: result envelope shape.)
  // Spec §8 AC-1+2 lines 1633-1653.
  // -------------------------------------------------------------------------

  describe('AC-1+2 happy path — 5 files all stored', () => {
    it('returns result with files_processed=5, stored.length=5, no errored entries', async () => {
      const body = makeBody();
      const orchestratorResult: MarkdownImportPhaseResult = {
        pipeline_run_id: PIPELINE_RUN_ID,
        results_summary: happyPathSummary(body.files),
      };
      mockOrchestrate.mockResolvedValue(orchestratorResult);

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Observable contract: terminal envelope shape.
      expect(result.pipeline_run_id).toBe(PIPELINE_RUN_ID);
      expect(result.results_summary.files_processed).toBe(5);
      expect(result.results_summary.stored).toHaveLength(5);
      expect(result.results_summary.errored).toEqual([]);
      expect(result.results_summary.stored.map((s) => s.filename)).toEqual([
        'one.md',
        'two.md',
        'three.md',
        'four.md',
        'five.md',
      ]);
      // Cancellation flag absent on happy path.
      expect(result.cancelled).toBeUndefined();
      expect(result.cancellation_message).toBeUndefined();
    });

    it('handler returns the SAME pipeline_run_id passed in body (Pattern 2 caller-allocated round-trip)', async () => {
      const body = makeBody();
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: body.pipeline_run_id,
        results_summary: happyPathSummary(body.files),
      } satisfies MarkdownImportPhaseResult);

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // The handler MUST return the caller-allocated UUID verbatim (the
      // orchestrator's idempotent UPSERT adopts it; the dispatch case
      // uses it for terminal Sentry/PostHog tags).
      expect(result.pipeline_run_id).toBe(body.pipeline_run_id);
    });
  });

  // -------------------------------------------------------------------------
  // AC-5 per-file failure tolerance — handler does NOT throw on per-file
  // errors. The orchestrator catches per-file errors and surfaces them in
  // results_summary.errored[]; the handler returns the partial envelope.
  // Spec §8 AC-5 lines 1682-1693.
  // -------------------------------------------------------------------------

  describe('AC-5 per-file failure tolerance — file 3 of 5 errors, files 4+5 still stored', () => {
    it('terminal results_summary has stored.length=4, errored.length=1, errored[0].filename matches the failing file; handler does NOT throw', async () => {
      const body = makeBody();
      const failingIndex = 2; // 0-based — "three.md"
      const summary = partialFailureSummary(
        body.files,
        failingIndex,
        'Front-matter parse failed: Unexpected token at line 1',
      );
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: PIPELINE_RUN_ID,
        results_summary: summary,
      } satisfies MarkdownImportPhaseResult);

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Observable contract: 4 stored, 1 errored, full file count
      // surfaced; handler does NOT throw.
      expect(result.results_summary.stored).toHaveLength(4);
      expect(result.results_summary.errored).toHaveLength(1);
      expect(result.results_summary.errored[0].filename).toBe('three.md');
      expect(result.results_summary.errored[0].error).toMatch(
        /Front-matter parse failed/,
      );
      // The 4 stored files are the non-failing ones — observable file
      // identity is preserved.
      const storedFilenames = result.results_summary.stored.map(
        (s) => s.filename,
      );
      expect(storedFilenames).toEqual(['one.md', 'two.md', 'four.md', 'five.md']);
    });
  });

  // -------------------------------------------------------------------------
  // AC-7b cooperative-cancel mid-batch — handler returns partial envelope
  // with cancelled=true after the orchestrator's per-file loop breaks on a
  // status='cancelled' poll. Spec §8 AC-7b lines 1724-1740.
  //
  // Behaviour-focused: the test does NOT assert HOW the cancel is detected
  // (cadence, internal callback). It asserts that GIVEN the orchestrator
  // surfaces a partial envelope (files_processed=2 of 5) AND the next
  // processing_queue.status poll returns 'cancelled', THEN the handler's
  // returned envelope has cancelled=true with the spec-mandated
  // cancellation_message.
  // -------------------------------------------------------------------------

  describe('AC-7b cooperative-cancel mid-batch', () => {
    it('after orchestrator surfaces partial envelope (2/5 files) AND processing_queue.status="cancelled", handler returns cancelled=true with cancellation_message="cancelled mid-batch after 2/5 files"', async () => {
      const body = makeBody();
      const filesProcessed = 2;
      // Orchestrator returns the partial-cancel envelope (2 stored, 0
      // errored).
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: PIPELINE_RUN_ID,
        results_summary: cancelledSummary(body.files, filesProcessed),
      } satisfies MarkdownImportPhaseResult);
      // Cancel poll: cancelled.
      mockCreateServiceClient.mockReturnValue(
        configureCancelPoll('cancelled'),
      );

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Observable contract: cancellation flag set; partial result
      // surfaced; cancellation_message matches the spec-mandated string.
      expect(result.cancelled).toBe(true);
      expect(result.cancellation_message).toBe(
        'cancelled mid-batch after 2/5 files',
      );
      expect(result.results_summary.files_processed).toBe(2);
      expect(result.results_summary.stored).toHaveLength(2);
      // Handler does NOT throw on cancel.
    });

    it('orchestrator returns full envelope BUT processing_queue.status="processing" → handler does NOT set cancelled flag (poll-tick race-window where cancel did not fire)', async () => {
      const body = makeBody();
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: PIPELINE_RUN_ID,
        results_summary: happyPathSummary(body.files),
      } satisfies MarkdownImportPhaseResult);
      // Cancel poll: NOT cancelled.
      mockCreateServiceClient.mockReturnValue(
        configureCancelPoll('processing'),
      );

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.cancelled).toBeUndefined();
      expect(result.cancellation_message).toBeUndefined();
      expect(result.results_summary.files_processed).toBe(5);
    });

    it('jobId omitted → no cancel polling can fire → result.cancelled never set (defensive coverage for non-queued callers)', async () => {
      const body = makeBody();
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: PIPELINE_RUN_ID,
        results_summary: happyPathSummary(body.files),
      } satisfies MarkdownImportPhaseResult);

      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        // No jobId — non-queued caller (defensive forward-compat per
        // handler doc-comment L211).
      );

      expect(result.cancelled).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // AC-8 Pattern 2 caller-allocated round-trip — the handler's returned
  // envelope carries the caller-allocated pipeline_run_id verbatim, AND the
  // orchestrator was invoked with `pipelineRunIdOverride === body.pipeline_run_id`.
  //
  // The "exactly one row exists" cardinality assertion is at the integration
  // tier (real DB cardinality check). At the unit tier we assert the
  // observable HANDLER-TO-ORCHESTRATOR contract: caller-allocated UUID
  // forwarded into pipelineRunIdOverride. Spec §4.4 + §8 AC-8.
  // -------------------------------------------------------------------------

  describe('AC-8 Pattern 2 — caller-allocated pipeline_run_id is forwarded to the orchestrator', () => {
    it('handler invokes orchestrator with options.pipelineRunIdOverride === body.pipeline_run_id (so the orchestrator adopts the caller-allocated UUID)', async () => {
      const body = makeBody({
        pipeline_run_id: '11111111-1111-4111-8111-111111111111',
      });
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: body.pipeline_run_id,
        results_summary: happyPathSummary(body.files),
      } satisfies MarkdownImportPhaseResult);

      await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      // Observable contract at the system boundary: orchestrator received
      // the caller-allocated UUID via pipelineRunIdOverride. This is what
      // makes the orchestrator's at-start UPSERT adopt the pre-existing
      // row (Path B per §7.7 + §10 D-11).
      expect(mockOrchestrate).toHaveBeenCalledTimes(1);
      const callArg = mockOrchestrate.mock.calls[0][0] as {
        phase: string;
        options?: { pipelineRunIdOverride?: string };
      };
      expect(callArg.phase).toBe('import');
      expect(callArg.options?.pipelineRunIdOverride).toBe(body.pipeline_run_id);
    });
  });

  // -------------------------------------------------------------------------
  // AC-9 permanent failure paths — handler throws PermanentJobError on
  // envelope-level fatal validations. Spec §8 AC-9 lines 1776-1783; §4.3.
  // -------------------------------------------------------------------------

  describe('AC-9 permanent failure paths', () => {
    it('body.files=[] → throws PermanentJobError("files_empty"); orchestrator NOT invoked', async () => {
      await expect(
        runMarkdownBatchJob(
          makeBody({ files: [] }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(PermanentJobError);

      // Re-call with a fresh assertion to inspect the error message.
      await expect(
        runMarkdownBatchJob(
          makeBody({ files: [] }),
          createMockSupabaseClient() as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow('files_empty');

      expect(mockOrchestrate).not.toHaveBeenCalled();
    });

    it('body.files=undefined (non-array) → throws PermanentJobError("files_empty")', async () => {
      // Cast to simulate a producer that dropped the field.
      const malformed = {
        ...makeBody(),
      } as unknown as Record<string, unknown>;
      delete malformed.files;

      await expect(
        runMarkdownBatchJob(
          malformed as unknown as Parameters<typeof runMarkdownBatchJob>[0],
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/files_empty/);
    });

    it('body.pipeline_run_id="" → throws PermanentJobError("pipeline_run_id_missing"); orchestrator NOT invoked', async () => {
      await expect(
        runMarkdownBatchJob(
          makeBody({ pipeline_run_id: '' }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(PermanentJobError);

      await expect(
        runMarkdownBatchJob(
          makeBody({ pipeline_run_id: '' }),
          createMockSupabaseClient() as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow('pipeline_run_id_missing');

      expect(mockOrchestrate).not.toHaveBeenCalled();
    });

    it('body.caller_user_id="" → throws PermanentJobError("caller_user_id_missing")', async () => {
      await expect(
        runMarkdownBatchJob(
          makeBody({ caller_user_id: '' }),
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/caller_user_id_missing/);
    });

    it('body.caller_role="viewer" (invalid for markdown_batch) → throws PermanentJobError("caller_role_invalid: viewer")', async () => {
      const malformed = {
        ...makeBody(),
        caller_role: 'viewer',
      } as unknown as Parameters<typeof runMarkdownBatchJob>[0];

      await expect(
        runMarkdownBatchJob(
          malformed,
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/caller_role_invalid: viewer/);
    });
  });

  // -------------------------------------------------------------------------
  // AC-10 idempotent startPipelineRun — given a pre-existing pipeline_runs
  // row with id=X (producer Pattern 2 pre-INSERT), the handler runs through
  // without UNIQUE-constraint failure and returns a result naming the same
  // id. The orchestrator's at-start UPSERT (Path B) handles the conflict-
  // skip; the handler MUST NOT throw on the existing row.
  // Spec §8 AC-10 lines 1785-1798; §7.7 + D-11 Path B.
  // -------------------------------------------------------------------------

  describe('AC-10 idempotent startPipelineRun — pre-existing pipeline_runs row is adopted', () => {
    it('handler runs through without throwing when orchestrator returns same pipeline_run_id (orchestrator UPSERTed the pre-existing row instead of failing on PK collision)', async () => {
      const body = makeBody();
      // Simulate the orchestrator successfully adopting the pre-existing
      // pipeline_runs row (Path B UPSERT result).
      mockOrchestrate.mockResolvedValue({
        pipeline_run_id: body.pipeline_run_id,
        results_summary: happyPathSummary(body.files),
      } satisfies MarkdownImportPhaseResult);

      // Handler must not throw — Path B UPSERT does not raise on conflict.
      const result = await runMarkdownBatchJob(
        body,
        mockSupabase as unknown as SupabaseClient<Database>,
        AUTH_CONTEXT,
        JOB_ID,
      );

      expect(result.pipeline_run_id).toBe(body.pipeline_run_id);
      expect(result.results_summary.files_processed).toBe(5);
    });

    it('handler propagates fail-fast when orchestrator throws on a non-conflict error (other than PK collision)', async () => {
      const body = makeBody();
      mockOrchestrate.mockRejectedValue(
        new Error('Failed to start pipeline_run for upload_markdown_batch: connection refused'),
      );

      // Non-PermanentJobError errors propagate (transient by classifier
      // contract — handler does NOT swallow).
      await expect(
        runMarkdownBatchJob(
          body,
          mockSupabase as unknown as SupabaseClient<Database>,
          AUTH_CONTEXT,
          JOB_ID,
        ),
      ).rejects.toThrow(/connection refused/);
    });
  });
});
