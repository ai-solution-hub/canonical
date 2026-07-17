/**
 * Viewer state contracts (ID-147.18, PRODUCT.md §B6/§B7).
 *
 * `DocumentViewerState` is the STATE layer wrapping the ID-147.6 vendored
 * PDF/DOCX/XLSX/CSV viewers: it owns the loading -> error(+retry) -> ready
 * lifecycle around resolving a document's `src` (§B6), and gates on
 * viewer-type support + catches a corrupt-file render failure with an
 * explicit "cannot preview" + download fallback (§B7) — never a blank pane.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  DocumentViewerState,
  resolveViewerKind,
  ViewerErrorState,
  ViewerLoadingState,
  ViewerUnsupportedState,
} from '@/components/procurement/extend/viewer-states';

function ThrowingViewer(): React.ReactElement {
  throw new Error('embedpdf: corrupt document stream');
}

describe('resolveViewerKind — §B1/§B7 type -> viewer mapping', () => {
  it('resolves a PDF mime type to the pdf viewer', () => {
    expect(resolveViewerKind({ mimeType: 'application/pdf' })).toBe('pdf');
  });

  it('resolves a DOCX mime type to the docx viewer', () => {
    expect(
      resolveViewerKind({
        mimeType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe('docx');
  });

  it('resolves an XLSX mime type to the xlsx viewer', () => {
    expect(
      resolveViewerKind({
        mimeType:
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
    ).toBe('xlsx');
  });

  it('resolves a CSV mime type to the csv viewer', () => {
    expect(resolveViewerKind({ mimeType: 'text/csv' })).toBe('csv');
  });

  it('falls back to the filename extension when the mime type is missing', () => {
    expect(resolveViewerKind({ fileName: 'tender.pdf' })).toBe('pdf');
    expect(resolveViewerKind({ fileName: 'schedule.xlsx' })).toBe('xlsx');
  });

  it('returns null for a document type with no viewer', () => {
    expect(
      resolveViewerKind({ mimeType: 'application/zip', fileName: 'a.zip' }),
    ).toBeNull();
  });

  it('returns null when neither mime type nor filename is provided', () => {
    expect(resolveViewerKind({})).toBeNull();
  });
});

describe('ViewerLoadingState — §B6 loading affordance', () => {
  it('renders a non-blank loading message', () => {
    const { container } = render(<ViewerLoadingState />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(container.textContent).not.toBe('');
  });
});

describe('ViewerErrorState — §B6 soft error + retry, non-colour-only', () => {
  it('renders the error message alongside an icon (not colour-only) and a retry affordance', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <ViewerErrorState
        message="We couldn't load this document."
        onRetry={onRetry}
      />,
    );

    expect(
      screen.getByText("We couldn't load this document."),
    ).toBeInTheDocument();
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toBe('');
  });

  it('invokes onRetry when the retry affordance is activated', async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(<ViewerErrorState message="Failed." onRetry={onRetry} />);

    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});

describe('ViewerUnsupportedState — §B7 cannot-preview + download fallback', () => {
  it('shows an explicit cannot-preview message and a download affordance, never a blank render', () => {
    const { container } = render(
      <ViewerUnsupportedState
        fileName="legacy-brochure.zip"
        downloadHref="/api/procurement/files/legacy-brochure.zip"
      />,
    );

    expect(screen.getByText(/cannot preview/i)).toBeInTheDocument();
    const downloadLink = screen.getByRole('link', { name: /download/i });
    expect(downloadLink).toHaveAttribute(
      'href',
      '/api/procurement/files/legacy-brochure.zip',
    );
    expect(container.querySelector('svg')).not.toBeNull();
    expect(container.textContent).not.toBe('');
  });
});

describe('DocumentViewerState — §B6/§B7 orchestration', () => {
  it('shows loading while the document src resolves, then renders the viewer', async () => {
    let resolveSrc!: (src: string) => void;
    const loadSrc = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveSrc = resolve;
        }),
    );
    const renderViewer = vi.fn((src: string) => <div>Viewer for {src}</div>);

    render(
      <DocumentViewerState
        fileName="tender.pdf"
        mimeType="application/pdf"
        downloadHref="/download/tender.pdf"
        loadSrc={loadSrc}
        renderViewer={renderViewer}
      />,
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    expect(renderViewer).not.toHaveBeenCalled();

    await act(async () => {
      resolveSrc('blob:tender-src');
    });

    await waitFor(() => {
      expect(
        screen.getByText('Viewer for blob:tender-src'),
      ).toBeInTheDocument();
    });
  });

  it('shows a soft error with retry when the document fails to load, and retry re-attempts it', async () => {
    const loadSrc = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce('blob:tender-src');
    const renderViewer = vi.fn((src: string) => <div>Viewer for {src}</div>);
    const user = userEvent.setup();

    render(
      <DocumentViewerState
        fileName="tender.pdf"
        mimeType="application/pdf"
        downloadHref="/download/tender.pdf"
        loadSrc={loadSrc}
        renderViewer={renderViewer}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /try again/i }),
      ).toBeInTheDocument();
    });
    // Never a blank pane while the load has failed.
    expect(document.body.textContent).not.toBe('');

    await user.click(screen.getByRole('button', { name: /try again/i }));

    await waitFor(() => {
      expect(
        screen.getByText('Viewer for blob:tender-src'),
      ).toBeInTheDocument();
    });
    expect(loadSrc).toHaveBeenCalledTimes(2);
  });

  it('shows cannot-preview + download for a document type with no matching viewer, without attempting to load it', () => {
    const loadSrc = vi.fn();
    const renderViewer = vi.fn();

    render(
      <DocumentViewerState
        fileName="archive.zip"
        mimeType="application/zip"
        downloadHref="/download/archive.zip"
        loadSrc={loadSrc}
        renderViewer={renderViewer}
      />,
    );

    expect(screen.getByText(/cannot preview/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      '/download/archive.zip',
    );
    expect(loadSrc).not.toHaveBeenCalled();
    expect(renderViewer).not.toHaveBeenCalled();
  });

  it('falls back to cannot-preview + download when a corrupt file makes the viewer itself throw while rendering', async () => {
    const loadSrc = vi.fn().mockResolvedValue('blob:corrupt-src');

    render(
      <DocumentViewerState
        fileName="corrupt.pdf"
        mimeType="application/pdf"
        downloadHref="/download/corrupt.pdf"
        loadSrc={loadSrc}
        renderViewer={() => <ThrowingViewer />}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/cannot preview/i)).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: /download/i })).toHaveAttribute(
      'href',
      '/download/corrupt.pdf',
    );
    // Never a blank pane on a render-time failure either.
    expect(document.body.textContent).not.toBe('');
  });
});
