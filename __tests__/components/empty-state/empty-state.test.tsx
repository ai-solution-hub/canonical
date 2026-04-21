import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));

import { EmptyState } from '@/components/empty-state/empty-state';

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(
      <EmptyState title="No items yet" description="Add your first item." />,
    );
    expect(screen.getByText('No items yet')).toBeInTheDocument();
    expect(screen.getByText('Add your first item.')).toBeInTheDocument();
  });

  it('renders primary CTA as a link when provided', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here."
        primaryCta={{ label: 'Add item', href: '/items/new' }}
      />,
    );
    const link = screen.getByRole('link', { name: 'Add item' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/items/new');
  });

  it('renders secondary CTA alongside primary', () => {
    render(
      <EmptyState
        title="Empty"
        description="Nothing here."
        primaryCta={{ label: 'Add item', href: '/items/new' }}
        secondaryCta={{ label: 'Learn more', href: '/help' }}
      />,
    );
    expect(screen.getByRole('link', { name: 'Add item' })).toBeInTheDocument();
    const secondary = screen.getByRole('link', { name: 'Learn more' });
    expect(secondary).toBeInTheDocument();
    expect(secondary).toHaveAttribute('href', '/help');
  });

  it('omits CTA row when neither primary nor secondary provided', () => {
    const { container } = render(
      <EmptyState title="Empty" description="Nothing here." />,
    );
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    // The flex CTA wrapper div should not be in the DOM
    const ctaWrapper = container.querySelector('.flex.flex-wrap');
    expect(ctaWrapper).not.toBeInTheDocument();
  });

  it('renders h3 heading by default', () => {
    render(<EmptyState title="Default heading" description="Desc." />);
    expect(
      screen.getByRole('heading', { level: 3, name: 'Default heading' }),
    ).toBeInTheDocument();
  });

  it('renders h2 heading when headingLevel="h2"', () => {
    render(
      <EmptyState
        title="Section heading"
        description="Desc."
        headingLevel="h2"
      />,
    );
    expect(
      screen.getByRole('heading', { level: 2, name: 'Section heading' }),
    ).toBeInTheDocument();
  });

  it('applies role=status and aria-live=polite on variant="filter-empty"', () => {
    const { container } = render(
      <EmptyState
        title="No results"
        description="Try different filters."
        variant="filter-empty"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).toHaveAttribute('role', 'status');
    expect(wrapper).toHaveAttribute('aria-live', 'polite');
  });

  it('does NOT apply role/aria-live on variant="first-run" (default)', () => {
    const { container } = render(
      <EmptyState title="Welcome" description="Get started." />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper).not.toHaveAttribute('role');
    expect(wrapper).not.toHaveAttribute('aria-live');
  });

  it('renders icon with aria-hidden when provided', () => {
    render(
      <EmptyState
        title="Empty"
        description="Desc."
        icon={<svg data-testid="test-icon" />}
      />,
    );
    expect(screen.getByTestId('test-icon')).toBeInTheDocument();
    const iconWrapper = screen.getByTestId('test-icon').parentElement;
    expect(iconWrapper).toHaveAttribute('aria-hidden', 'true');
  });

  it('omits icon block when not provided', () => {
    const { container } = render(
      <EmptyState title="Empty" description="Desc." />,
    );
    const ariaHidden = container.querySelector('[aria-hidden="true"]');
    expect(ariaHidden).not.toBeInTheDocument();
  });

  it('applies className prop to the container', () => {
    const { container } = render(
      <EmptyState
        title="Empty"
        description="Desc."
        className="mt-8 custom-class"
      />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('mt-8');
    expect(wrapper.className).toContain('custom-class');
  });

  it('renders without error when only required props provided', () => {
    const { container } = render(
      <EmptyState title="Minimal" description="Only required props." />,
    );
    expect(container.firstElementChild).toBeInTheDocument();
    expect(screen.getByText('Minimal')).toBeInTheDocument();
    expect(screen.getByText('Only required props.')).toBeInTheDocument();
  });
});
