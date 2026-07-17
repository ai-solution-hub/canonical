/**
 * Extend v1 vendor-in smoke test — document viewers + navigation shells
 * (ID-147.6). Each vendored component imports and renders without an
 * unhandled exception (testStrategy). No real document `src`/data is
 * supplied — these are structural mount checks, not viewer behaviour tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { DocxViewerPreview } from '@/components/procurement/extend/docx-viewer';
import { XlsxViewerPreview } from '@/components/procurement/extend/xlsx-viewer';
import { CsvViewer } from '@/components/procurement/extend/csv-viewer';
import {
  DocumentViewerThumbnailSidebar,
  DocumentViewerSidebarSkeleton,
} from '@/components/procurement/extend/document-viewer-sidebar';
import { FileThumbnail } from '@/components/procurement/extend/file-thumbnail';
import * as docxAnnotationCard from '@/components/procurement/extend/docx-annotation-card';

beforeEach(() => {
  installRadixPointerShims();
  // jsdom has no layout engine, so `Element.prototype.scrollTo` is
  // unimplemented — the vendored viewers call it on their scroll-viewport
  // ref (now correctly wired via components/ui/scroll-area.tsx's
  // `viewportRef` forwarding, ID-147.6) to reset scroll position on mount.
  Element.prototype.scrollTo = vi.fn();
});

describe('Extend document viewers — vendor-in smoke test (ID-147.6)', () => {
  it('DocxViewerPreview imports and renders with no src', async () => {
    const { container } = render(
      <DocxViewerPreview isDark={false} onIsDarkChange={() => {}} />,
    );
    // Flushes the component's internal promise-queued "no document" load
    // effect so its state update lands inside `act()`.
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });

  it('XlsxViewerPreview imports and renders with no src', async () => {
    const { container } = render(
      <XlsxViewerPreview isDark={false} onIsDarkChange={() => {}} />,
    );
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });

  it('CsvViewer imports and renders with no data', () => {
    const { container } = render(<CsvViewer />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend Document-Viewer-Sidebar + File-Thumbnail — vendor-in smoke test (ID-147.6)', () => {
  it('DocumentViewerThumbnailSidebar imports and renders', () => {
    const { container } = render(
      <DocumentViewerThumbnailSidebar inline open>
        <div>thumbnails</div>
      </DocumentViewerThumbnailSidebar>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('DocumentViewerSidebarSkeleton imports and renders (inline mode)', () => {
    const { container } = render(<DocumentViewerSidebarSkeleton inline />);
    expect(container.firstChild).not.toBeNull();
  });

  it('FileThumbnail imports and renders (loading + no-preview states — we supply the preview image per §A9)', () => {
    const { container } = render(
      <FileThumbnail
        file={{ name: 'tender-document.pdf', type: 'application/pdf' }}
        isLoading
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend docx-annotation-card — vendor-in smoke test (ID-147.6)', () => {
  it('imports without a module resolution error (consumed internally by docx-viewer/docx-editor, no standalone component export)', () => {
    expect(
      docxAnnotationCard.createDocxTrackedChangeCardRenderer,
    ).toBeDefined();
    expect(docxAnnotationCard.createDocxCommentCardRenderer).toBeDefined();
  });
});
