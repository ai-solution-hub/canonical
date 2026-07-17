/**
 * Extend v1 vendor-in smoke test — genuine shared shadcn primitives that
 * legitimately stay in `components/ui/` (ID-147.6): scroll-area, spinner,
 * toggle. Pulled via the `extend-hq/ui` registry but served as Radix-based
 * variants matching our `components.json` (no Hugeicons — this IS shared
 * chrome, so the testStrategy "no Hugeicons import remains in shared
 * chrome" bar applies directly).
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render } from '@testing-library/react';

import { ScrollArea } from '@/components/ui/scroll-area';
import { Spinner } from '@/components/ui/spinner';
import { Toggle } from '@/components/ui/toggle';

describe('Extend-vendored shared primitives — vendor-in smoke test (ID-147.6)', () => {
  it('ScrollArea imports and renders', () => {
    const { container } = render(
      <ScrollArea className="h-20">content</ScrollArea>,
    );
    expect(container.firstChild).not.toBeNull();
  });

  it('Spinner imports and renders', () => {
    const { container } = render(<Spinner />);
    expect(container.firstChild).not.toBeNull();
  });

  it('Toggle imports and renders', () => {
    const { container } = render(<Toggle aria-label="toggle">A</Toggle>);
    expect(container.firstChild).not.toBeNull();
  });
});
