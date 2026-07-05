/**
 * Tests for POST /api/ingest/folder-drop — the upload leg (ID-56 Path B,
 * ID-138 {138.13} T2 RE-POINT).
 *
 * DR-020 retires the `/stage` + `/walk` worker transport. The route now
 * gate-passes the destPath, then calls `stageAndWalk` (`lib/upload/
 * folder-drop.ts`) which PUTs the bytes into the `corpus` bucket + mints an
 * admission `source_documents` row in one fenced flow — this suite mocks
 * `stageAndWalk` itself (its own behaviour is covered by
 * `__tests__/lib/upload/folder-drop.test.ts`) and verifies the ROUTE'S
 * contract:
 *   - auth.success / authFailureResponse gating (admin/editor only).
 *   - request validation (missing/empty/oversized file -> 400).
 *   - the authed route client (`auth.supabase`) is threaded into
 *     `stageAndWalk` (mirrors the write-back.ts {138.12} T1 DI precedent).
 *   - the response carries `sourceDocumentId` + `wasMinted` (replacing the
 *     retired `stageRequestId`).
 *   - FolderDropError stage -> HTTP status mapping: destPath 400, fence 409,
 *     everything else 502.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockFile,
  createMockUploadRequest,
} from '@/__tests__/helpers/factories/file-upload';
import { createMockSupabaseClient } from '@/__tests__/helpers/mock-supabase';

vi.mock('@/lib/auth/client', async () => {
  const actual =
    await vi.importActual<typeof import('@/lib/auth/client')>(
      '@/lib/auth/client',
    );
  return { ...actual, getAuthorisedClient: vi.fn() };
});

const stageAndWalkMocks = vi.hoisted(() => ({
  stageAndWalk: vi.fn(),
}));
vi.mock('@/lib/upload/folder-drop', async () => {
  const actual = await vi.importActual<
    typeof import('@/lib/upload/folder-drop')
  >('@/lib/upload/folder-drop');
  return { ...actual, stageAndWalk: stageAndWalkMocks.stageAndWalk };
});

import { POST } from '@/app/api/ingest/folder-drop/route';
import { getAuthorisedClient } from '@/lib/auth/client';
import { FolderDropError } from '@/lib/upload/folder-drop';

const getAuthorisedClientMock = vi.mocked(getAuthorisedClient);
const mockSupabase = createMockSupabaseClient();

const SOURCE_DOCUMENT_ID = '22222222-2222-4222-8222-222222222222';

function authoriseAs(role: 'admin' | 'editor') {
  getAuthorisedClientMock.mockResolvedValue({
    success: true,
    user: { id: 'u1' } as never,
    supabase: mockSupabase as never,
    role,
  });
}

describe('POST /api/ingest/folder-drop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stageAndWalkMocks.stageAndWalk.mockResolvedValue({
      destPath: 'folder-drop/report.pdf',
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      sourceFile: 'report.pdf',
      wasMinted: true,
    });
  });

  it('401s when unauthenticated', async () => {
    getAuthorisedClientMock.mockResolvedValue({
      success: false,
      reason: 'unauthenticated',
    } as never);
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(stageAndWalkMocks.stageAndWalk).not.toHaveBeenCalled();
  });

  it('403s for a viewer role', async () => {
    getAuthorisedClientMock.mockResolvedValue({
      success: false,
      reason: 'forbidden',
    } as never);
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
    expect(stageAndWalkMocks.stageAndWalk).not.toHaveBeenCalled();
  });

  it('admits the file and threads the authed supabase client into stageAndWalk', async () => {
    authoriseAs('editor');
    const file = createMockFile({
      name: 'report.pdf',
      content: 'pdf-bytes',
      type: 'application/pdf',
    });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body).toEqual({
      sourceFile: 'report.pdf',
      destPath: 'folder-drop/report.pdf',
      sourceDocumentId: SOURCE_DOCUMENT_ID,
      wasMinted: true,
      retentionClass: 'keep_and_watch',
    });

    expect(stageAndWalkMocks.stageAndWalk).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'report.pdf',
        destPath: 'folder-drop/report.pdf',
        contentType: 'application/pdf',
        supabase: mockSupabase,
      }),
    );
    // No retentionClass form field -> stageAndWalk's own default applies
    // (undefined is not forwarded as an explicit override).
    expect(stageAndWalkMocks.stageAndWalk.mock.calls[0][0]).not.toHaveProperty(
      'retentionClass',
    );
  });

  // ID-131.24 (G-UPLOAD-GATE, DR-025) — the app-side upload rebind lets an
  // editor pick a retention class at admission time.
  describe('retention_class field (DR-025)', () => {
    it('threads an explicit retention_class=ingest_once through to stageAndWalk', async () => {
      authoriseAs('editor');
      stageAndWalkMocks.stageAndWalk.mockResolvedValue({
        destPath: 'folder-drop/report.pdf',
        sourceDocumentId: SOURCE_DOCUMENT_ID,
        sourceFile: 'report.pdf',
        wasMinted: true,
      });
      const file = createMockFile({ name: 'report.pdf', content: 'bytes' });
      const req = createMockUploadRequest({
        path: '/api/ingest/folder-drop',
        file,
        fields: { retention_class: 'ingest_once' },
      });

      const res = await POST(req);
      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body.retentionClass).toBe('ingest_once');

      expect(stageAndWalkMocks.stageAndWalk).toHaveBeenCalledWith(
        expect.objectContaining({ retentionClass: 'ingest_once' }),
      );
    });

    it('400s on an unsupported retention_class value', async () => {
      authoriseAs('editor');
      const file = createMockFile({ name: 'report.pdf', content: 'bytes' });
      const req = createMockUploadRequest({
        path: '/api/ingest/folder-drop',
        file,
        // live_connected is a zero-byte connector class — not valid for a
        // bytes upload through this route.
        fields: { retention_class: 'live_connected' },
      });

      const res = await POST(req);
      expect(res.status).toBe(400);
      expect(stageAndWalkMocks.stageAndWalk).not.toHaveBeenCalled();
    });
  });

  it('400s when no file part is present', async () => {
    authoriseAs('admin');
    const req = createMockUploadRequest({ path: '/api/ingest/folder-drop' });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(stageAndWalkMocks.stageAndWalk).not.toHaveBeenCalled();
  });

  it('400s on an empty file', async () => {
    authoriseAs('admin');
    const file = createMockFile({ name: 'empty.pdf', content: '' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('400s over the 50MB limit', async () => {
    authoriseAs('admin');
    const file = createMockFile({ name: 'huge.pdf', size: 52_428_801 });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(stageAndWalkMocks.stageAndWalk).not.toHaveBeenCalled();
  });

  it('maps a destPath FolderDropError to 400', async () => {
    authoriseAs('admin');
    stageAndWalkMocks.stageAndWalk.mockRejectedValue(
      new FolderDropError('destPath', 'bad destPath'),
    );
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('maps a fence-busy FolderDropError to 409', async () => {
    authoriseAs('admin');
    stageAndWalkMocks.stageAndWalk.mockRejectedValue(
      new FolderDropError('fence', 'corpus writer fence busy — retry shortly'),
    );
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(409);
  });

  it('maps a put FolderDropError (e.g. bucket not provisioned) to 502', async () => {
    authoriseAs('admin');
    stageAndWalkMocks.stageAndWalk.mockRejectedValue(
      new FolderDropError('put', 'corpus bucket not provisioned'),
    );
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(502);
  });

  it('maps an identity FolderDropError to 502', async () => {
    authoriseAs('admin');
    stageAndWalkMocks.stageAndWalk.mockRejectedValue(
      new FolderDropError('identity', 'resolver RPC failed'),
    );
    const file = createMockFile({ name: 'report.pdf', content: 'pdf-bytes' });
    const req = createMockUploadRequest({
      path: '/api/ingest/folder-drop',
      file,
    });

    const res = await POST(req);
    expect(res.status).toBe(502);
  });
});
