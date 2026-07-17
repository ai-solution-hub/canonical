/**
 * PdfDocument (components/reader/pdf-document.tsx) — controlled-page mode,
 * per-page overlay slot, and TextLayer-ready callback.
 *
 * ID-145 {145.47} (TECH §3/§4, PRODUCT §C1-C4/§D1-D5) extends the
 * previously-uncontrolled `PdfDocument` (its only prior caller,
 * `BinarySide`, never needed external page control) with three additive,
 * backward-compatible props so `SpatialOverlay` (147-H) and B1 citation
 * derivation (147-I) can drive/observe it from outside:
 *   - `currentPage`/`onPageChange` — controlled page navigation.
 *   - `renderPageOverlay` — content layered inside the rendered page's own
 *     positioned wrapper (a `SpatialOverlay` box layer, in production).
 *   - `onTextLayerRenderSuccess` — the rendered TextLayer root Element, once
 *     available, for B1's `Range`/`getClientRects()` derivation.
 *
 * `react-pdf`'s `Document`/`Page` are mocked — this suite verifies
 * `PdfDocument`'s own prop wiring, not react-pdf's rendering internals.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PdfDocument } from '@/components/reader/pdf-document';

vi.mock('@/lib/pdf-worker', () => ({}));

vi.mock('react-pdf', () => ({
  Document: ({
    children,
    onLoadSuccess,
  }: {
    children: React.ReactNode;
    onLoadSuccess?: (info: { numPages: number }) => void;
  }) => {
    onLoadSuccess?.({ numPages: 5 });
    return <div data-testid="pdf-document-mock">{children}</div>;
  },
  Page: ({
    pageNumber,
    children,
    onLoadSuccess,
    onRenderTextLayerSuccess,
    inputRef,
  }: {
    pageNumber: number;
    children?: React.ReactNode;
    onLoadSuccess?: (page: { originalWidth: number }) => void;
    onRenderTextLayerSuccess?: () => void;
    inputRef?: React.Ref<HTMLDivElement>;
  }) => {
    onLoadSuccess?.({ originalWidth: 600 });
    return (
      <div ref={inputRef} data-testid={`pdf-page-${pageNumber}`}>
        <div className="react-pdf__Page__textContent">page text</div>
        <button
          type="button"
          data-testid="fire-text-layer-success"
          onClick={() => onRenderTextLayerSuccess?.()}
        >
          fire text layer success
        </button>
        {children}
      </div>
    );
  },
}));

describe('PdfDocument — controlled page mode', () => {
  it('renders the page named by the controlled currentPage prop, not internal state', () => {
    render(
      <PdfDocument sourceUrl="https://example.test/doc.pdf" currentPage={3} />,
    );

    expect(screen.getByTestId('pdf-page-3')).toBeInTheDocument();
  });

  it('reports navigation intents via onPageChange rather than changing the displayed page itself', () => {
    const onPageChange = vi.fn();
    render(
      <PdfDocument
        sourceUrl="https://example.test/doc.pdf"
        currentPage={2}
        onPageChange={onPageChange}
      />,
    );

    fireEvent.click(screen.getByLabelText('Next page'));

    expect(onPageChange).toHaveBeenCalledWith(3);
    // Controlled: the displayed page does NOT change until the host feeds
    // the new value back in via the `currentPage` prop.
    expect(screen.getByTestId('pdf-page-2')).toBeInTheDocument();
  });

  it('still manages its own page state when uncontrolled (currentPage omitted)', () => {
    render(<PdfDocument sourceUrl="https://example.test/doc.pdf" />);

    expect(screen.getByTestId('pdf-page-1')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Next page'));
    expect(screen.getByTestId('pdf-page-2')).toBeInTheDocument();
  });
});

describe('PdfDocument — renderPageOverlay', () => {
  it('renders overlay content inside the current page, keyed to that page number', () => {
    render(
      <PdfDocument
        sourceUrl="https://example.test/doc.pdf"
        currentPage={4}
        renderPageOverlay={(page) => (
          <div data-testid="overlay-slot">overlay for page {page}</div>
        )}
      />,
    );

    const page = screen.getByTestId('pdf-page-4');
    expect(page).toContainElement(screen.getByTestId('overlay-slot'));
    expect(screen.getByTestId('overlay-slot')).toHaveTextContent(
      'overlay for page 4',
    );
  });
});

describe('PdfDocument — onTextLayerRenderSuccess', () => {
  it('fires with the current page number and the rendered TextLayer root element', () => {
    const onTextLayerRenderSuccess = vi.fn();
    render(
      <PdfDocument
        sourceUrl="https://example.test/doc.pdf"
        currentPage={1}
        onTextLayerRenderSuccess={onTextLayerRenderSuccess}
      />,
    );

    fireEvent.click(screen.getByTestId('fire-text-layer-success'));

    expect(onTextLayerRenderSuccess).toHaveBeenCalledTimes(1);
    const [page, root] = onTextLayerRenderSuccess.mock.calls[0];
    expect(page).toBe(1);
    expect(root).toBeInstanceOf(HTMLElement);
    expect((root as HTMLElement).className).toContain(
      'react-pdf__Page__textContent',
    );
  });
});
