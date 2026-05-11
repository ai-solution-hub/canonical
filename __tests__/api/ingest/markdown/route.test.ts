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
import type { NextRequest } from 'next/server';
import {
  createMockFile,
  createMockUploadRequest,
} from '@/__tests__/helpers/factories/file-upload';

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
 * Adapter to the canonical upload-request factory: convert the legacy
 * `{ phase, files, optionsJson }` arg shape to the factory's call shape.
 * The factory defaults `filesKey` to `'files[]'` (the spec §5.2 key).
 */
function makeRequest(args: {
  phase: string | null;
  files: Array<{ name: string; content: string | Uint8Array; type?: string }>;
  optionsJson?: string;
}): NextRequest {
  const builtFiles = args.files.map((f) =>
    createMockFile({
      name: f.name,
      content: f.content,
      type: f.type ?? 'text/markdown',
    }),
  );

  return createMockUploadRequest({
    path: '/api/ingest/markdown',
    files: builtFiles,
    phase: args.phase,
    optionsJson: args.optionsJson,
  });
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

// phase=import behavioural contract moved to `route.queued.test.ts` post-S226
// §5.4.4 W1-IMPL — that route now returns 202+queued instead of sync 200.
// The new file covers AC-1/3/4/11 + auth + DB side-effect contracts. Old
// import-phase forwarding tests removed as implementation-coupled.

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
    expect(body.error).toBe('Markdown batch mode requires all files to be .md');
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

  it('rejects malformed pipeline_run_id (not a UUID) → 400 via parseBody', async () => {
    configureAdmin();
    const req = makeRequest({
      phase: 'import',
      files: [{ name: 'foo.md', content: 'body' }],
      optionsJson: JSON.stringify({ pipeline_run_id: 'not-a-uuid' }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
  });

  // Forwarding tests (omitted options → defaults; auto_supersede; pipeline_run_id
  // round-trip; null override) deleted post-S226 §5.4.4 W1-IMPL — those were
  // implementation-coupled (asserted on `orchestrateMock.mock.calls[0][0]`),
  // and the import phase no longer invokes the orchestrator inline anyway. The
  // post-S226 behavioural contract is covered in `route.queued.test.ts`.
});
