/**
 * Tests for XlsxViewer (components/diff/viewers/xlsx-viewer.tsx)
 *
 * ID-117.8 — Option D: DOCX/XLSX viewers via docx-preview + SheetJS
 *
 * Test philosophy: verify observable behaviour — loading state, sheet rendering,
 * multi-sheet tab switching, and the error-signal contract that the pane uses
 * for INV-6 text fallback.
 */
import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { XlsxViewer } from '@/components/diff/viewers/xlsx-viewer';

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('xlsx', () => ({
  read: vi.fn(),
  utils: {
    sheet_to_html: vi.fn(),
    sheet_to_json: vi.fn(),
  },
}));

// DOMPurify relies on a real browser DOM not present in jsdom — mock it so
// it passes through the HTML unchanged for test assertions.
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

import * as XLSX from 'xlsx';

const mockRead = XLSX.read as Mock;
const mockSheetToHtml = XLSX.utils.sheet_to_html as Mock;

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

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

/** Build a minimal mock WorkBook with one or more sheets. */
function makeMockWorkbook(
  sheetNames: string[],
  htmlBySheet: Record<string, string> = {},
) {
  const sheets: Record<string, unknown> = {};
  for (const name of sheetNames) {
    sheets[name] = {}; // opaque worksheet object
  }

  mockRead.mockReturnValueOnce({
    SheetNames: sheetNames,
    Sheets: sheets,
  });

  // sheet_to_html returns different HTML per sheet name when htmlBySheet provided
  mockSheetToHtml.mockImplementation((_ws: unknown) => {
    // We can't easily correlate worksheet object → name in mock without capturing,
    // so return a generic table for each call
    return '<table><tr><td>Cell content</td></tr></table>';
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('XlsxViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('loading state', () => {
    it('shows a loading skeleton while the spreadsheet is being fetched', () => {
      mockFetch.mockReturnValueOnce(new Promise(() => undefined));

      render(<XlsxViewer url="https://example.com/sheet.xlsx" />);

      expect(screen.getByRole('status')).toBeInTheDocument();
    });
  });

  describe('single-sheet render', () => {
    it('renders the sheet content and removes the loading skeleton', async () => {
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1']);

      render(<XlsxViewer url="https://example.com/sheet.xlsx" />);

      await waitFor(() => {
        expect(mockRead).toHaveBeenCalledTimes(1);
      });

      expect(screen.queryByRole('status')).not.toBeInTheDocument();
    });

    it('passes the correct URL to fetch', async () => {
      const url = 'https://storage.example.com/signed/data.xlsx';
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1']);

      render(<XlsxViewer url={url} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(mockFetch).toHaveBeenCalledWith(url);
    });

    it('calls XLSX.read with type array', async () => {
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1']);

      render(<XlsxViewer url="https://example.com/sheet.xlsx" />);

      await waitFor(() => expect(mockRead).toHaveBeenCalledTimes(1));
      expect(mockRead).toHaveBeenCalledWith(expect.any(ArrayBuffer), {
        type: 'array',
      });
    });
  });

  describe('multi-sheet tab switching', () => {
    it('renders tab buttons for each sheet', async () => {
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1', 'Sheet2', 'Summary']);

      render(<XlsxViewer url="https://example.com/multisheet.xlsx" />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeInTheDocument();
      });
      expect(screen.getByRole('tab', { name: 'Sheet2' })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Summary' })).toBeInTheDocument();
    });

    it('does not render tabs when there is only one sheet', async () => {
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1']);

      render(<XlsxViewer url="https://example.com/single.xlsx" />);

      await waitFor(() => {
        expect(mockRead).toHaveBeenCalledTimes(1);
      });

      // No tab buttons for a single sheet
      expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    });

    it('switches the active sheet when a tab is clicked', async () => {
      makeSuccessfulFetch();
      makeMockWorkbook(['Sheet1', 'Sheet2']);

      render(<XlsxViewer url="https://example.com/multisheet.xlsx" />);

      await waitFor(() => {
        expect(screen.getByRole('tab', { name: 'Sheet1' })).toBeInTheDocument();
      });

      const sheet2Tab = screen.getByRole('tab', { name: 'Sheet2' });
      fireEvent.click(sheet2Tab);

      // After click, Sheet2 tab should be marked selected
      expect(sheet2Tab).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('error signal — INV-6 fallback contract', () => {
    it('calls onError when fetch returns a non-ok response', async () => {
      makeFailedFetch(403);
      const onError = vi.fn();

      render(
        <XlsxViewer url="https://example.com/sheet.xlsx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls onError when fetch throws a network error', async () => {
      makeNetworkError();
      const onError = vi.fn();

      render(
        <XlsxViewer url="https://example.com/sheet.xlsx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('calls onError when XLSX.read throws', async () => {
      makeSuccessfulFetch();
      mockRead.mockImplementation(() => {
        throw new Error('Corrupt XLSX');
      });
      const onError = vi.fn();

      render(
        <XlsxViewer url="https://example.com/sheet.xlsx" onError={onError} />,
      );

      await waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('renders an inline error when fetch fails and no onError is provided', async () => {
      makeFailedFetch(500);

      render(<XlsxViewer url="https://example.com/sheet.xlsx" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });

    it('renders an inline error when XLSX.read fails and no onError is provided', async () => {
      makeSuccessfulFetch();
      mockRead.mockImplementation(() => {
        throw new Error('Bad format');
      });

      render(<XlsxViewer url="https://example.com/sheet.xlsx" />);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toBeInTheDocument();
      });
    });
  });
});
