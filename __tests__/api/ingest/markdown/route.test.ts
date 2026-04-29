/**
 * Tests for POST /api/ingest/markdown.
 *
 * Verifies:
 *   - Auth gate (admin OR editor; rejects unauthenticated).
 *   - Phase routing (analyse vs import) shape.
 *   - Multipart input validation (extension / size / count / mixed types).
 *   - `BatchOptionsSchema` validation via `parseBody` (no inline safeParse).
 *   - Orchestrator delegation (mocked — no real DB writes).
 *
 * Spec: docs/specs/ep2-markdown-ui-ingest-spec.md §5.1-§5.5.
 * Plan: docs/plans/§1.11-ep2-build-plan.md EP2-T4 acceptance criteria (a)-(h).
 *
 * Integration tests (real orchestrator + DB) live under EP2-T7 in
 * `__tests__/integration/markdown-batch-*.integration.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ---------------------------------------------------------------------------
// Module mocks — `getAuthorisedClient` (auth gate) and the orchestrator.
// ---------------------------------------------------------------------------

vi.mock('@/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    getAuthorisedClient: vi.fn(),
  };
});

vi.mock('@/lib/ingest/markdown-orchestrator', () => ({
  orchestrateMarkdownBatch: vi.fn(),
}));

import { POST } from '@/app/api/ingest/markdown/route';
import { getAuthorisedClient } from '@/lib/auth';
import { orchestrateMarkdownBatch } from '@/lib/ingest/markdown-orchestrator';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);
const orchestrateMock = vi.mocked(orchestrateMarkdownBatch);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ADMIN_USER_ID = 'a0000000-0000-4000-8000-000000000aaa';
const EDITOR_USER_ID = 'b0000000-0000-4000-8000-000000000bbb';

function fakeSupabase() {
  // The route never touches `supabase` directly — orchestrator does.
  // Return a plain object cast to satisfy the discriminated-union type.
  return {} as unknown as Parameters<
    typeof orchestrateMarkdownBatch
  >[0]['supabase'];
}

function configureAdmin() {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: {
      id: ADMIN_USER_ID,
      email: 'admin@test',
      user_metadata: {},
    } as never,
    supabase: fakeSupabase(),
    role: 'admin',
  });
}

function configureEditor() {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: {
      id: EDITOR_USER_ID,
      email: 'editor@test',
      user_metadata: {},
    } as never,
    supabase: fakeSupabase(),
    role: 'editor',
  });
}

function configureUnauthenticated() {
  getAuthorisedClientMock.mockResolvedValue({
    success: false,
    reason: 'unauthenticated',
  });
}

/**
 * Build a synthetic File-like object that survives the canonical override
 * pattern. jsdom's FormData/Request round-trip drops File.name and
 * substitutes literal "undefined" bytes for the content; the `formData()`
 * override pattern below avoids the round-trip entirely (see
 * `__tests__/api/upload-route-owner.test.ts:140-152` + memory pattern note
 * on canonical upload-test mock approach at bid-drafting.test.ts:1624).
 */
function buildFakeFile(args: {
  name: string;
  content: string | Uint8Array;
  type?: string;
}): File {
  const bytes =
    typeof args.content === 'string'
      ? new TextEncoder().encode(args.content)
      : args.content;
  const blob = new Blob([bytes as unknown as BlobPart], {
    type: args.type ?? 'text/markdown',
  });
  return Object.create(File.prototype, {
    name: { value: args.name, enumerable: true },
    type: { value: args.type ?? 'text/markdown', enumerable: true },
    size: { value: bytes.byteLength, enumerable: true },
    arrayBuffer: { value: () => blob.arrayBuffer() },
  }) as File;
}

/**
 * Build a `NextRequest` whose `formData()` is pre-mocked to return the
 * supplied `phase`, `files[]`, and optional `options` JSON. Overriding
 * `formData()` directly is the canonical pattern for upload-route tests
 * in this repo (see `__tests__/api/upload-route-owner.test.ts:155-181`).
 */
function makeRequest(args: {
  phase: string | null;
  files: Array<{ name: string; content: string | Uint8Array; type?: string }>;
  optionsJson?: string;
}): NextRequest {
  const builtFiles = args.files.map(buildFakeFile);

  const fakeFormData = {
    get: vi.fn((key: string): FormDataEntryValue | null => {
      if (key === 'phase') return args.phase;
      if (key === 'options' && args.optionsJson !== undefined) {
        return args.optionsJson;
      }
      return null;
    }),
    getAll: vi.fn((key: string): FormDataEntryValue[] => {
      if (key === 'files[]') return builtFiles as unknown as FormDataEntryValue[];
      return [];
    }),
  };

  const req = {
    formData: vi.fn().mockResolvedValue(fakeFormData),
  };
  return req as unknown as NextRequest;
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Phase routing — analyse
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — phase=analyse', () => {
  it('admin success → 200 + { analysis } shape', async () => {
    configureAdmin();
    orchestrateMock.mockResolvedValue({
      analysis: [
        {
          filename: 'foo.md',
          sizeBytes: 5,
          encodingOk: true,
          empty: false,
          frontMatter: { present: false, parsedOk: true, fields: {} },
          title: 'Foo',
          titleProvenance: 'h1',
          contentHash: 'abc',
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
    } as never);

    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'foo.md', content: '# Foo' }],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('analysis');
    expect(Array.isArray(body.analysis)).toBe(true);
    expect(body.analysis).toHaveLength(1);

    // Orchestrator received phase=analyse with no callerUserId / role.
    expect(orchestrateMock).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'analyse' }),
    );
    const callArg = orchestrateMock.mock.calls[0][0];
    expect(callArg).not.toHaveProperty('callerUserId');
  });

  it('editor success → 200 (D-1 admin OR editor)', async () => {
    configureEditor();
    orchestrateMock.mockResolvedValue({ analysis: [] } as never);

    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'note.md', content: 'body' }],
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Phase routing — import
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — phase=import', () => {
  it('admin success → 200 + { pipeline_run_id, results_summary } (spec §5.4 rich shape)', async () => {
    configureAdmin();
    orchestrateMock.mockResolvedValue({
      pipeline_run_id: '11111111-1111-4111-8111-111111111111',
      results_summary: {
        files_processed: 1,
        stored: [{ id: 'c1', title: 'Foo', filename: 'foo.md' }],
        dedup_flagged: [],
        superseded: [],
        skipped_excluded: [],
        errored: [],
      },
    } as never);

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: '# Foo' }],
      optionsJson: JSON.stringify({ batch: { tag: 'kb-2026' } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pipeline_run_id).toBe('11111111-1111-4111-8111-111111111111');
    expect(body.results_summary).toEqual({
      files_processed: 1,
      stored: [{ id: 'c1', title: 'Foo', filename: 'foo.md' }],
      dedup_flagged: [],
      superseded: [],
      skipped_excluded: [],
      errored: [],
    });

    // Orchestrator received phase=import + caller identity + role.
    expect(orchestrateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        phase: 'import',
        callerUserId: ADMIN_USER_ID,
        callerRole: 'admin',
      }),
    );
  });

  it('editor with skip_dedup=true per file → orchestrator receives the flag (silent-ignore happens inside)', async () => {
    configureEditor();
    orchestrateMock.mockResolvedValue({
      pipeline_run_id: '22222222-2222-4222-8222-222222222222',
      results_summary: {
        files_processed: 1,
        stored: [{ id: 'c1', title: 'Foo', filename: 'foo.md' }],
        dedup_flagged: [],
        superseded: [],
        skipped_excluded: [],
        errored: [],
      },
    } as never);

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({
        per_file_overrides: [{ filename: 'foo.md', skip_dedup: true }],
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    // Verify the route forwards the role + flag verbatim — silent-ignore
    // policy lives in the orchestrator (spec §8.2).
    const callArg = orchestrateMock.mock.calls[0][0];
    expect(callArg.phase).toBe('import');
    if (callArg.phase === 'import') {
      expect(callArg.callerRole).toBe('editor');
      expect(callArg.options?.perFileOverrides).toEqual([
        { filename: 'foo.md', skipDedup: true, excluded: undefined, draftOrFinal: undefined },
      ]);
    }
  });
});

// ---------------------------------------------------------------------------
// Validation: phase / files[] / extensions / size / count
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — validation', () => {
  it('missing phase → 400', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: null,
      files: [{ name: 'foo.md', content: 'x' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/phase/i);
  });

  it('invalid phase → 400', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'verify',
      files: [{ name: 'foo.md', content: 'x' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('empty files[] → 400', async () => {
    configureAdmin();
    const req = makeRequest({ phase: 'analyse', files: [] });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/files\[\]/);
  });

  it('all files non-.md → 415', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'analyse',
      files: [
        { name: 'foo.txt', content: 'plain' },
        { name: 'bar.txt', content: 'plain' },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
    const body = await res.json();
    expect(body.error).toMatch(/.md/);
  });

  it('mixed .md + .pdf → 400', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'analyse',
      files: [
        { name: 'foo.md', content: '# foo' },
        { name: 'bar.pdf', content: 'pdf' },
      ],
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(
      'Markdown batch mode requires all files to be .md',
    );
  });

  it('file >1 MB → 413', async () => {
    configureAdmin();
    const oversized = 'a'.repeat(1_048_577); // 1 MB + 1 byte
    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'big.md', content: oversized }],
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
  });

  it('>10 files → 400 "Maximum 10 files per batch"', async () => {
    configureAdmin();
    const files = Array.from({ length: 11 }, (_, i) => ({
      name: `f${i}.md`,
      content: `# file ${i}`,
    }));
    const req = makeRequest({ phase: 'analyse', files });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Maximum 10 files per batch');
  });

  it('non-UTF-8 file → 415', async () => {
    configureAdmin();
    // 0xFF 0xFE 0xFD — invalid UTF-8 lead bytes.
    const invalidUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'bad.md', content: invalidUtf8 }],
    });
    const res = await POST(req);
    expect(res.status).toBe(415);
  });
});

// ---------------------------------------------------------------------------
// Auth failure
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — auth', () => {
  it('unauthenticated → 401 via authFailureResponse', async () => {
    configureUnauthenticated();
    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'foo.md', content: 'x' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('forbidden role → 403', async () => {
    getAuthorisedClientMock.mockResolvedValue({
      success: false,
      reason: 'forbidden',
    });
    const req = makeRequest({
      phase: 'analyse',
      files: [{ name: 'foo.md', content: 'x' }],
    });
    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Options JSON parsing
// ---------------------------------------------------------------------------

describe('POST /api/ingest/markdown — options validation', () => {
  it('malformed options JSON → 400', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: '{ not-json',
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(orchestrateMock).not.toHaveBeenCalled();
  });

  it('invalid options shape (unknown field) → 400 via parseBody', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      // .strict() rejects unknown top-level keys.
      optionsJson: JSON.stringify({ unknownField: 'x' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  it('omitted options on import → orchestrator receives empty/default options', async () => {
    configureAdmin();
    orchestrateMock.mockResolvedValue({
      pipeline_run_id: '33333333-3333-4333-8333-333333333333',
      results_summary: {
        files_processed: 1,
        stored: [],
        dedup_flagged: [],
        superseded: [],
        skipped_excluded: [],
        errored: [],
      },
    } as never);

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      // No optionsJson.
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const callArg = orchestrateMock.mock.calls[0][0];
    if (callArg.phase === 'import') {
      expect(callArg.options?.tag).toBeNull();
      expect(callArg.options?.author).toBeNull();
      expect(callArg.options?.perFileOverrides).toBeUndefined();
    }
  });

  it('auto_supersede forwards through wire→orchestrator mapping', async () => {
    configureAdmin();
    orchestrateMock.mockResolvedValue({
      pipeline_run_id: '44444444-4444-4444-8444-444444444444',
      results_summary: {
        files_processed: 1,
        stored: [],
        dedup_flagged: [],
        superseded: [],
        skipped_excluded: [],
        errored: [],
      },
    } as never);

    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ batch: { auto_supersede: true } }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const callArg = orchestrateMock.mock.calls[0][0];
    if (callArg.phase === 'import') {
      expect(callArg.options?.autoSupersede).toBe(true);
    }
  });
});
