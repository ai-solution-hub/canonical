import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LoginError from '@/app/login/error';
import LoginLoading from '@/app/login/loading';

describe('Login Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<LoginError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<LoginError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the sign-in page/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<LoginError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<LoginError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('does not have a navigation link (login is the entry point)', () => {
    render(<LoginError error={error} reset={reset} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<LoginError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Login error:', error);
  });
});

describe('Login Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<LoginLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<LoginLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading sign-in',
    );
  });

  it('contains screen-reader text', () => {
    render(<LoginLoading />);
    expect(screen.getByText('Loading sign-in...')).toBeInTheDocument();
  });
});
