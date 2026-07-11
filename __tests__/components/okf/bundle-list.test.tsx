/**
 * {132.32} G-LANDING-IMPL — `<BundleList>` (LI-14 enumerate-all list,
 * LI-4(a)/(b) graceful empty states, LI-18 graph-viewer link).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BundleList } from '@/components/okf/bundle-list';

describe('BundleList', () => {
  it('renders the "not configured" empty state (LI-4(a))', () => {
    render(
      <BundleList
        bundles={[]}
        configured={false}
        selectedBundleId={null}
        onSelectBundle={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/no concepts have been published yet/i),
    ).toBeInTheDocument();
  });

  it('renders the "configured but empty" empty state (LI-4(b))', () => {
    render(
      <BundleList
        bundles={[]}
        configured={true}
        selectedBundleId={null}
        onSelectBundle={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/no bundles have been added yet/i),
    ).toBeInTheDocument();
  });

  it('lists every bundle, each with a link to its graph viewer (LI-14/LI-18)', () => {
    render(
      <BundleList
        bundles={['alpha-client', 'zeta-client']}
        configured={true}
        selectedBundleId={null}
        onSelectBundle={vi.fn()}
      />,
    );
    expect(screen.getByText('alpha-client')).toBeInTheDocument();
    expect(screen.getByText('zeta-client')).toBeInTheDocument();
    const graphLinks = screen.getAllByRole('link', { name: /graph view/i });
    expect(graphLinks).toHaveLength(2);
    expect(graphLinks[0]).toHaveAttribute('href', '/okf/alpha-client');
  });

  it('calls onSelectBundle when a bundle is chosen for the file explorer', async () => {
    const onSelectBundle = vi.fn();
    render(
      <BundleList
        bundles={['alpha-client']}
        configured={true}
        selectedBundleId={null}
        onSelectBundle={onSelectBundle}
      />,
    );
    screen.getByRole('button', { name: /browse files/i }).click();
    expect(onSelectBundle).toHaveBeenCalledWith('alpha-client');
  });

  it('marks the selected bundle as current', () => {
    render(
      <BundleList
        bundles={['alpha-client']}
        configured={true}
        selectedBundleId="alpha-client"
        onSelectBundle={vi.fn()}
      />,
    );
    expect(
      screen.getByRole('button', { name: /browse files/i }),
    ).toHaveAttribute('aria-current', 'true');
  });
});
