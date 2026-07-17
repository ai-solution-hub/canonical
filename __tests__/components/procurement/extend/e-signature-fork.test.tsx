/**
 * E-Signature FORK tests — ID-147 {147.14} (TECH.md §5 "forked
 * e-signature"; PRODUCT.md §F3/§F4/§F5).
 *
 * The vendored `ESignatureBlock` (`e-signature.tsx`, {147.6}) exposes only
 * `file?:string` -- no field-placement data, no persistence. This fork
 * (`ESignatureFork`, a NEW sibling component -- the vendored shell is
 * untouched and stays covered by {147.6}'s own smoke test) adds:
 *  (a) signature-field placement driven from the `fields` prop instead of
 *      a hardcoded default;
 *  (b) an `onSigned` persistence callback wired to
 *      `usePersistSignedDocument` (writes the signed PDF as a
 *      `form_attachments` row, `role='form_source'`);
 *  (c) `canSign` (§F4 admin/editor place/complete gate -- reviewer/viewer
 *      see every field read-only, no sign/save controls);
 *  (d) a soft-error fallback to the read-only `PDFViewer` on
 *      initialisation failure (§F5), never a blank pane.
 *
 * Driving the ACTUAL canvas-drawn-signature capture
 * (`signature_pad`/`ResizeObserver`-gated dialog interior) is out of scope
 * here -- jsdom has no real canvas/layout engine, and the vendored
 * shell's own {147.6} smoke test never opens that dialog either. Tests
 * that need a "field already carries a captured signature" precondition
 * (e.g. the save/persist flow) seed it via the `fields` prop's optional
 * `imageDataUrl` -- a legitimate state (a field signed in an earlier
 * session, reloaded from data) rather than a test-only shortcut.
 */
import type { ComponentProps, ReactNode } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '../../../helpers/radix-pointer-shims';
import { createQueryWrapper } from '../../../helpers/query-wrapper';

vi.mock('@/components/procurement/extend/build-signed-pdf', () => ({
  buildSignedPdfBytes: vi.fn().mockResolvedValue(new Uint8Array([9, 9, 9])),
}));

// `PDFViewer` (`pdf-viewer.tsx`) is a large vendored component with its own
// async PDF-rendering engine (real `fetch`/WASM loading) -- covered by its
// own `pdf-viewer.smoke.test.tsx`. Stubbed here at the module boundary so
// these tests exercise the FORK's own logic (field placement, gating,
// persistence wiring, §F5 fallback) rather than fighting jsdom's lack of a
// PDF rendering engine. The stub still calls `renderPageOverlay` for page 1
// so the field-overlay wiring is exercised for real.
vi.mock('@/components/procurement/extend/pdf-viewer', () => ({
  PDFViewer: ({
    src,
    renderPageOverlay,
  }: {
    src?: string;
    renderPageOverlay?: (props: {
      pageNumber: number;
      pageWidth: number;
      pageHeight: number;
      scale: number;
      rotation: number;
    }) => ReactNode;
  }) => (
    <div data-testid="pdf-viewer-stub" data-src={src ?? ''}>
      {renderPageOverlay?.({
        pageNumber: 1,
        pageWidth: 612,
        pageHeight: 792,
        scale: 1,
        rotation: 0,
      })}
    </div>
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ---------------------------------------------------------------------------
// Import under test — after global mocks are in place
// ---------------------------------------------------------------------------

import {
  ESignatureFork,
  type SignatureFieldPlacement,
} from '@/components/procurement/extend/e-signature-fork';
import { buildSignedPdfBytes } from '@/components/procurement/extend/build-signed-pdf';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FORM_ID = 'a1b2c3d4-0000-4000-8000-000000000001';

const OUR_FIELDS: SignatureFieldPlacement[] = [
  {
    id: 'field-bidder',
    label: "Bidder's authorised signatory",
    page: 1,
    bbox: { x: 60, y: 600, width: 220, height: 50 },
  },
  {
    id: 'field-witness',
    label: 'Witness',
    page: 1,
    bbox: { x: 320, y: 600, width: 220, height: 50 },
  },
];

function renderFork(
  overrides: Partial<ComponentProps<typeof ESignatureFork>> = {},
) {
  const { Wrapper } = createQueryWrapper();
  return render(
    <ESignatureFork
      formId={FORM_ID}
      file="https://example.test/tender.pdf"
      fields={OUR_FIELDS}
      canSign={false}
      {...overrides}
    />,
    { wrapper: Wrapper },
  );
}

function attachmentRowResponse(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 201,
    json: vi.fn().mockResolvedValue({
      id: 'att-uuid-1',
      form_instance_id: FORM_ID,
      engagement_group_id: null,
      role: 'form_source',
      filename: 'signed-document.pdf',
      storage_path: `${FORM_ID}/attachments/att-uuid-1-signed-document.pdf`,
      mime_type: 'application/pdf',
      file_size: 3,
      created_by: 'user-1',
      created_at: '2026-07-16T00:00:00.000Z',
      ...overrides,
    }),
  };
}

beforeEach(() => {
  installRadixPointerShims();
  Element.prototype.scrollTo = vi.fn();
  vi.clearAllMocks();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ESignatureFork — field placement from our data (§F3(a))', () => {
  it('renders the fields passed via props, not a hardcoded default', () => {
    renderFork({ canSign: true });
    const panel = within(screen.getByTestId('signature-fields-panel'));

    expect(
      panel.getByText("Bidder's authorised signatory"),
    ).toBeInTheDocument();
    expect(panel.getByText('Witness')).toBeInTheDocument();
  });

  it('shows an informational empty state, not a crash, when no fields are configured', () => {
    renderFork({ fields: [], canSign: true });

    expect(
      screen.getByText(/no signature fields are configured/i),
    ).toBeInTheDocument();
  });
});

describe('ESignatureFork — admin/editor gating (§F4)', () => {
  it('reviewer/viewer (canSign=false) sees every field read-only, with no sign or save controls', () => {
    renderFork({ canSign: false });

    expect(
      screen.queryByRole('button', { name: /sign/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save signed document/i }),
    ).not.toBeInTheDocument();
    // The field is still visible, just not actionable.
    const panel = within(screen.getByTestId('signature-fields-panel'));
    expect(
      panel.getByText("Bidder's authorised signatory"),
    ).toBeInTheDocument();
  });

  it('admin/editor (canSign=true) can open a field to sign it', async () => {
    const user = userEvent.setup();
    renderFork({ canSign: true });

    const signButtons = screen.getAllByRole('button', { name: /^sign$/i });
    await user.click(signButtons[0]!);

    expect(
      await screen.findByRole('dialog', { name: /add signature/i }),
    ).toBeInTheDocument();
  });
});

describe('ESignatureFork — onSigned persistence (§F3(b))', () => {
  it('persists the merged signed PDF as a form_attachments row (role=form_source, form_instance_id set) and fires onSigned', async () => {
    mockFetch.mockResolvedValueOnce(attachmentRowResponse());
    const onSigned = vi.fn();
    const user = userEvent.setup();

    // A field that already carries a captured signature (§F3(a) "our data"
    // includes prior-session state, not just placement).
    const fieldsWithOneSigned: SignatureFieldPlacement[] = [
      { ...OUR_FIELDS[0]!, imageDataUrl: 'data:image/png;base64,AAA' },
      OUR_FIELDS[1]!,
    ];

    renderFork({ canSign: true, fields: fieldsWithOneSigned, onSigned });

    const saveButton = screen.getByRole('button', {
      name: /save signed document/i,
    });
    expect(saveButton).toBeEnabled();
    await user.click(saveButton);

    await waitFor(() => expect(onSigned).toHaveBeenCalledTimes(1));

    expect(buildSignedPdfBytes).toHaveBeenCalledWith(
      expect.objectContaining({
        file: 'https://example.test/tender.pdf',
        fields: [
          expect.objectContaining({
            page: 1,
            imageDataUrl: 'data:image/png;base64,AAA',
          }),
        ],
      }),
    );

    expect(onSigned).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'form_source',
        form_instance_id: FORM_ID,
      }),
    );

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/procurement/${FORM_ID}/attachments`);
    expect((init.body as FormData).get('role')).toBe('form_source');
  });

  it('cannot save when no field has been signed', () => {
    renderFork({ canSign: true });

    expect(
      screen.getByRole('button', { name: /save signed document/i }),
    ).toBeDisabled();
  });

  it('surfaces the server error inline and calls onPersistError on a failed save', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: vi
        .fn()
        .mockResolvedValue({ error: 'Insufficient role for this action.' }),
    });
    const onPersistError = vi.fn();
    const user = userEvent.setup();

    const fieldsWithOneSigned: SignatureFieldPlacement[] = [
      { ...OUR_FIELDS[0]!, imageDataUrl: 'data:image/png;base64,AAA' },
    ];

    renderFork({
      canSign: true,
      fields: fieldsWithOneSigned,
      onPersistError,
    });

    await user.click(
      screen.getByRole('button', { name: /save signed document/i }),
    );

    expect(
      await screen.findByText('Insufficient role for this action.'),
    ).toBeInTheDocument();
    expect(onPersistError).toHaveBeenCalledTimes(1);
    expect((onPersistError.mock.calls[0]![0] as Error).message).toBe(
      'Insufficient role for this action.',
    );
  });
});

describe('ESignatureFork — soft-error fallback, never blank (§F5)', () => {
  it('falls back to the read-only viewer, with a soft-error notice, when field data fails to initialise', () => {
    const malformedFields = [
      { id: 'bad', label: 'Bad field', page: 1 },
    ] as unknown as SignatureFieldPlacement[];

    const { container } = renderFork({
      canSign: true,
      fields: malformedFields,
    });

    // Never a blank pane.
    expect(container.firstChild).not.toBeNull();
    expect(
      screen.getByText(/could not load/i, { exact: false }),
    ).toBeInTheDocument();
    // No sign/save affordances leaked through from the failed interactive tree.
    expect(
      screen.queryByRole('button', { name: /sign/i }),
    ).not.toBeInTheDocument();
  });
});
