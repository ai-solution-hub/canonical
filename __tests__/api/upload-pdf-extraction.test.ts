/**
 * Tests for PDF text extraction using unpdf (serverless-compatible replacement
 * for the previous Python/pdfplumber approach).
 *
 * Validates that extractText from unpdf correctly handles Buffer → Uint8Array → text
 * without requiring a Python runtime.
 */
import { describe, it, expect } from 'vitest';
import { extractText } from 'unpdf';

/**
 * Minimal valid PDF containing the text "Hello World".
 * This is the smallest well-formed PDF that produces extractable text.
 */
function createMinimalPdf(): Uint8Array {
  const pdfContent = `%PDF-1.0
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>
endobj

4 0 obj
<< /Length 44 >>
stream
BT /F1 12 Tf 100 700 Td (Hello World) Tj ET
endstream
endobj

5 0 obj
<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>
endobj

xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000360 00000 n 

trailer
<< /Size 6 /Root 1 0 R >>
startxref
434
%%EOF`;
  return new TextEncoder().encode(pdfContent);
}

describe('unpdf PDF text extraction', () => {
  it('extracts text and page count from a PDF buffer', async () => {
    const data = createMinimalPdf();
    const { totalPages, text } = await extractText(data, { mergePages: false });

    expect(totalPages).toBe(1);
    expect(Array.isArray(text)).toBe(true);

    const joined = (text as string[]).join('\n\n');
    expect(joined).toContain('Hello World');
  });

  it('returns text as a single string when mergePages is true', async () => {
    const data = createMinimalPdf();
    const { totalPages, text } = await extractText(data, { mergePages: true });

    expect(totalPages).toBe(1);
    expect(typeof text).toBe('string');
    expect(text).toContain('Hello World');
  });

  it('handles Buffer-to-Uint8Array conversion (mirrors upload route)', async () => {
    // Simulate what the upload route does: Buffer.from(arrayBuffer) → Uint8Array
    const pdfData = createMinimalPdf();
    const buffer = Buffer.from(pdfData);
    const data = new Uint8Array(buffer);

    const { totalPages, text } = await extractText(data, { mergePages: false });

    expect(totalPages).toBeGreaterThan(0);
    expect((text as string[]).join('\n\n')).toContain('Hello World');
  });

  it('returns empty text array for pages without text', async () => {
    // A PDF with an empty content stream
    const pdfContent = `%PDF-1.0
1 0 obj
<< /Type /Catalog /Pages 2 0 R >>
endobj

2 0 obj
<< /Type /Pages /Kids [3 0 R] /Count 1 >>
endobj

3 0 obj
<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792]
   /Contents 4 0 R /Resources << >> >>
endobj

4 0 obj
<< /Length 0 >>
stream

endstream
endobj

xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000232 00000 n 

trailer
<< /Size 5 /Root 1 0 R >>
startxref
290
%%EOF`;

    const data = new TextEncoder().encode(pdfContent);
    const { totalPages, text } = await extractText(data, { mergePages: false });

    expect(totalPages).toBe(1);
    // Empty page should produce an empty or whitespace-only string
    const joined = (text as string[]).join('\n\n').trim();
    expect(joined).toBe('');
  });
});
