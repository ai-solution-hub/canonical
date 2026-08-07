import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/components/okf/bundle-viewer', () => ({
  BundleViewer: ({ bundleId }: { bundleId: string }) => (
    <div data-testid="mock-bundle-viewer">{bundleId}</div>
  ),
}));

import OkfBundlePage from '@/app/okf/[bundleId]/page';

describe('OkfBundlePage', () => {
  it('resolves the bundleId route param and renders BundleViewer with it', async () => {
    const page = await OkfBundlePage({
      params: Promise.resolve({ bundleId: 'first-client' }),
    });
    render(page);

    expect(screen.getByTestId('mock-bundle-viewer')).toHaveTextContent(
      'first-client',
    );
  });
});
