/**
 * ItemBreadcrumb Component Tests
 *
 * Tests breadcrumb navigation for item detail page — Q&A pair breadcrumbs
 * linking to Q&A Library, and standard BreadcrumbNav for other content types.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

vi.mock('@/components/shell/breadcrumb-nav', () => ({
  BreadcrumbNav: ({
    domain,
    title,
  }: {
    domain: string | null;
    title: string;
  }) => (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumb-nav"
      data-domain={domain}
      data-title={title}
    >
      BreadcrumbNav
    </nav>
  ),
}));

import { ItemBreadcrumb } from '@/components/item-detail/item-breadcrumb';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemBreadcrumb', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows "Q&A Library" link for Q&A pairs', () => {
    render(
      <ItemBreadcrumb
        isQAPair={true}
        primaryDomain="Corporate"
        title="Test Q"
      />,
    );
    const link = screen.getByText('Q&A Library');
    expect(link).toBeInTheDocument();
    expect(link.closest('a')).toHaveAttribute('href', '/library');
  });

  it('shows domain in breadcrumb for Q&A pairs', () => {
    render(
      <ItemBreadcrumb
        isQAPair={true}
        primaryDomain="Technical"
        title="Test Q"
      />,
    );
    expect(screen.getByText('Technical')).toBeInTheDocument();
  });

  it('uses BreadcrumbNav for non-QA items', () => {
    render(
      <ItemBreadcrumb
        isQAPair={false}
        primaryDomain="Corporate"
        title="My Article"
      />,
    );
    expect(screen.getByTestId('breadcrumb-nav')).toBeInTheDocument();
    expect(screen.queryByText('Q&A Library')).not.toBeInTheDocument();
  });

  it('shows correct domain value on BreadcrumbNav', () => {
    render(
      <ItemBreadcrumb
        isQAPair={false}
        primaryDomain="Technical"
        title="Article"
      />,
    );
    expect(screen.getByTestId('breadcrumb-nav')).toHaveAttribute(
      'data-domain',
      'Technical',
    );
  });

  it('has aria-label="Breadcrumb"', () => {
    render(
      <ItemBreadcrumb isQAPair={true} primaryDomain={null} title="Test" />,
    );
    expect(screen.getByLabelText('Breadcrumb')).toBeInTheDocument();
  });
});
