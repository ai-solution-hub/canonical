/**
 * Extend v1 vendor-in smoke test — Bounding Box Citations / HumanReviewPanel
 * and the File Upload + PDF Dropzone shell (ID-147.6, PRODUCT §C/§D/§E).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { HumanReviewPanel } from '@/components/procurement/extend/bounding-box-citations';
import { FileUpload } from '@/components/procurement/extend/file-upload';
import { PdfDropzoneBlock } from '@/components/procurement/extend/pdf-dropzone';

beforeEach(() => {
  installRadixPointerShims();
});

describe('Extend Bounding Box Citations / HumanReviewPanel — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders with default (empty) fields', () => {
    const { container } = render(<HumanReviewPanel />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend File Upload — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders the upload affordance', () => {
    const { container } = render(<FileUpload />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend PDF Dropzone shell — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders (composes FileUpload + PDFViewer)', () => {
    const { container } = render(<PdfDropzoneBlock />);
    expect(container.firstChild).not.toBeNull();
  });
});
