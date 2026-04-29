/**
 * Unit tests for the EP2 §1.11 markdown-batch orchestrator.
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md v1.3
 * Plan: docs/plans/§1.11-ep2-build-plan.md (EP2-T3)
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
  regenerateChunks: vi.fn(),
  sentryCaptureMessage: vi.fn(),
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
vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: mocks.generateEmbedding,
}));
vi.mock('@/lib/content/chunk-store', () => ({
  regenerateChunks: mocks.regenerateChunks,
}));

vi.mock('@sentry/nextjs', () => ({
  captureMessage: mocks.sentryCaptureMessage,
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(),
  withScope: vi.fn((fn: (s: { setContext: () => void }) => void) =>
    fn({ setContext: () => undefined }),
  ),
}));

// Import the orchestrator AFTER mocks are registered.
import { orchestrateMarkdownBatch } from '@/lib/ingest/markdown-orchestrator';
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
  mocks.regenerateChunks.mockResolvedValue({ stored: 1, errors: [] });
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
    it('inserts content_items with ingest_source=upload + publication_status, classifies, embeds, chunks, then writes pipeline_runs row', async () => {
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

      // Verify the per-file pipeline ran in the documented order.
      expect(mocks.classifyContent).toHaveBeenCalledTimes(1);
      expect(mocks.classifyContent).toHaveBeenCalledWith({
        supabase,
        itemId: 'new-id-1',
        force: true,
        userId: SERVICE_ACCOUNT_UUID,
      });
      expect(mocks.generateEmbedding).toHaveBeenCalledTimes(1);
      expect(mocks.regenerateChunks).toHaveBeenCalledTimes(1);
      expect(mocks.regenerateChunks).toHaveBeenCalledWith(
        supabase,
        'new-id-1',
        expect.any(String),
      );

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

      // pipeline_runs row written with status='completed' + the pre-generated id.
      const pipelineRunInsertCall = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).pipeline_name ===
            'markdown_ui_ingest',
      );
      expect(pipelineRunInsertCall).toBeDefined();
      const runPayload = pipelineRunInsertCall![0] as Record<string, unknown>;
      expect(runPayload.status).toBe('completed');
      expect(runPayload.id).toBe(result.pipeline_run_id);
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

      expect(result.results_summary.created).toEqual(['new-id-1']);
      expect(result.results_summary.failed).toEqual([]);
      expect(result.results_summary.skipped).toEqual([]);
      expect(result.pipeline_run_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
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

      expect(result.results_summary.created).toEqual(['ok-id']);
      expect(result.results_summary.failed).toEqual([
        { filename: 'bad.md', reason: 'Classifier upstream timeout' },
      ]);
      expect(result.results_summary.skipped).toEqual([]);

      // pipeline_runs.status === 'completed_with_errors'
      const insertCalls = supabase._chain.insert.mock.calls;
      const runPayload = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).pipeline_name ===
            'markdown_ui_ingest',
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
      mocks.classifyContent.mockRejectedValue(
        new Error('Classifier offline'),
      );

      const result = await orchestrateMarkdownBatch({
        phase: 'import',
        files: [{ filename: 'lonely.md', content: '# Lonely' }],
        supabase: supabase as unknown as SupabaseClient<Database>,
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
      });

      expect(result.results_summary.created).toEqual([]);
      expect(result.results_summary.failed).toEqual([
        { filename: 'lonely.md', reason: 'Classifier offline' },
      ]);

      const insertCalls = supabase._chain.insert.mock.calls;
      const runPayload = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).pipeline_name ===
            'markdown_ui_ingest',
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
      expect((payload.metadata as Record<string, unknown>).suspected_duplicate_of).toBe(
        'existing-id',
      );
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

      expect(result.results_summary.skipped).toEqual(['skip.md']);
      expect(result.results_summary.created).toEqual([]);
      expect(result.results_summary.failed).toEqual([]);

      // No content_items insert.
      const insertCalls = supabase._chain.insert.mock.calls;
      const ciInsert = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          'ingest_source' in (call[0] as Record<string, unknown>),
      );
      expect(ciInsert).toBeUndefined();

      // pipeline_runs row still written with status='completed'.
      const runPayload = insertCalls.find(
        (call) =>
          call[0] &&
          typeof call[0] === 'object' &&
          (call[0] as Record<string, unknown>).pipeline_name ===
            'markdown_ui_ingest',
      )?.[0] as Record<string, unknown> | undefined;
      expect(runPayload!.status).toBe('completed');
      expect(runPayload!.items_processed).toBe(0);
    });
  });
});
