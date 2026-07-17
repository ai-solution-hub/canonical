/**
 * ID-147 {147.14} — E-Signature fork: merge every signed field's drawn
 * signature image onto the source PDF, returning the completed signed PDF
 * bytes.
 *
 * Adapted from the vendored `e-signature.tsx`'s single-field
 * `downloadSignedPdf` (`page.getSize()` + fixed 612x792 layout-space scale,
 * `pdfDocument.embedPng` + `page.drawImage`), which triggers a browser
 * download for exactly one field. This generalises the same per-field
 * scale/place math to N signed fields and returns bytes instead of
 * downloading them, so `e-signature-fork.tsx` can hand them to
 * `usePersistSignedDocument` (§F3(b)).
 */

/** Layout space the field bounding boxes were captured in (matches the vendored shell). */
const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;

export interface SignedFieldForPdf {
  /** 1-indexed PDF page number this field's signature belongs on. */
  page: number;
  bbox: { x: number; y: number; width: number; height: number };
  /** The drawn signature, as a PNG data URL. */
  imageDataUrl: string;
}

export interface BuildSignedPdfBytesInput {
  /** URL of the source (unsigned) PDF. */
  file: string;
  /** Every field that has been signed, in the order to draw them. */
  fields: SignedFieldForPdf[];
}

/**
 * Fetches `file`, draws every field's signature image onto its target page
 * at the field's scaled bounding box, and returns the merged PDF bytes.
 */
export async function buildSignedPdfBytes({
  file,
  fields,
}: BuildSignedPdfBytesInput): Promise<Uint8Array> {
  const { PDFDocument } = await import('pdf-lib');
  const existingPdfBytes = await fetch(file).then((response) =>
    response.arrayBuffer(),
  );
  const pdfDocument = await PDFDocument.load(existingPdfBytes);

  for (const field of fields) {
    const page = pdfDocument.getPage(field.page - 1);
    const signatureImage = await pdfDocument.embedPng(field.imageDataUrl);
    const { width: pageWidth, height: pageHeight } = page.getSize();
    const scaleX = pageWidth / PAGE_WIDTH;
    const scaleY = pageHeight / PAGE_HEIGHT;
    const fieldWidth = field.bbox.width * scaleX;
    const fieldHeight = field.bbox.height * scaleY;
    const fieldX = field.bbox.x * scaleX;
    const fieldY = pageHeight - (field.bbox.y + field.bbox.height) * scaleY;

    page.drawImage(signatureImage, {
      x: fieldX,
      y: fieldY,
      width: fieldWidth,
      height: fieldHeight,
    });
  }

  return pdfDocument.save();
}
