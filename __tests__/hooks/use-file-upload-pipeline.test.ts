/**
 * useFileUploadPipeline Hook Tests
 *
 * ID-131.24 (G-UPLOAD-GATE, DR-025) rework: the hook now admits each pending
 * file through the shared gated endpoint (POST /api/ingest/folder-drop) with
 * a caller-chosen retention class — no content_items row, no classification/
 * embedding/summary/layer/review tracking (that pipeline is retired).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createQueryWrapper } from '../helpers/query-wrapper';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import under test — after global mocks are in place
// ---------------------------------------------------------------------------

import { useFileUploadPipeline } from '@/hooks/use-file-upload-pipeline';
import { createMockFile } from '../helpers/factories/file-upload';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render the hook with a QueryClientProvider wrapper */
function renderUploadHook() {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => useFileUploadPipeline(), { wrapper: Wrapper });
}

/**
 * Create a minimal File object for testing. Hook tests run in jsdom and
 * the hook uses the File directly (no cross-realm instanceof), so the
 * plain DOM File constructor works.
 */
function createTestFile(name = 'test-document.pdf', size = 1024): File {
  return createMockFile({
    name,
    size,
    type: 'application/pdf',
    construction: 'plain',
  });
}

/** Build a successful admission API response (POST /api/ingest/folder-drop). */
function admitResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 202,
    json: vi.fn().mockResolvedValue({
      sourceFile: 'test-document.pdf',
      destPath: 'folder-drop/test-document.pdf',
      sourceDocumentId: 'sd-uuid-1',
      wasMinted: true,
      retentionClass: 'keep_and_watch',
      ...overrides,
    }),
  };
}

/** Build an error admission API response */
function errorResponse(message = 'Upload failed') {
  return {
    ok: false,
    status: 500,
    json: vi.fn().mockResolvedValue({ error: message }),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useFileUploadPipeline', () => {
  // =========================================================================
  // Initial state
  // =========================================================================

  describe('initial state', () => {
    it('starts with select phase', () => {
      const { result } = renderUploadHook();
      expect(result.current.phase).toBe('select');
    });

    it('starts with empty files array', () => {
      const { result } = renderUploadHook();
      expect(result.current.files).toEqual([]);
    });

    it('starts with empty fileStates', () => {
      const { result } = renderUploadHook();
      expect(result.current.fileStates).toEqual({});
    });

    it('starts not uploading', () => {
      const { result } = renderUploadHook();
      expect(result.current.isUploading).toBe(false);
    });

    it('starts with zero pending count', () => {
      const { result } = renderUploadHook();
      expect(result.current.pendingCount).toBe(0);
    });

    it('starts with no results', () => {
      const { result } = renderUploadHook();
      expect(result.current.hasResults).toBe(false);
    });
  });

  // =========================================================================
  // File management
  // =========================================================================

  describe('handleFilesAdded', () => {
    it('populates the files array with upload file objects', () => {
      const { result } = renderUploadHook();
      const file = createTestFile();

      act(() => {
        result.current.handleFilesAdded([file]);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.files[0].file).toBe(file);
      expect(result.current.files[0].status).toBe('pending');
      expect(result.current.files[0].progress).toBe(0);
    });

    it('assigns unique IDs to added files', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('doc1.pdf'),
          createTestFile('doc2.pdf'),
        ]);
      });

      expect(result.current.files[0].id).not.toBe(result.current.files[1].id);
    });

    it('increments pending count', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile(),
          createTestFile('doc2.pdf'),
        ]);
      });

      expect(result.current.pendingCount).toBe(2);
    });
  });

  describe('handleFileRemoved', () => {
    it('removes a file and its state entry, and decrements pending count', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile(),
          createTestFile('doc2.pdf'),
        ]);
      });

      const fileId = result.current.files[0].id;

      act(() => {
        result.current.handleFileRemoved(fileId);
      });

      expect(result.current.files).toHaveLength(1);
      expect(result.current.fileStates[fileId]).toBeUndefined();
      expect(result.current.pendingCount).toBe(1);
    });
  });

  // =========================================================================
  // Upload (admission)
  // =========================================================================

  describe('handleUpload', () => {
    it('posts FormData with the file + retention_class to /api/ingest/folder-drop', async () => {
      mockFetch.mockResolvedValue(admitResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/ingest/folder-drop', {
        method: 'POST',
        body: expect.any(FormData),
      });
      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('retention_class')).toBe('keep_and_watch');
    });

    it('does nothing when no pending files exist', async () => {
      const { result } = renderUploadHook();

      let uploadResult: unknown;
      await act(async () => {
        uploadResult = await result.current.handleUpload('keep_and_watch');
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(uploadResult).toBeUndefined();
    });

    it('marks the file admitted with sourceDocumentId + retentionClass from the response', async () => {
      mockFetch.mockResolvedValue(
        admitResponse({
          sourceDocumentId: 'sd-abc',
          wasMinted: false,
          retentionClass: 'ingest_once',
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });
      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload('ingest_once');
      });

      expect(result.current.fileStates[fileId]).toEqual({
        status: 'admitted',
        sourceDocumentId: 'sd-abc',
        destPath: 'folder-drop/test-document.pdf',
        wasMinted: false,
        retentionClass: 'ingest_once',
      });
      const file = result.current.files[0];
      expect(file.status).toBe('done');
      expect(file.progress).toBe(100);
      expect(file.resultId).toBe('sd-abc');
    });

    it('admits multiple files in parallel', async () => {
      mockFetch
        .mockResolvedValueOnce(admitResponse({ sourceDocumentId: 'sd-1' }))
        .mockResolvedValueOnce(admitResponse({ sourceDocumentId: 'sd-2' }));

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('doc1.pdf'),
          createTestFile('doc2.pdf'),
        ]);
      });

      let uploadResult:
        | { admittedCount: number; errorCount: number }
        | undefined;
      await act(async () => {
        uploadResult = (await result.current.handleUpload(
          'keep_and_watch',
        )) as typeof uploadResult;
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(uploadResult).toEqual({ admittedCount: 2, errorCount: 0 });
    });

    it('sets isUploading back to false and phase back to select after completion', async () => {
      mockFetch.mockResolvedValue(admitResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      expect(result.current.isUploading).toBe(false);
      expect(result.current.phase).toBe('select');
    });

    it('sets hasResults to true after upload completes', async () => {
      mockFetch.mockResolvedValue(admitResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      expect(result.current.hasResults).toBe(true);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('marks the file errored and records the message on failure', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });
      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      const file = result.current.files[0];
      expect(file.status).toBe('error');
      expect(file.error).toBe('Server error');
      expect(result.current.fileStates[fileId]).toEqual({
        status: 'error',
        error: 'Server error',
      });
    });

    it('returns errorCount in the upload result', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult:
        | { admittedCount: number; errorCount: number }
        | undefined;
      await act(async () => {
        uploadResult = (await result.current.handleUpload(
          'keep_and_watch',
        )) as typeof uploadResult;
      });

      expect(uploadResult).toEqual({ admittedCount: 0, errorCount: 1 });
    });

    it('handles mixed success and failure in batch uploads', async () => {
      mockFetch
        .mockResolvedValueOnce(admitResponse())
        .mockResolvedValueOnce(errorResponse('Upload failed'));

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('good.pdf'),
          createTestFile('bad.pdf'),
        ]);
      });

      let uploadResult:
        | { admittedCount: number; errorCount: number }
        | undefined;
      await act(async () => {
        uploadResult = (await result.current.handleUpload(
          'keep_and_watch',
        )) as typeof uploadResult;
      });

      expect(uploadResult).toEqual({ admittedCount: 1, errorCount: 1 });
    });

    it('uses fallback error message when fetch rejects with non-Error', async () => {
      mockFetch.mockRejectedValue('network failure string');
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      const file = result.current.files[0];
      expect(file.error).toBe('Upload failed');
    });
  });

  // =========================================================================
  // Reset
  // =========================================================================

  describe('reset', () => {
    it('clears all files and states, and resets phase to select', async () => {
      mockFetch.mockResolvedValue(admitResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload('keep_and_watch');
      });

      expect(result.current.files).toHaveLength(1);

      act(() => {
        result.current.reset();
      });

      expect(result.current.files).toEqual([]);
      expect(result.current.fileStates).toEqual({});
      expect(result.current.phase).toBe('select');
      expect(result.current.isUploading).toBe(false);
    });
  });
});
