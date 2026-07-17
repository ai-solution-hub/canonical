/**
 * buildSignedPdfBytes tests — ID-147 {147.14} E-Signature fork.
 *
 * Adapted from the vendored `e-signature.tsx`'s single-field
 * `downloadSignedPdf` (which triggers a browser download); this merges
 * EVERY signed field's drawn signature image onto the source PDF and
 * returns bytes for `usePersistSignedDocument` to persist, instead of (or
 * as well as) downloading them. `pdf-lib` is mocked -- a real binary PDF
 * merge is out of scope for a behaviour-first unit test; the boundary
 * asserted here is "this module drives pdf-lib correctly", not "pdf-lib
 * produces a correct PDF" (pdf-lib's own test suite covers that).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetSize = vi.fn();
const mockDrawImage = vi.fn();
const mockGetPage = vi.fn();
const mockEmbedPng = vi.fn();
const mockSave = vi.fn();
const mockLoad = vi.fn();

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: (...args: unknown[]) => mockLoad(...args),
  },
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { buildSignedPdfBytes } from '@/components/procurement/extend/build-signed-pdf';

const SIGNATURE_DATA_URL = 'data:image/png;base64,AAA';

function makePage(overrides: { width?: number; height?: number } = {}) {
  mockGetSize.mockReturnValue({
    width: overrides.width ?? 612,
    height: overrides.height ?? 792,
  });
  return { getSize: mockGetSize, drawImage: mockDrawImage };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetch.mockResolvedValue({
    arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(4)),
  });
  mockGetPage.mockReturnValue(makePage());
  mockEmbedPng.mockResolvedValue({ __brand: 'embedded-png' });
  mockSave.mockResolvedValue(new Uint8Array([1, 2, 3]));
  mockLoad.mockResolvedValue({
    getPage: mockGetPage,
    embedPng: mockEmbedPng,
    save: mockSave,
  });
});

describe('buildSignedPdfBytes', () => {
  it('fetches the source PDF and returns the merged, signed bytes', async () => {
    const bytes = await buildSignedPdfBytes({
      file: 'https://example.test/tender.pdf',
      fields: [
        {
          page: 1,
          bbox: { x: 300, y: 504, width: 250, height: 58 },
          imageDataUrl: SIGNATURE_DATA_URL,
        },
      ],
    });

    expect(mockFetch).toHaveBeenCalledWith('https://example.test/tender.pdf');
    expect(mockEmbedPng).toHaveBeenCalledWith(SIGNATURE_DATA_URL);
    expect(mockDrawImage).toHaveBeenCalledTimes(1);
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('draws every signed field onto its own page', async () => {
    mockGetPage.mockImplementation(() => makePage());

    await buildSignedPdfBytes({
      file: 'https://example.test/tender.pdf',
      fields: [
        {
          page: 1,
          bbox: { x: 0, y: 0, width: 100, height: 40 },
          imageDataUrl: SIGNATURE_DATA_URL,
        },
        {
          page: 2,
          bbox: { x: 10, y: 10, width: 100, height: 40 },
          imageDataUrl: SIGNATURE_DATA_URL,
        },
      ],
    });

    expect(mockGetPage).toHaveBeenCalledWith(0);
    expect(mockGetPage).toHaveBeenCalledWith(1);
    expect(mockDrawImage).toHaveBeenCalledTimes(2);
  });

  it('scales the field bounding box from the fixed layout space to the actual page size', async () => {
    // 2x the fixed 612x792 layout space the bbox fractions were captured in.
    mockGetPage.mockReturnValue(makePage({ width: 1224, height: 1584 }));

    await buildSignedPdfBytes({
      file: 'https://example.test/tender.pdf',
      fields: [
        {
          page: 1,
          bbox: { x: 300, y: 504, width: 250, height: 58 },
          imageDataUrl: SIGNATURE_DATA_URL,
        },
      ],
    });

    expect(mockDrawImage).toHaveBeenCalledWith(
      { __brand: 'embedded-png' },
      expect.objectContaining({ width: 500, height: 116 }),
    );
  });
});
