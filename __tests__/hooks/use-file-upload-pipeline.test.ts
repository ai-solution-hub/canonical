/**
 * useFileUploadPipeline Hook Tests
 *
 * Tests the extracted upload pipeline hook that manages file upload state,
 * progress tracking, draft mode, and review item construction.
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

import {
  useFileUploadPipeline,
  SKIP_REVIEW_KEY,
} from '@/hooks/use-file-upload-pipeline';
import { createMockFile } from '../helpers/factories/file-upload';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Render the hook with a QueryClientProvider wrapper */
function renderUploadHook(
  options: Parameters<typeof useFileUploadPipeline>[0] = {},
) {
  const { Wrapper } = createQueryWrapper();
  return renderHook(() => useFileUploadPipeline(options), { wrapper: Wrapper });
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

/** Build a successful upload API response */
function successResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue({
      id: 'item-uuid-1',
      title: 'Test Document',
      content_type: 'pdf',
      warnings: [],
      duplicate_matches: [],
      classification: {
        domain: 'Compliance',
        subtopic: 'ISO Standards',
        confidence: 0.92,
      },
      summary: 'A test summary of the document.',
      quality_score: 72,
      ...overrides,
    }),
  };
}

/** Build an error upload API response */
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
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
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

    it('starts with empty review items', () => {
      const { result } = renderUploadHook();
      expect(result.current.reviewItems).toEqual([]);
    });

    it('starts with zero pending count', () => {
      const { result } = renderUploadHook();
      expect(result.current.pendingCount).toBe(0);
    });

    it('starts with no results', () => {
      const { result } = renderUploadHook();
      expect(result.current.hasResults).toBe(false);
    });

    it('starts with no active uploads', () => {
      const { result } = renderUploadHook();
      expect(result.current.hasActiveUploads).toBe(false);
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

    it('appends to existing files', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile('doc1.pdf')]);
      });
      act(() => {
        result.current.handleFilesAdded([createTestFile('doc2.pdf')]);
      });

      expect(result.current.files).toHaveLength(2);
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
    it('removes a file from the array', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      act(() => {
        result.current.handleFileRemoved(fileId);
      });

      expect(result.current.files).toHaveLength(0);
    });

    it('removes the file state entry', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      act(() => {
        result.current.handleFileRemoved(fileId);
      });

      expect(result.current.fileStates[fileId]).toBeUndefined();
    });

    it('decrements pending count', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile(),
          createTestFile('doc2.pdf'),
        ]);
      });

      expect(result.current.pendingCount).toBe(2);

      act(() => {
        result.current.handleFileRemoved(result.current.files[0].id);
      });

      expect(result.current.pendingCount).toBe(1);
    });
  });

  // =========================================================================
  // Upload
  // =========================================================================

  describe('handleUpload', () => {
    it('posts FormData to /api/upload for each file', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(mockFetch).toHaveBeenCalledWith('/api/upload', {
        method: 'POST',
        body: expect.any(FormData),
      });
    });

    it('does nothing when no pending files exist', async () => {
      const { result } = renderUploadHook();

      let uploadResult: unknown;
      await act(async () => {
        uploadResult = await result.current.handleUpload();
      });

      expect(mockFetch).not.toHaveBeenCalled();
      expect(uploadResult).toBeUndefined();
    });

    it('returns successful items after upload completes', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult: unknown;
      await act(async () => {
        uploadResult = await result.current.handleUpload();
      });

      expect(uploadResult).toEqual(
        expect.objectContaining({
          successfulItems: expect.arrayContaining([
            expect.objectContaining({
              id: 'item-uuid-1',
              title: 'Test Document',
            }),
          ]),
          errorCount: 0,
        }),
      );
    });

    it('uploads multiple files in parallel', async () => {
      mockFetch
        .mockResolvedValueOnce(
          successResponse({ id: 'item-1', title: 'Doc 1' }),
        )
        .mockResolvedValueOnce(
          successResponse({ id: 'item-2', title: 'Doc 2' }),
        );

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('doc1.pdf'),
          createTestFile('doc2.pdf'),
        ]);
      });

      let uploadResult:
        | { successfulItems: unknown[]; errorCount: number }
        | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(uploadResult?.successfulItems).toHaveLength(2);
      expect(uploadResult?.errorCount).toBe(0);
    });

    it('sets isUploading to false after upload completes', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.isUploading).toBe(false);
    });

    it('transitions phase to uploading during upload', async () => {
      // We cannot observe intermediate state easily without fake timers,
      // but we can verify the phase was set by checking it returns to uploading
      // when the upload finishes (the hook does not reset phase itself).
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      // After upload completes, phase is still 'uploading' because the hook
      // returns results and the calling component manages the transition
      expect(result.current.phase).toBe('uploading');
    });
  });

  // =========================================================================
  // Draft mode
  // =========================================================================

  describe('draft mode', () => {
    it('includes draft=true in FormData when draftMode is true', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook({ draftMode: true });

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBe('true');
    });

    it('does not include draft field when draftMode is false', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook({ draftMode: false });

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBeNull();
    });

    it('respects localStorage skip-review preference when draftMode is not set', async () => {
      mockFetch.mockResolvedValue(successResponse());
      localStorage.setItem(SKIP_REVIEW_KEY, 'true');

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBeNull();
    });

    it('sends draft=true when localStorage skip-review is not set', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBe('true');
    });

    it('draftMode=true overrides localStorage skip-review=true', async () => {
      mockFetch.mockResolvedValue(successResponse());
      localStorage.setItem(SKIP_REVIEW_KEY, 'true');

      const { result } = renderUploadHook({ draftMode: true });

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBe('true');
    });

    it('draftMode=false overrides localStorage setting', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook({ draftMode: false });

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const formData = mockFetch.mock.calls[0][1].body as FormData;
      expect(formData.get('draft')).toBeNull();
    });
  });

  // =========================================================================
  // Skip review preference
  // =========================================================================

  describe('skip review preference', () => {
    it('getSkipReview returns false by default', () => {
      const { result } = renderUploadHook();
      expect(result.current.getSkipReview()).toBe(false);
    });

    it('getSkipReview returns true when localStorage has the key', () => {
      localStorage.setItem(SKIP_REVIEW_KEY, 'true');
      const { result } = renderUploadHook();
      expect(result.current.getSkipReview()).toBe(true);
    });

    it('getSkipReview returns false for non-true values', () => {
      localStorage.setItem(SKIP_REVIEW_KEY, 'false');
      const { result } = renderUploadHook();
      expect(result.current.getSkipReview()).toBe(false);
    });

    it('returns skipReview=true in upload result when preference is set', async () => {
      mockFetch.mockResolvedValue(successResponse());
      localStorage.setItem(SKIP_REVIEW_KEY, 'true');

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult: { skipReview: boolean } | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(uploadResult?.skipReview).toBe(true);
    });

    it('returns skipReview=false in upload result when preference is not set', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult: { skipReview: boolean } | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(uploadResult?.skipReview).toBe(false);
    });
  });

  // =========================================================================
  // Per-file state transitions
  // =========================================================================

  describe('per-file state transitions', () => {
    it('marks all steps as done after successful upload', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      const fileState = result.current.fileStates[fileId];
      expect(fileState.steps.every((s) => s.status === 'done')).toBe(true);
    });

    it('marks file status as done with resultId after successful upload', async () => {
      mockFetch.mockResolvedValue(successResponse({ id: 'result-item-id' }));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const file = result.current.files[0];
      expect(file.status).toBe('done');
      expect(file.progress).toBe(100);
      expect(file.resultId).toBe('result-item-id');
    });

    it('sets hasResults to true after upload completes', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.hasResults).toBe(true);
    });

    it('initialises file state with 5 pipeline steps', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].steps).toHaveLength(5);
    });
  });

  // =========================================================================
  // Error handling
  // =========================================================================

  describe('error handling', () => {
    it('marks active step as error on upload failure', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      const fileState = result.current.fileStates[fileId];
      const hasError = fileState.steps.some((s) => s.status === 'error');
      expect(hasError).toBe(true);
    });

    it('records error message on the file', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const file = result.current.files[0];
      expect(file.status).toBe('error');
      expect(file.error).toBe('Server error');
    });

    it('sets isUploading back to false after error', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.isUploading).toBe(false);
    });

    it('returns error count in upload result', async () => {
      mockFetch.mockResolvedValue(errorResponse('Server error'));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult:
        | { errorCount: number; successfulItems: unknown[] }
        | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(uploadResult?.errorCount).toBe(1);
      expect(uploadResult?.successfulItems).toHaveLength(0);
    });

    it('handles mixed success and failure in batch uploads', async () => {
      mockFetch
        .mockResolvedValueOnce(successResponse({ id: 'item-1' }))
        .mockResolvedValueOnce(errorResponse('Upload failed'));

      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('good.pdf'),
          createTestFile('bad.pdf'),
        ]);
      });

      let uploadResult:
        | { errorCount: number; successfulItems: unknown[] }
        | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(uploadResult?.successfulItems).toHaveLength(1);
      expect(uploadResult?.errorCount).toBe(1);
    });

    it('uses fallback error message when fetch rejects with non-Error', async () => {
      mockFetch.mockRejectedValue('network failure string');
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      const file = result.current.files[0];
      expect(file.error).toBe('Upload failed');
    });
  });

  // =========================================================================
  // Response data enrichment
  // =========================================================================

  describe('response data enrichment', () => {
    it('stores classification data from the API response', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          classification: {
            domain: 'Technical',
            subtopic: 'Architecture',
            confidence: 0.85,
          },
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].classification).toEqual({
        domain: 'Technical',
        subtopic: 'Architecture',
        confidence: 0.85,
      });
    });

    it('stores AI summary from the API response', async () => {
      mockFetch.mockResolvedValue(
        successResponse({ summary: 'A detailed summary of the document.' }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].aiSummary).toBe(
        'A detailed summary of the document.',
      );
    });

    it('stores dedup matches and shows warning', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          duplicate_matches: [
            { id: 'dup-1', title: 'Existing Doc', similarity: 0.91 },
          ],
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].dedupMatches).toHaveLength(1);
      expect(result.current.fileStates[fileId].dedupMatches[0].id).toBe(
        'dup-1',
      );
      expect(result.current.fileStates[fileId].showDedupWarning).toBe(true);
    });

    it('stores suggested layer from the API response', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          suggested_layer: {
            suggestedLayer: 'reference',
            reason: 'PDF document',
            confidence: 'high',
          },
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].suggestedLayer).toEqual({
        suggestedLayer: 'reference',
        reason: 'PDF document',
        confidence: 'high',
      });
    });

    it('stores re-upload detection info', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          reupload_detection: {
            match_type: 'new_version',
            previous_version: 1,
            previous_document_id: 'prev-doc-id',
          },
          source_document_id: 'new-doc-id',
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].reuploadInfo).toEqual({
        matchType: 'new_version',
        previousVersion: 1,
        previousDocumentId: 'prev-doc-id',
        newDocumentId: 'new-doc-id',
      });
    });

    it('constructs review items with classification and summary', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      let uploadResult:
        | {
            successfulItems: Array<{
              id: string;
              title: string;
              contentType: string;
              classification?: object;
              aiSummary?: string;
            }>;
          }
        | undefined;

      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      const item = uploadResult?.successfulItems[0];
      expect(item).toBeDefined();
      expect(item?.id).toBe('item-uuid-1');
      expect(item?.title).toBe('Test Document');
      expect(item?.contentType).toBe('pdf');
      expect(item?.classification).toEqual({
        domain: 'Compliance',
        subtopic: 'ISO Standards',
        confidence: 0.92,
      });
      expect(item?.aiSummary).toBe('A test summary of the document.');
    });

    it('uses filename as fallback title when API response has no title', async () => {
      mockFetch.mockResolvedValue(successResponse({ title: '' }));
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([
          createTestFile('my-important-doc.pdf'),
        ]);
      });

      let uploadResult:
        | { successfulItems: Array<{ title: string }> }
        | undefined;
      await act(async () => {
        uploadResult =
          (await result.current.handleUpload()) as typeof uploadResult;
      });

      expect(uploadResult?.successfulItems[0]?.title).toBe(
        'my-important-doc.pdf',
      );
    });
  });

  // =========================================================================
  // Reset
  // =========================================================================

  describe('reset', () => {
    it('clears all files and states', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.files).toHaveLength(1);

      act(() => {
        result.current.reset();
      });

      expect(result.current.files).toEqual([]);
      expect(result.current.fileStates).toEqual({});
      expect(result.current.reviewItems).toEqual([]);
      expect(result.current.phase).toBe('select');
      expect(result.current.isUploading).toBe(false);
    });

    it('resets phase to select', () => {
      const { result } = renderUploadHook();

      act(() => {
        result.current.setPhase('review');
      });

      expect(result.current.phase).toBe('review');

      act(() => {
        result.current.reset();
      });

      expect(result.current.phase).toBe('select');
    });
  });

  // =========================================================================
  // Layer management
  // =========================================================================

  describe('layer management', () => {
    it('handleSetLayerMode updates the layer mode for a file', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          suggested_layer: {
            suggestedLayer: 'reference',
            reason: 'Test',
            confidence: 'high',
          },
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].layerMode).toBe('suggest');

      act(() => {
        result.current.handleSetLayerMode(fileId, 'change');
      });

      expect(result.current.fileStates[fileId].layerMode).toBe('change');
    });

    it('handleSetSelectedLayer updates the selected layer', async () => {
      mockFetch.mockResolvedValue(successResponse());
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      act(() => {
        result.current.handleSetSelectedLayer(fileId, 'brief');
      });

      expect(result.current.fileStates[fileId].selectedLayer).toBe('brief');
    });

    it('handleDismissDedupWarning hides the dedup warning', async () => {
      mockFetch.mockResolvedValue(
        successResponse({
          duplicate_matches: [
            { id: 'dup-1', title: 'Existing', similarity: 0.9 },
          ],
        }),
      );
      const { result } = renderUploadHook();

      act(() => {
        result.current.handleFilesAdded([createTestFile()]);
      });

      const fileId = result.current.files[0].id;

      await act(async () => {
        await result.current.handleUpload();
      });

      expect(result.current.fileStates[fileId].showDedupWarning).toBe(true);

      act(() => {
        result.current.handleDismissDedupWarning(fileId);
      });

      expect(result.current.fileStates[fileId].showDedupWarning).toBe(false);
    });
  });

  // =========================================================================
  // Phase and review items management
  // =========================================================================

  describe('phase management', () => {
    it('setPhase updates the phase', () => {
      const { result } = renderUploadHook();

      expect(result.current.phase).toBe('select');

      act(() => {
        result.current.setPhase('review');
      });

      expect(result.current.phase).toBe('review');
    });

    it('setReviewItems updates the review items', () => {
      const { result } = renderUploadHook();

      const items = [
        {
          id: 'item-1',
          title: 'Test',
          contentType: 'pdf',
          warnings: [] as string[],
          dedupMatches: [],
        },
      ];

      act(() => {
        result.current.setReviewItems(items);
      });

      expect(result.current.reviewItems).toEqual(items);
    });
  });

  // =========================================================================
  // Cleanup on unmount
  // =========================================================================

  describe('cleanup', () => {
    it('clears interval timers on unmount without error', () => {
      const { unmount } = renderUploadHook();

      // Unmount should not throw
      expect(() => unmount()).not.toThrow();
    });
  });
});
