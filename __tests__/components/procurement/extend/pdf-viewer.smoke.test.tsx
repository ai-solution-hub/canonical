/**
 * Extend v1 vendor-in smoke test — PDF Viewer (ID-147.6).
 *
 * Proves the relocated `components/procurement/extend/pdf-viewer.tsx` (moved
 * out of `components/ui/` per `components/CLAUDE.md` domain-subdir policy —
 * see `docs/extend-registry-provenance.md`) still imports and renders after
 * the relocation + import-path rewrite. Deliberately narrow: no `src`, so no
 * real PDF load is attempted — it only proves the module graph resolves and
 * the component mounts without throwing.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';

import { PDFViewer } from '@/components/procurement/extend/pdf-viewer';
import { ReactDocxViewer } from '@extend-ai/react-docx';
import { XlsxViewer } from '@extend-ai/react-xlsx';

describe('Extend PDF Viewer — vendor-in smoke test (ID-147.6)', () => {
  it('imports the relocated pdf-viewer source without a module resolution error', () => {
    expect(PDFViewer).toBeDefined();
  });

  it('renders without an unhandled exception when given no document', () => {
    const { container } = render(<PDFViewer className="h-[400px]" />);
    expect(container.firstChild).not.toBeNull();
  });

  it('resolves @extend-ai/react-docx and @extend-ai/react-xlsx at their pinned versions', () => {
    expect(ReactDocxViewer).toBeDefined();
    expect(XlsxViewer).toBeDefined();
  });
});
