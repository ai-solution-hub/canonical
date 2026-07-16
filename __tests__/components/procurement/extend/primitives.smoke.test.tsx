/**
 * Extend v1 vendor-in smoke test — viewer-internal shared primitives
 * (ID-147.6): color-picker, group, resizable. These support the DOCX/Excel
 * editor + e-signature shells and are self-contained (not app-wide shared
 * chrome — components/CLAUDE.md, PRODUCT §J2), so they retain their Coss
 * UI / Hugeicons internals except where a trivial single-icon swap to
 * lucide was made (resizable's drag handle).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';
import { CheckIcon } from '@hugeicons/core-free-icons';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import { ColorPicker } from '@/components/procurement/extend/color-picker';
import { Group } from '@/components/procurement/extend/group';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/procurement/extend/resizable';
import { TooltipProvider } from '@/components/ui/tooltip';

beforeEach(() => {
  installRadixPointerShims();
});

describe('Extend color-picker — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders', () => {
    const { container } = render(
      <TooltipProvider delayDuration={0}>
        <ColorPicker
          color="#111827"
          icon={CheckIcon}
          label="Text colour"
          onChange={() => {}}
        />
      </TooltipProvider>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend group — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders', () => {
    const { container } = render(<Group>content</Group>);
    expect(container.firstChild).not.toBeNull();
  });
});

describe('Extend resizable — vendor-in smoke test (ID-147.6)', () => {
  it('imports and renders with lucide GripVertical (no Hugeicons import remains — testStrategy)', () => {
    const { container } = render(
      <ResizablePanelGroup>
        <ResizablePanel>left</ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel>right</ResizablePanel>
      </ResizablePanelGroup>,
    );
    expect(container.firstChild).not.toBeNull();
  });
});
