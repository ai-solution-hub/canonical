import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import DigestError from '@/app/digest/error';
import DigestLoading from '@/app/digest/loading';

describe('Digest Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<DigestError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<DigestError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load your change report/i)
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<DigestError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<DigestError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<DigestError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Digest error:', error);
  });
});

describe('Digest Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<DigestLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<DigestLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading change report'
    );
  });

  it('contains screen-reader text', () => {
    render(<DigestLoading />);
    expect(screen.getByText('Loading change report...')).toBeInTheDocument();
  });
});
