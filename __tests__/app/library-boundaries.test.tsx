import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import LibraryError from '@/app/library/error';
import LibraryLoading from '@/app/library/loading';

describe('Library Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<LibraryError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<LibraryError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the q&a library/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<LibraryError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<LibraryError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<LibraryError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Q&A Library error:', error);
  });
});

describe('Library Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<LibraryLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<LibraryLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading Q&A library',
    );
  });

  it('contains screen-reader text', () => {
    render(<LibraryLoading />);
    expect(screen.getByText('Loading Q&A library...')).toBeInTheDocument();
  });
});
