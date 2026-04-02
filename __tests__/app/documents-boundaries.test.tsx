import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DiffError from '@/app/documents/[id]/diff/error';
import DiffLoading from '@/app/documents/[id]/diff/loading';

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

describe('Diff Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<DiffError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<DiffError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the diff review/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<DiffError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<DiffError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /browse', () => {
    render(<DiffError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to browse/i }),
    ).toHaveAttribute('href', '/browse');
  });

  it('calls console.error with the error via useEffect', () => {
    render(<DiffError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Diff review error:', error);
  });
});

describe('Diff Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<DiffLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<DiffLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading diff review',
    );
  });

  it('contains screen-reader text', () => {
    render(<DiffLoading />);
    expect(screen.getByText('Loading diff review...')).toBeInTheDocument();
  });
});
