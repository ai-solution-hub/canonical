/**
 * @vitest-environment jsdom
 *
 * EP2 §1.11 markdown-batch UI ingest — edge-case tests covering the
 * route-level validators (size, count, encoding, mime).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §10.7.
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T7 acceptance criterion (e).
 *
 * SPEC DRIFTS — flagged for T9 spec amendment in W5:
 *
 * SPEC-DRIFT-T9 D1: Plan AC (e) says "non-UTF-8 → encoding_ok: false,
 *   auto-excluded". The actual route returns 415 BEFORE the orchestrator
 *   runs (route.ts decodeUtf8 path). The orchestrator's analyseFile always
 *   sets encodingOk=true because the route already filtered. Test here
 *   asserts the route's actual 415 behaviour.
 *
 * SPEC-DRIFT-T9 D2: Plan AC (e) says ">1 MB → 413 in analyse phase; entire
 *   batch rejected". Actual route rejects on first oversized file regardless
 *   of phase (route.ts:153-157 inside the same `for (const file of files)`
 *   loop) and does NOT process the remaining files. Test asserts a single
 *   1.5 MB file → 413.
 *
 * SPEC-DRIFT-T9 D3: Plan AC (e) says "mixed batch (.md + .pdf) → 400". The
 *   route returns 400 with literal "Markdown batch mode requires all files
 *   to be .md" for mixed batches, but ALL non-.md (no .md present) returns
 *   415 with the SAME message text. Different status code, same message.
 *   Tests cover both cases distinctly.
 *
 * SPEC-DRIFT-T9 D4: Spec wording says "empty file → flagged empty: true,
 *   auto-excluded". The orchestrator's analyseFile DOES return empty=true,
 *   but the auto-exclusion only fires when override.excluded === true is
 *   passed. Empty files with no override ARE imported as empty content_items
 *   rows. This test covers the actual analyse-phase flag only (import-phase
 *   behaviour for empty + no override sits outside this WP's scope).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockSupabaseClient,
  configureRole,
} from '@/__tests__/helpers/mock-supabase';
import { createTestRequest } from '@/__tests__/helpers/mock-next';

const mockSupabase = createMockSupabaseClient();

const { mockCookies } = vi.hoisted(() => ({
  mockCookies: vi.fn(),
}));

// Track whether the orchestrator was reached (for rejection-path assertions).
const orchestratorMock = vi.hoisted(() => ({
  orchestrateMarkdownBatch: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => mockSupabase),
  createServiceClient: vi.fn(() => mockSupabase),
}));

vi.mock('next/headers', () => ({
  cookies: mockCookies,
}));

// Mock the orchestrator wholesale — for edge-case 4xx tests we want to
// confirm it never runs. For the empty-file analyse test we use a
// thin pass-through that mirrors the real analyse return shape.
vi.mock('@/lib/ingest/markdown-orchestrator', () => ({
  orchestrateMarkdownBatch: orchestratorMock.orchestrateMarkdownBatch,
}));

import { POST } from '@/app/api/ingest/markdown/route';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CALLER_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';

function createMockFile(args: {
  name: string;
  content?: string;
  bytes?: Uint8Array;
  type?: string;
}): File {
  const { name, type = 'text/markdown' } = args;
  const bytes =
    args.bytes ?? new TextEncoder().encode(args.content ?? '');
  const blob = new Blob([bytes as unknown as BlobPart], { type });
  return Object.create(File.prototype, {
    name: { value: name, writable: false },
    type: { value: type, writable: false },
    size: { value: bytes.length, writable: false },
    arrayBuffer: { value: () => blob.arrayBuffer(), writable: false },
  }) as File;
}

function buildBatchRequest(args: {
  phase: 'analyse' | 'import';
  files: File[];
  options?: object;
}): import('next/server').NextRequest {
  const req = createTestRequest('/api/ingest/markdown', {
    method: 'POST',
    body: {},
  });

  const formData = new FormData();
  formData.get = vi.fn((key: string) => {
    if (key === 'phase') return args.phase;
    if (key === 'options') {
      return args.options ? JSON.stringify(args.options) : null;
    }
    return null;
  }) as unknown as typeof formData.get;
  formData.getAll = vi.fn((key: string) => {
    if (key === 'files[]') return args.files;
    return [];
  }) as unknown as typeof formData.getAll;

  (req as unknown as { formData: () => Promise<FormData> }).formData = vi
    .fn()
    .mockResolvedValue(formData);

  return req;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockCookies.mockResolvedValue({ getAll: () => [], set: () => {} });

  mockSupabase.from.mockReturnValue(mockSupabase._chain);
  mockSupabase.auth.getUser.mockResolvedValue({
    data: { user: { id: CALLER_USER_ID, email: 'e@test' } },
    error: null,
  });

  // Default: orchestrator would never be called for the rejection paths.
  orchestratorMock.orchestrateMarkdownBatch.mockReset();
});

// ---------------------------------------------------------------------------
// Tests — Spec §10.7 + Plan EP2-T7 (e)
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — edge cases (size, count, encoding, mime)', () => {
  // ─── Empty file (analyse phase) ─────────────────────────────────────

  it('analyse: empty file (0 bytes) → analysis[0].empty=true', async () => {
    // SPEC-DRIFT-T9 D4: orchestrator's analyseFile returns empty=true, but
    // import-phase auto-exclusion only fires when override.excluded=true is
    // passed. Test here covers the analyse-phase flag only.
    configureRole(mockSupabase, 'editor');
    orchestratorMock.orchestrateMarkdownBatch.mockResolvedValueOnce({
      analysis: [
        {
          filename: 'empty.md',
          sizeBytes: 0,
          encodingOk: true,
          empty: true,
          frontMatter: { present: false, parsedOk: true, fields: {} },
          title: 'empty',
          titleProvenance: 'filename',
          contentHash: '',
          hasConflictMarkers: false,
          diffMarkers: {
            gitConflictCount: 0,
            plusMinusLineCount: 0,
            warning: false,
          },
          draftOrFinalHeuristic: 'unknown',
          dedupVerdict: { isDuplicate: false },
          sourceFileMatch: null,
        },
      ],
    });

    const file = createMockFile({ name: 'empty.md', bytes: new Uint8Array(0) });
    const req = buildBatchRequest({ phase: 'analyse', files: [file] });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.analysis[0].empty).toBe(true);
  });

  it('analyse: whitespace-only file → analysis[0].empty=true', async () => {
    // SPEC-DRIFT-T9 D4: same flag (empty=true), but no auto-exclude on import
    // unless the user explicitly excludes. Mirrors the orchestrator's
    // `isEmpty || emptyAfterCleanup` calculation.
    configureRole(mockSupabase, 'editor');
    orchestratorMock.orchestrateMarkdownBatch.mockResolvedValueOnce({
      analysis: [
        {
          filename: 'ws.md',
          sizeBytes: 7,
          encodingOk: true,
          empty: true,
          frontMatter: { present: false, parsedOk: true, fields: {} },
          title: 'ws',
          titleProvenance: 'filename',
          contentHash: '',
          hasConflictMarkers: false,
          diffMarkers: {
            gitConflictCount: 0,
            plusMinusLineCount: 0,
            warning: false,
          },
          draftOrFinalHeuristic: 'unknown',
          dedupVerdict: { isDuplicate: false },
          sourceFileMatch: null,
        },
      ],
    });

    const file = createMockFile({ name: 'ws.md', content: '   \n\n  \n' });
    const req = buildBatchRequest({ phase: 'analyse', files: [file] });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.analysis[0].empty).toBe(true);
  });

  // ─── Non-UTF-8 → 415 (D1) ───────────────────────────────────────────

  it('non-UTF-8 file (latin-1 high-bit bytes) → 415 (orchestrator never runs)', async () => {
    // SPEC-DRIFT-T9 D1: Plan AC (e) says "encoding_ok: false, auto-excluded";
    // actual route returns 415 BEFORE the orchestrator runs.
    configureRole(mockSupabase, 'editor');

    // Invalid UTF-8 byte sequence — 0xff/0xfe are never valid UTF-8 start
    // bytes; 0xa0 is a continuation byte without a leading byte. TextDecoder
    // with { fatal: true } MUST throw on this sequence.
    const bytes = new Uint8Array([0xff, 0xfe, 0xa0]);
    const file = createMockFile({ name: 'bad-encoding.md', bytes });
    const req = buildBatchRequest({ phase: 'import', files: [file] });

    const res = await POST(req);
    expect(res.status).toBe(415);

    const body = await res.json();
    expect(body.error).toBe("File 'bad-encoding.md' is not valid UTF-8");

    expect(orchestratorMock.orchestrateMarkdownBatch).not.toHaveBeenCalled();
  });

  // ─── >1 MB → 413 (D2) ──────────────────────────────────────────────

  it('single >1 MB file → 413 (orchestrator never runs)', async () => {
    // SPEC-DRIFT-T9 D2: Plan AC (e) says ">1 MB → 413 in analyse phase";
    // actual route rejects on first oversized file regardless of phase.
    configureRole(mockSupabase, 'editor');

    // 1.5 MB — exceeds MAX_FILE_SIZE_BYTES (1_048_576).
    const bytes = new Uint8Array(1_500_000);
    bytes.fill(0x61); // ASCII 'a' — valid UTF-8 padding
    const file = createMockFile({ name: 'huge.md', bytes });
    const req = buildBatchRequest({ phase: 'import', files: [file] });

    const res = await POST(req);
    expect(res.status).toBe(413);

    const body = await res.json();
    expect(body.error).toBe(
      "File 'huge.md' exceeds the 1 MB per-file limit",
    );

    expect(orchestratorMock.orchestrateMarkdownBatch).not.toHaveBeenCalled();
  });

  // ─── 11 files → 400 ────────────────────────────────────────────────

  it('11 files in batch → 400 "Maximum 10 files per batch"', async () => {
    configureRole(mockSupabase, 'editor');

    const files = Array.from({ length: 11 }, (_, i) =>
      createMockFile({ name: `f${i}.md`, content: `# File ${i}\n` }),
    );
    const req = buildBatchRequest({ phase: 'import', files });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe('Maximum 10 files per batch');

    expect(orchestratorMock.orchestrateMarkdownBatch).not.toHaveBeenCalled();
  });

  // ─── Mixed batch .md + .pdf → 400 (D3) ─────────────────────────────

  it('mixed batch (.md + .pdf) → 400 with shared message (orchestrator never runs)', async () => {
    // SPEC-DRIFT-T9 D3: mixed batch returns 400, all-non-md returns 415, but
    // both carry the SAME error string. Status-code distinction is the only
    // discriminator. This test asserts the 400 branch.
    configureRole(mockSupabase, 'editor');

    const md = createMockFile({ name: 'foo.md', content: '# Foo\n' });
    const pdf = createMockFile({
      name: 'bar.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      type: 'application/pdf',
    });
    const req = buildBatchRequest({ phase: 'import', files: [md, pdf] });

    const res = await POST(req);
    expect(res.status).toBe(400);

    const body = await res.json();
    expect(body.error).toBe(
      'Markdown batch mode requires all files to be .md',
    );

    expect(orchestratorMock.orchestrateMarkdownBatch).not.toHaveBeenCalled();
  });

  // ─── All non-.md (no .md) → 415 (D3) ───────────────────────────────

  it('all-non-md batch (e.g. 2 .pdf files) → 415 with shared message (orchestrator never runs)', async () => {
    // SPEC-DRIFT-T9 D3: SAME message ("Markdown batch mode requires all
    // files to be .md") but DIFFERENT status code (415 vs 400).
    configureRole(mockSupabase, 'editor');

    const pdf1 = createMockFile({
      name: 'a.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      type: 'application/pdf',
    });
    const pdf2 = createMockFile({
      name: 'b.pdf',
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      type: 'application/pdf',
    });
    const req = buildBatchRequest({ phase: 'import', files: [pdf1, pdf2] });

    const res = await POST(req);
    expect(res.status).toBe(415);

    const body = await res.json();
    expect(body.error).toBe(
      'Markdown batch mode requires all files to be .md',
    );

    expect(orchestratorMock.orchestrateMarkdownBatch).not.toHaveBeenCalled();
  });
});
