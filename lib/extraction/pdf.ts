/**
 * PDF text extraction using unpdf.
 *
 * Shared module used by both the upload route and the URL ingestion
 * pipeline. Lazy-imports unpdf for serverless cold-start performance.
 */

export interface PdfExtractionResult {
  text: string;
  pageCount: number;
}

/**
 * Extract text content from a PDF buffer.
 *
 * @param buffer - The PDF file as an ArrayBuffer or Buffer
 * @returns Extracted text and page count
 */
export async function extractPdfText(
  buffer: ArrayBuffer | Buffer,
): Promise<PdfExtractionResult> {
  const { extractText } = await import('unpdf');

  const data = new Uint8Array(buffer);
  const { totalPages, text } = await extractText(data, { mergePages: false });

  return {
    text: (text as string[])
      .map((page) => page.trim())
      .filter(Boolean)
      .join('\n\n---\n\n'),
    pageCount: totalPages ?? 0,
  };
}
