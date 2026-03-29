import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import CoverageError from '@/app/coverage/error';
import CoverageLoading from '@/app/coverage/loading';

describe('Coverage Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<CoverageError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<CoverageError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load this page/i)
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<CoverageError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<CoverageError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<CoverageError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Page error:', error);
  });
});

describe('Coverage Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<CoverageLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<CoverageLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading coverage analysis'
    );
  });

  it('contains screen-reader text', () => {
    render(<CoverageLoading />);
    expect(screen.getByText('Loading coverage analysis...')).toBeInTheDocument();
  });
});
