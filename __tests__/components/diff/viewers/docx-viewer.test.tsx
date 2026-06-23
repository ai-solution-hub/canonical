/**
 * Tests for DocxViewer (components/diff/viewers/docx-viewer.tsx)
 *
 * ID-117.8 — Option D: DOCX/XLSX viewers via docx-preview + SheetJS
 *
 * Test philosophy: verify observable behaviour — rendered loading state,
 * rendered content on success, and error signal on fetch/parse failure.
 * Implementation details (e.g. exact DOM structure from docx-preview) are
 * not asserted; what matters is the contract the pane relies on.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DocxViewer } from '@/components/diff/viewers/docx-viewer';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

// Mock docx-preview's renderAsync — it manipulates the DOM directly and relies
// on browser APIs not present in jsdom. We replace it with a stub that writes a
// sentinel <div> into the container so tests can assert "render happened".
vi.mock('docx-preview', () => ({
  renderAsync: vi.fn(),
}));

import * as docxPreview from 'docx-preview';

const mockRenderAsync = docxPreview.renderAsync as Mock;

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// A minimal ArrayBuffer that stands in for DOCX bytes.
const FIXTURE_BUFFER = new Uint8Array([0x50, 0x4b, 0x03, 0x04]).buffer;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessfulFetch(buffer = FIXTURE_BUFFER) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    arrayBuffer: vi.fn().mockResolvedValueOnce(buffer),
  });
}

function makeFailedFetch(status = 500) {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    arrayBuffer: vi.fn(),
  });
}

function makeNetworkError() {
  mockFetch.mockRejectedValueOnce(new Error('Network error'));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DocxViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows a loading skeleton while the document is being fetched', () => {
      // Make fetch hang indefinitely so we observe the loading state
      mockFetch.mockReturnValueOnce(new Promise(() => undefined));
      mockRenderAsync.mockResolvedValueOnce(undefined);

      render(<DocxViewer url="https://example.com/doc.docx" />);

      // The loading skeleton must be present before fetch resolves
      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('successful render', () => {
    it('calls renderAsync with the fetched blob and removes the loading skeleton', async () => {
      makeSuccessfulFetch();
      mockRenderAsync.mockImplementation(
        async (_data: unknown, container: HTMLElement) => {
          const div = document.createElement('div');
          div.textContent = 'DOCX content rendered';
          container.appendChild(div);
        },
      );

      render(<DocxViewer url="https://example.com/doc.docx" />);

      await waitFor(() => {
        expect(mockRenderAsync).toHaveBeenCalledTimes(1);
      });

      // Loading skeleton should be gone after render completes
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('passes the correct URL to fetch', async () => {
      const url = 'https://storage.example.com/signed/document.docx';
      makeSuccessfulFetch();
      mockRenderAsync.mockResolvedValueOnce(undefined);

      render(<DocxViewer url={url} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledWith(url);
    });
  });

  describe('error signal — INV-6 fallback contract', () => {
    it('calls onError callback when fetch returns a non-ok response', async () => {
      makeFailedFetch(403);
      const onError = vi.fn();

      render(
        <DocxViewer url="https://example.com/doc.docx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls onError callback when fetch throws a network error', async () => {
      makeNetworkError();
      const onError = vi.fn();

      render(
        <DocxViewer url="https://example.com/doc.docx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls onError callback when renderAsync throws', async () => {
      makeSuccessfulFetch();
      mockRenderAsync.mockRejectedValueOnce(new Error('Parse failure'));
      const onError = vi.fn();

      render(
        <DocxViewer url="https://example.com/doc.docx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('renders an inline error message when fetch fails and no onError is provided', async () => {
      makeFailedFetch(404);

      render(<DocxViewer url="https://example.com/doc.docx" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('renders an inline error message when renderAsync fails and no onError is provided', async () => {
      makeSuccessfulFetch();
      mockRenderAsync.mockRejectedValueOnce(new Error('Corrupt document'));

      render(<DocxViewer url="https://example.com/doc.docx" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });
});
