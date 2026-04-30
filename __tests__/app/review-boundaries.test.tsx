import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// WP2 (S19): error boundaries now route via @/lib/logger/client (logger.error)
// instead of console.error.
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  fatal: vi.fn(),
  trace: vi.fn(),
}));

vi.mock('@/lib/logger/client', () => ({
  logger: loggerMocks,
}));

import ReviewError from '@/app/review/error';
import ReviewLoading from '@/app/review/loading';

describe('Review Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ReviewError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ReviewError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the review queue/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ReviewError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ReviewError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<ReviewError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Review error',
    );
  });
});

describe('Review Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ReviewLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<ReviewLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading review queue',
    );
  });

  it('contains screen-reader text', () => {
    render(<ReviewLoading />);
    expect(screen.getByText('Loading review queue...')).toBeInTheDocument();
  });
});
