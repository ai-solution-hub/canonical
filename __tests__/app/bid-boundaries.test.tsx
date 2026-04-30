import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// WP2 (S19): error boundaries now route via @/lib/logger/client (logger.error)
// instead of console.error. Mock the client logger surface so we can assert
// the structured `{ err }` shape directly.
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

import BidError from '@/app/bid/error';
import BidLoading from '@/app/bid/loading';
import BidDetailError from '@/app/bid/[id]/error';
import BidDetailLoading from '@/app/bid/[id]/loading';
import BidSessionError from '@/app/bid/[id]/session/error';
import BidSessionLoading from '@/app/bid/[id]/session/loading';
import TemplateCompletionError from '@/app/bid/[id]/templates/error';
import TemplateCompletionLoading from '@/app/bid/[id]/templates/loading';

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

// --- app/bid/error.tsx ---
describe('Bid Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<BidError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<BidError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load this bid/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<BidError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<BidError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to home', () => {
    render(<BidError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /return home/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<BidError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Bid error',
    );
  });
});

// --- app/bid/loading.tsx ---
describe('Bid Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<BidLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<BidLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading bids',
    );
  });

  it('contains screen-reader text', () => {
    render(<BidLoading />);
    expect(screen.getByText('Loading bids...')).toBeInTheDocument();
  });
});

// --- app/bid/[id]/error.tsx ---
describe('Bid Detail Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<BidDetailError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<BidDetailError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load bid details/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<BidDetailError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<BidDetailError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /bid', () => {
    render(<BidDetailError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /back to bids/i })).toHaveAttribute(
      'href',
      '/bid',
    );
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<BidDetailError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Bid detail error',
    );
  });
});

// --- app/bid/[id]/loading.tsx ---
describe('Bid Detail Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<BidDetailLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<BidDetailLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading bid details',
    );
  });

  it('contains screen-reader text', () => {
    render(<BidDetailLoading />);
    expect(screen.getByText('Loading bid details...')).toBeInTheDocument();
  });
});

// --- app/bid/[id]/session/error.tsx ---
describe('Bid Session Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<BidSessionError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<BidSessionError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the drafting session/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<BidSessionError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<BidSessionError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /bid', () => {
    render(<BidSessionError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /back to bids/i })).toHaveAttribute(
      'href',
      '/bid',
    );
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<BidSessionError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Bid session error',
    );
  });
});

// --- app/bid/[id]/session/loading.tsx ---
describe('Bid Session Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<BidSessionLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<BidSessionLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading drafting session',
    );
  });

  it('contains screen-reader text', () => {
    render(<BidSessionLoading />);
    expect(screen.getByText('Loading drafting session...')).toBeInTheDocument();
  });
});

// --- app/bid/[id]/templates/error.tsx ---
describe('Template Completion Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<TemplateCompletionError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<TemplateCompletionError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load template completion/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<TemplateCompletionError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<TemplateCompletionError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /bid', () => {
    render(<TemplateCompletionError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /back to bids/i })).toHaveAttribute(
      'href',
      '/bid',
    );
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<TemplateCompletionError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Template completion error',
    );
  });
});

// --- app/bid/[id]/templates/loading.tsx ---
describe('Template Completion Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<TemplateCompletionLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<TemplateCompletionLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading template completion',
    );
  });

  it('contains screen-reader text', () => {
    render(<TemplateCompletionLoading />);
    expect(
      screen.getByText('Loading template completion...'),
    ).toBeInTheDocument();
  });
});
