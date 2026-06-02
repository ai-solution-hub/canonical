/**
 * Unit tests for the EP2 §1.11 markdown-batch orchestrator.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3
 * Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T3)
 *
 * S212 W2 (Pattern E retrofit): the orchestrator now writes the
 * pipeline_runs row in three operations:
 *   1. AT-START INSERT  via @/lib/pipeline/start-run         (mocked here)
 *   2. MID-FLIGHT UPDATE via @/lib/pipeline/update-progress  (mocked here)
 *   3. TERMINAL UPDATE   via supabase .update().eq().select  (real chain)
 *
 * Tests assert all three boundaries to lock in the lifecycle contract.
 *
 * Sibling W1-T1 ships the extraction helpers; until that merges, those
 * helpers do not exist, so we mock them by path. The mock signatures here
 * MUST track spec §3.4 — corpus drift between this mock and the real T1
 * helpers will be caught at the W2 verifier full-suite run.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

// ────────────────────────────────────────────────────────────────────────
// Module mocks (T1 + downstream stages). Using vi.hoisted() pattern so the
// mock variables are available at module-mock evaluation time.
// ────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  parseMarkdownFrontMatter: vi.fn(),
  extractMarkdownTitle: vi.fn(),
  cleanMdxTags: vi.fn(),
  detectDiffMarkers: vi.fn(),
  checkExactDuplicate: vi.fn(),
  resolveDedupStamp: vi.fn(),
  normaliseTextForHash: vi.fn(),
  resolveContentOwnerId: vi.fn(),
  classifyContent: vi.fn(),
  generateEmbedding: vi.fn(),
  sentryCaptureMessage: vi.fn(),
  // S212 W2 Pattern E lifecycle helpers — mocked so the orchestrator
  // can be unit-tested without touching the createServiceClient() service
  // role or the real Supabase client.
  startPipelineRun: vi.fn(),
  updatePipelineProgress: vi.fn(),
}));

vi.mock('@/lib/extraction/markdown-front-matter', () => ({
  parseMarkdownFrontMatter: mocks.parseMarkdownFrontMatter,
}));
vi.mock('@/lib/extraction/markdown-title', () => ({
  extractMarkdownTitle: mocks.extractMarkdownTitle,
}));
vi.mock('@/lib/extraction/clean-mdx-tags', () => ({
  cleanMdxTags: mocks.cleanMdxTags,
}));
vi.mock('@/lib/extraction/diff-markers', () => ({
  detectDiffMarkers: mocks.detectDiffMarkers,
}));

vi.mock('@/lib/dedup', () => ({
  checkExactDuplicate: mocks.checkExactDuplicate,
  resolveDedupStamp: mocks.resolveDedupStamp,
  normaliseTextForHash: mocks.normaliseTextForHash,
}));

vi.mock('@/lib/auth/owner-default', () => ({
  resolveContentOwnerId: mocks.resolveContentOwnerId,
}));

vi.mock('@/lib/ai/classify', () => ({
  classifyContent: mocks.classifyContent,
}));
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: mocks.generateEmbedding,
  };
});
vi.mock('@sentry/nextjs', () => ({
  captureMessage: mocks.sentryCaptureMessage,
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: { setContext: () => void }) => void) =>
    fn({ setContext: () => undefined }),
  ),
}));

vi.mock('@/lib/pipeline/start-run', () => ({
  startPipelineRun: mocks.startPipelineRun,
}));
vi.mock('@/lib/pipeline/update-progress', () => ({
  updatePipelineProgress: mocks.updatePipelineProgress,
}));

// S213 W4-fix: finaliseRun now creates its own service-role client internally
// (see lib/ingest/markdown-orchestrator.ts:finaliseRun + V_W4 verdict). Mock
// createServiceClient at file scope so the import-phase tests can wire it to
// the same per-test client that holds the chain mocks for content_items
// inserts + pipeline_runs UPDATE.
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: vi.fn(),
  createClient: vi.fn(),
}));

// Import the orchestrator AFTER mocks are registered.
import { orchestrateMarkdownBatch } from '@/lib/ingest/markdown-orchestrator';
import { createServiceClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const ADMIN_USER_ID = 'b1234567-1234-4abc-8def-000000000001';
const SERVICE_ACCOUNT_UUID = 'a0000000-0000-4000-8000-000000000001';

/**
 * Configure all T1 / downstream mocks with sensible defaults so individual
 * tests only override the bits they care about.
 */
function setDefaultMocks() {
  mocks.parseMarkdownFrontMatter.mockImplementation((content: string) => ({
    frontMatter: null,
    body: content,
  }));
  mocks.extractMarkdownTitle.mockImplementation(
    ({ filename }: { filename: string }) => ({
      title: filename.replace(/\.md$/i, ''),
      provenance: 'filename' as const,
    }),
  );
  mocks.cleanMdxTags.mockImplementation((content: string) => content);
  mocks.detectDiffMarkers.mockReturnValue({
    gitConflictCount: 0,
    plusMinusLineCount: 0,
    warning: false,
  });
  mocks.checkExactDuplicate.mockResolvedValue({ isDuplicate: false });
  mocks.resolveDedupStamp.mockReturnValue({ dedup_status: 'clean' });
  mocks.normaliseTextForHash.mockImplementation((text: string) =>
    text.toLowerCase().trim(),
  );
  mocks.resolveContentOwnerId.mockImplementation(
    ({ userId }: { userId: string }) => userId,
  );
  mocks.classifyContent.mockResolvedValue({
    primary_domain: 'general',
    primary_subtopic: 'general',
    classification_confidence: 0.9,
    classification_reasoning: 'mock',
  });
  mocks.generateEmbedding.mockResolvedValue(new Array(1024).fill(0.01));
  // Pattern E (S212 W2): startPipelineRun returns the id the caller
  // supplied (mirrors the real DB-adopt flow). updatePipelineProgress is
  // a silent-catch helper; default to a resolved-undefined for tests.
  mocks.startPipelineRun.mockImplementation(
    async (params: { id?: string }) => params.id ?? 'generated-fallback-id',
  );
  mocks.updatePipelineProgress.mockResolvedValue(undefined);
}

/**
 * Build a mock Supabase client wired so that the chain `.insert(...).select().single()`
 * returns a unique generated id on each call. Use this when the test needs
 * multiple successful content_items inserts in one orchestrator run.
 */
function buildSupabaseWithSequentialInserts(
  ids: string[],
  options: { sourceFileMatch?: { id: string; title: string } | null } = {},
) {
  const client = createMockSupabaseClient();
  // Each call to .from() returns a fresh chain so inserts and reads can be
  // distinguished. We build one chain per logical operation and queue them.
  const mock = client._chain;

  // Fallback for analyse-phase source_file lookups: return null match by default.
  mock.maybeSingle.mockResolvedValue({
    data: options.sourceFileMatch ?? null,
    error: null,
  });

  // For each id, queue one .single() resolution that the content_items
  // insert path will consume. The same chain is reused so we use
  // mockResolvedValueOnce to enforce sequencing.
  for (const id of ids) {
    mock.single.mockResolvedValueOnce({
      data: { id, title: `Item ${id}` },
      error: null,
    });
  }

  // The pipeline_runs INSERT terminator is `.select('id')` (no .single()). That
  // resolves through the awaitable chain (`.then`). Default-empty ok response.
  mock.then.mockImplementation((resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null, count: 0 }),
  );

  // S213 W4-fix: route finaliseRun's internal createServiceClient() call to the
  // same per-test client so the terminal pipeline_runs UPDATE resolves through
  // the same chain mocks. Without this, finaliseRun throws when reading
  // serverEnv.SUPABASE_SERVICE_ROLE_KEY in jsdom env.
  vi.mocked(createServiceClient).mockReturnValue(
    client as unknown as ReturnType<typeof createServiceClient>,
  );

  return client;
}

// ────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────

describe('orchestrateMarkdownBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setDefaultMocks();
  });

  // ────────── Phase 1: analyse ──────────

  describe('phase: analyse — clean files', () => {
    it('returns one analysis per file with NO db writes', async () => {
      const supabase = createMockSupabaseClient();
      // source_file lookup → null
      supabase._chain.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await orchestrateMarkdownBatch({
        phase: 'analyse',
        files: [
          { filename: 'foo.md', content: '# Foo\n\nbody', sizeBytes: 12 },
          { filename: 'bar.md', content: '# Bar\n\nbody', sizeBytes: 12 },
        ],
        supabase: supabase as unknown as SupabaseClient<Database>,
      });

      expect(result.analysis).toHaveLength(2);
      expect(result.analysis[0].filename).toBe('foo.md');
      expect(result.analysis[0].title).toBe('foo');
      expect(result.analysis[0].titleProvenance).toBe('filename');
      expect(result.analysis[0].dedupVerdict.isDuplicate).toBe(false);
      expect(result.analysis[0].sourceFileMatch).toBeNull();
      expect(result.analysis[0].hasConflictMarkers).toBe(false);
      expect(result.analysis[0].diffMarkers.warning).toBe(false);
      // Critical: no insert / no rpc — pure read-only.
      expect(supabase._chain.insert).not.toHaveBeenCalled();
      expect(supabase.rpc).not.toHaveBeenCalled();
    });
  });

  describe('phase: analyse — conflict markers detected', () => {
    it('flags conflict-marker warning without auto-excluding the file', async () => {
      mocks.detectDiffMarkers.mockReturnValue({
        gitConflictCount: 3,
        plusMinusLineCount: 0,
        warning: true,
      });
      const supabase = createMockSupabaseClient();
      supabase._chain.maybeSingle.mockResolvedValue({
        data: null,
        error: null,
      });

      const result = await orchestrateMarkdownBatch({
        phase: 'analyse',
        files: [
          {
            filename: 'conflict.md',
            content: '<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n',
          },
        ],
        supabase: supabase as unknown as SupabaseClient<Database>,
      });

      expect(result.analysis[0].hasConflictMarkers).toBe(true);
      expect(result.analysis[0].diffMarkers.gitConflictCount).toBe(3);
      // Auto-exclude is the route/UI's call (per spec §4.3 warn-only); the
      // orchestrator just surfaces the flag in the analysis row.
      expect(result.analysis[0].empty).toBe(false);
    });
  });

  describe('phase: analyse — existing dedup hit', () => {
    it('reports content_hash_match in dedupVerdict when the dedup gate fires', async () => {
      mocks.checkExactDuplicate.mockResolvedValue({
        isDuplicate: true,
        existingId: 'existing-uuid-1',
        existingTitle: 'Existing Foo',
      });
      const supabase = createMockSupabaseClient();
      supabase._chain.maybeSingle.mockResolvedValue({
        data: { id: 'existing-uuid-1', title: 'Existing Foo' },
        error: null,
      });

      const result = await orchestrateMarkdownBatch({
        phase: 'analyse',
        files: [{ filename: 'foo.md', content: '# Foo\n\ndup body' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
      });

      expect(result.analysis[0].dedupVerdict.isDuplicate).toBe(true);
      expect(result.analysis[0].dedupVerdict.existingId).toBe(
        'existing-uuid-1',
      );
      expect(result.analysis[0].sourceFileMatch).toEqual({
        id: 'existing-uuid-1',
        title: 'Existing Foo',
      });
    });
  });

  // ────────── Phase 2: import ──────────

  describe('phase: import — full pipeline success', () => {
    it('runs Pattern E lifecycle: at-start INSERT → mid-flight UPDATE → terminal UPDATE; inserts content_items with ingest_source=upload + publication_status; classifies, embeds', async () => {
      const supabase = buildSupabaseWithSequentialInserts(['new-id-1']);

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [
          {
            filename: 'foo-final.md',
            content: '# Foo Final\n\nbody',
            sizeBytes: 20,
          },
        ],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
        options: { perFileOverrides: [] },
      });

      // ─── Pattern E Step 1: AT-START INSERT ────────────────────────────
      // The orchestrator generates a pipelineRunId locally when
      // pipelineRunIdOverride is absent, then calls startPipelineRun with it.
      expect(mocks.startPipelineRun).toHaveBeenCalledTimes(1);
      const startCall = mocks.startPipelineRun.mock.calls[0][0] as {
        id: string;
        pipelineName: string;
        createdBy: string;
        progress: Record<string, unknown>;
      };
      expect(startCall.pipelineName).toBe('upload_markdown_batch');
      expect(startCall.createdBy).toBe(ADMIN_USER_ID);
      expect(startCall.id).toBe(result.pipeline_run_id);
      expect(startCall.progress.step).toBe('starting');
      expect(startCall.progress.files_total).toBe(1);
      expect(startCall.progress.files_completed).toBe(0);

      // ─── Pattern E Step 2: MID-FLIGHT UPDATE (per file) ──────────────
      // 1 file → exactly 1 mid-flight progress update at the file boundary.
      expect(mocks.updatePipelineProgress).toHaveBeenCalledTimes(1);
      const midFlightCall = mocks.updatePipelineProgress.mock.calls[0];
      expect(midFlightCall[0]).toBe(result.pipeline_run_id);
      const midFlightUpdate = midFlightCall[1] as Record<string, unknown>;
      expect(midFlightUpdate.step).toBe('importing');
      expect(midFlightUpdate.files_total).toBe(1);
      expect(midFlightUpdate.files_completed).toBe(1);

      // Verify the per-file pipeline ran in the documented order.
      expect(mocks.classifyContent).toHaveBeenCalledTimes(1);
      expect(mocks.classifyContent).toHaveBeenCalledWith({
        supabase,
        itemId: 'new-id-1',
        force: true,
        userId: SERVICE_ACCOUNT_UUID,
      });
      expect(mocks.generateEmbedding).toHaveBeenCalledTimes(1);
      // ID-56.11: app-side regenerateChunks removed from the markdown-batch
      // import path — cocoindex re-ingests the corpus natively. No chunk-call
      // assertion remains.

      // content_items insert payload — verify required columns are set.
      const insertCalls = supabase._chain.insert.mock.calls;
      const contentItemsInsertCall = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          'ingest_source' in (call[0] as Record<string, unknown>),
      );
      expect(contentItemsInsertCall).toBeDefined();
      const payload = contentItemsInsertCall![0] as Record<string, unknown>;
      // G17 — ingest_source: 'upload'
      expect(payload.ingest_source).toBe('upload');
      // D-A guard — publication_status set explicitly (not relying on DEFAULT).
      // 'final' filename heuristic → 'in_review'.
      expect(payload.publication_status).toBe('in_review');
      // G3 — content_text_hash MUST be omitted (GENERATED ALWAYS).
      expect(payload).not.toHaveProperty('content_text_hash');
      expect(payload.content_owner_id).toBe(ADMIN_USER_ID);
      expect(payload.platform).toBe('manual');
      expect(payload.source_file).toBe('foo-final.md');
      expect(payload.dedup_status).toBe('clean');
      // Spec §3.4.1 — metadata.ingestion_source recorded as 'upload'.
      expect(
        (payload.metadata as Record<string, unknown>).ingestion_source,
      ).toBe('upload');

      // ─── Pattern E Step 3: TERMINAL UPDATE ────────────────────────────
      // pipeline_runs row finalised with status='completed' via .update().
      // No pipeline_runs INSERT should appear under the new lifecycle —
      // startPipelineRun is mocked, so the only `insert` calls are
      // content_items rows.
      const pipelineRunInsertCall = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).pipeline_name ===
            'upload_markdown_batch',
      );
      expect(pipelineRunInsertCall).toBeUndefined();

      const updateCalls = supabase._chain.update.mock.calls;
      const pipelineRunUpdateCall = updateCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).status === 'completed' &&
          'items_processed' in (call[0] as Record<string, unknown>),
      );
      expect(pipelineRunUpdateCall).toBeDefined();
      const runPayload = pipelineRunUpdateCall![0] as Record<string, unknown>;
      expect(runPayload.status).toBe('completed');
      expect(runPayload.items_created).toEqual(['new-id-1']);
      expect(runPayload.items_processed).toBe(1);
      expect(runPayload.error_message).toBeNull();
      expect(runPayload.result).toMatchObject({
        files_processed: 1,
        stored: [
          expect.objectContaining({
            id: 'new-id-1',
            filename: 'foo-final.md',
          }),
        ],
        errored: [],
        skipped_excluded: [],
      });

      // Spec §5.4 rich shape contract.
      expect(result.results_summary.files_processed).toBe(1);
      expect(result.results_summary.stored).toEqual([
        { id: 'new-id-1', title: 'Item new-id-1', filename: 'foo-final.md' },
      ]);
      expect(result.results_summary.dedup_flagged).toEqual([]);
      expect(result.results_summary.superseded).toEqual([]);
      expect(result.results_summary.skipped_excluded).toEqual([]);
      expect(result.results_summary.errored).toEqual([]);
      expect(result.pipeline_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('adopts client-supplied pipelineRunIdOverride verbatim (Pattern E client-UUID flow)', async () => {
      const supabase = buildSupabaseWithSequentialInserts(['new-id-1']);
      const clientId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [{ filename: 'foo.md', content: '# Foo' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
        options: { pipelineRunIdOverride: clientId },
      });

      // The orchestrator forwarded the client-supplied id verbatim.
      const startCall = mocks.startPipelineRun.mock.calls[0][0] as {
        id: string;
      };
      expect(startCall.id).toBe(clientId);
      expect(result.pipeline_run_id).toBe(clientId);
    });
  });

  describe('phase: import — partial failure (status=completed_with_errors)', () => {
    it('records one created + one failed and writes status=completed_with_errors', async () => {
      // First file succeeds; second file fails at classification.
      const supabase = buildSupabaseWithSequentialInserts(['ok-id', 'fail-id']);

      // Make the second classifyContent call throw — first call succeeds.
      let classifyCallCount = 0;
      mocks.classifyContent.mockImplementation(async () => {
        classifyCallCount += 1;
        if (classifyCallCount === 2) {
          throw new Error('Classifier upstream timeout');
        }
        return {
          primary_domain: 'general',
          primary_subtopic: 'general',
          classification_confidence: 0.9,
          classification_reasoning: 'mock',
        };
      });

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [
          { filename: 'good.md', content: '# Good' },
          { filename: 'bad.md', content: '# Bad' },
        ],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
      });

      expect(result.results_summary.files_processed).toBe(2);
      expect(result.results_summary.stored).toEqual([
        { id: 'ok-id', title: 'Item ok-id', filename: 'good.md' },
      ]);
      expect(result.results_summary.errored).toEqual([
        { filename: 'bad.md', error: 'Classifier upstream timeout' },
      ]);
      expect(result.results_summary.skipped_excluded).toEqual([]);
      expect(result.results_summary.superseded).toEqual([]);

      // pipeline_runs.status === 'completed_with_errors' (terminal UPDATE).
      const updateCalls = supabase._chain.update.mock.calls;
      const runPayload = updateCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).status ===
            'completed_with_errors',
      )?.[0] as Record<string, unknown> | undefined;
      expect(runPayload).toBeDefined();
      expect(runPayload!.status).toBe('completed_with_errors');
      expect(runPayload!.error_message).toBe('1/2 files failed');
      expect(runPayload!.items_created).toEqual(['ok-id']);

      // Sentry warning emitted (NOT error) for completed_with_errors.
      expect(mocks.sentryCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining('completed_with_errors'),
        expect.objectContaining({ level: 'warning' }),
      );
    });
  });

  describe('phase: import — pipeline_runs records correct status enum', () => {
    it('writes status=failed when zero files succeed', async () => {
      const supabase = buildSupabaseWithSequentialInserts(['will-fail']);
      mocks.classifyContent.mockRejectedValue(new Error('Classifier offline'));

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [{ filename: 'lonely.md', content: '# Lonely' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
      });

      expect(result.results_summary.files_processed).toBe(1);
      expect(result.results_summary.stored).toEqual([]);
      expect(result.results_summary.errored).toEqual([
        { filename: 'lonely.md', error: 'Classifier offline' },
      ]);

      const updateCalls = supabase._chain.update.mock.calls;
      const runPayload = updateCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).status === 'failed',
      )?.[0] as Record<string, unknown> | undefined;
      expect(runPayload).toBeDefined();
      expect(runPayload!.status).toBe('failed');
      expect(runPayload!.items_created).toEqual([]);

      // Sentry error level for status='failed'.
      expect(mocks.sentryCaptureMessage).toHaveBeenCalledWith(
        expect.stringContaining('failed'),
        expect.objectContaining({ level: 'error' }),
      );
    });
  });

  // ────────── Additional acceptance: dedup soft-block + role gating ──────────

  describe('phase: import — dedup soft-block stamps suspected_duplicate', () => {
    it('non-admin caller cannot bypass dedup; suspected_duplicate stamped on insert', async () => {
      mocks.checkExactDuplicate.mockResolvedValue({
        isDuplicate: true,
        existingId: 'existing-id',
        existingTitle: 'Existing',
      });
      mocks.resolveDedupStamp.mockReturnValue({
        dedup_status: 'suspected_duplicate',
        suspected_duplicate_of: 'existing-id',
      });

      const supabase = buildSupabaseWithSequentialInserts(['new-id']);

      await orchestrateMarkdownBatch({
        phase: 'import',
        files: [{ filename: 'dup.md', content: '# Dup' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'editor',
        // editor passes skipDedup but it MUST be silently ignored.
        options: {
          perFileOverrides: [{ filename: 'dup.md', skipDedup: true }],
        },
      });

      // resolveDedupStamp was called with skipDedup=false (editor cannot bypass).
      expect(mocks.resolveDedupStamp).toHaveBeenCalledWith('existing-id', {
        skipDedup: false,
      });

      // The content_items insert payload carries the soft-block stamp.
      const ciInsert = supabase._chain.insert.mock.calls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          'ingest_source' in (call[0] as Record<string, unknown>),
      );
      const payload = ciInsert![0] as Record<string, unknown>;
      expect(payload.dedup_status).toBe('suspected_duplicate');
      expect(
        (payload.metadata as Record<string, unknown>).suspected_duplicate_of,
      ).toBe('existing-id');
    });
  });

  describe('phase: import — per-file exclusion is reported in skipped[]', () => {
    it('does not insert when override.excluded=true; lists in skipped', async () => {
      const supabase = buildSupabaseWithSequentialInserts([]);

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [{ filename: 'skip.md', content: '# Skip' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
        options: {
          perFileOverrides: [{ filename: 'skip.md', excluded: true }],
        },
      });

      expect(result.results_summary.files_processed).toBe(1);
      expect(result.results_summary.skipped_excluded).toEqual(['skip.md']);
      expect(result.results_summary.stored).toEqual([]);
      expect(result.results_summary.errored).toEqual([]);

      // No content_items insert.
      const insertCalls = supabase._chain.insert.mock.calls;
      const ciInsert = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          'ingest_source' in (call[0] as Record<string, unknown>),
      );
      expect(ciInsert).toBeUndefined();

      // pipeline_runs row still finalised with status='completed' via
      // the terminal UPDATE — at-start INSERT happens via the mocked
      // startPipelineRun helper.
      const updateCalls = supabase._chain.update.mock.calls;
      const runPayload = updateCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).status === 'completed' &&
          'items_processed' in (call[0] as Record<string, unknown>),
      )?.[0] as Record<string, unknown> | undefined;
      expect(runPayload).toBeDefined();
      expect(runPayload!.status).toBe('completed');
      expect(runPayload!.items_processed).toBe(0);

      // Mid-flight UPDATE still emitted for the excluded file (so the
      // polling UI surfaces "Skipped foo.md (excluded by user)" detail).
      expect(mocks.updatePipelineProgress).toHaveBeenCalled();
    });
  });
});
