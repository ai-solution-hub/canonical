import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('renders primary CTA as a link when href provided', () => {
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
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // The flex CTA wrapper div should not be in the DOM
    const ctaWrapper = container.querySelector('.flex.flex-wrap');
    expect(ctaWrapper).not.toBeInTheDocument();
  });

  it('renders h2 heading by default (L-1)', () => {
    render(<EmptyState title="Default heading" description="Desc." />);
    expect(
      screen.getByRole('heading', { level: 2, name: 'Default heading' }),
    ).toBeInTheDocument();
  });

  it('renders h3 heading when headingLevel="h3"', () => {
    render(
      <EmptyState
        title="Section heading"
        description="Desc."
        headingLevel="h3"
      />,
    );
    expect(
      screen.getByRole('heading', { level: 3, name: 'Section heading' }),
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

  // M-3: dashed border container per spec §5.2
  it('renders container with dashed border (M-3)', () => {
    const { container } = render(
      <EmptyState title="Bordered" description="Has dashed border." />,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('border-dashed');
    expect(wrapper.className).toContain('rounded-lg');
    expect(wrapper.className).toContain('border-border');
  });

  // M-3: onClick CTA support
  it('renders primary CTA as button when onClick provided (no href)', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();

    render(
      <EmptyState
        title="Action"
        description="Desc."
        primaryCta={{ label: 'Do something', onClick: handleClick }}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Do something' });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(handleClick).toHaveBeenCalledOnce();
  });

  it('renders CTA as link (not button) when both href and onClick provided', () => {
    const handleClick = vi.fn();

    render(
      <EmptyState
        title="Combined"
        description="Desc."
        primaryCta={{
          label: 'Go there',
          href: '/somewhere',
          onClick: handleClick,
        }}
      />,
    );

    // href takes precedence — renders as link
    const link = screen.getByRole('link', { name: 'Go there' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/somewhere');
  });

  it('renders secondary CTA with onClick as button', async () => {
    const handleClick = vi.fn();
    const user = userEvent.setup();

    render(
      <EmptyState
        title="Secondary action"
        description="Desc."
        secondaryCta={{ label: 'Cancel', onClick: handleClick }}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Cancel' });
    expect(btn).toBeInTheDocument();
    await user.click(btn);
    expect(handleClick).toHaveBeenCalledOnce();
  });
});
