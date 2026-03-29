import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import RootError from '@/app/error';
import DashboardLoading from '@/app/loading';

// Mock next/link
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe('Root Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<RootError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<RootError error={error} reset={reset} />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<RootError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<RootError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<RootError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Page error:', error);
  });
});

describe('Root Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<DashboardLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<DashboardLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading dashboard'
    );
  });

  it('contains screen-reader text', () => {
    render(<DashboardLoading />);
    expect(screen.getByText('Loading dashboard...')).toBeInTheDocument();
  });
});
