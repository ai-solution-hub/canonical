/**
 * Extend v1 vendor-in smoke test — DOCX/Excel Editor + E-Signature SHELLS
 * (ID-147.6, PRODUCT §F1/§F3). Fork + persistence wiring is ID-147.13/
 * ID-147.14's job — this only proves the vendored-in shells import and
 * render.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { act, render } from '@testing-library/react';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { DocxEditorPreview } from '@/components/procurement/extend/docx-editor';
import { XlsxEditorPreview } from '@/components/procurement/extend/xlsx-editor';
import { ESignatureBlock } from '@/components/procurement/extend/e-signature';
import { PdfBlockResizableShell } from '@/components/procurement/extend/pdf-block-resizable-shell';

beforeEach(() => {
  installRadixPointerShims();
  // jsdom has no layout engine — see viewers.smoke.test.tsx for the same
  // `Element.prototype.scrollTo` stub rationale (ID-147.6).
  Element.prototype.scrollTo = vi.fn();
});

describe('Extend DOCX/Excel Editor shells — vendor-in smoke test (ID-147.6)', () => {
  it('DocxEditorPreview imports and renders with no src', async () => {
    const { container } = render(
      <DocxEditorPreview isDark={false} onIsDarkChange={() => {}} />,
    );
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });

  it('XlsxEditorPreview imports and renders with no src', async () => {
    const { container } = render(
      <XlsxEditorPreview isDark={false} onIsDarkChange={() => {}} />,
    );
    await act(async () => {});
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend E-Signature block shell — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders with no file (Extend ships file?:string with no persistence — the fork is ID-147.14)', () => {
    const { container } = render(<ESignatureBlock />);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend PDF-block resizable shell — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders with minimal left/right panes', () => {
    const { container } = render(
      <PdfBlockResizableShell
        autoSaveId="id-147-6-smoke-test"
        left={<div>left</div>}
        right={<div>right</div>}
      />,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
