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

import ProcurementError from '@/app/procurement/error';
import ProcurementLoading from '@/app/procurement/loading';
import ProcurementDetailError from '@/app/procurement/[id]/error';
import ProcurementDetailLoading from '@/app/procurement/[id]/loading';
import ProcurementSessionError from '@/app/procurement/[id]/session/error';
import ProcurementSessionLoading from '@/app/procurement/[id]/session/loading';
import TemplateCompletionError from '@/app/procurement/[id]/templates/error';
import TemplateCompletionLoading from '@/app/procurement/[id]/templates/loading';

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
describe('Procurement Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ProcurementError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ProcurementError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load this procurement/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ProcurementError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ProcurementError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to home', () => {
    render(<ProcurementError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /return home/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<ProcurementError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Procurement error',
    );
  });
});

// --- app/bid/loading.tsx ---
describe('Procurement Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ProcurementLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<ProcurementLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading procurement items',
    );
  });

  it('contains screen-reader text', () => {
    render(<ProcurementLoading />);
    expect(
      screen.getByText('Loading procurement items...'),
    ).toBeInTheDocument();
  });
});

// --- app/bid/[id]/error.tsx ---
describe('Procurement Detail Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ProcurementDetailError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ProcurementDetailError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load procurement details/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ProcurementDetailError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ProcurementDetailError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /bid', () => {
    render(<ProcurementDetailError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to procurement/i }),
    ).toHaveAttribute('href', '/procurement');
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<ProcurementDetailError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Procurement detail error',
    );
  });
});

// --- app/bid/[id]/loading.tsx ---
describe('Procurement Detail Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ProcurementDetailLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<ProcurementDetailLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading procurement details',
    );
  });

  it('contains screen-reader text', () => {
    render(<ProcurementDetailLoading />);
    expect(
      screen.getByText('Loading procurement details...'),
    ).toBeInTheDocument();
  });
});

// --- app/bid/[id]/session/error.tsx ---
describe('Procurement Session Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    loggerMocks.error.mockClear();
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ProcurementSessionError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ProcurementSessionError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the drafting session/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ProcurementSessionError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ProcurementSessionError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /bid', () => {
    render(<ProcurementSessionError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to procurement/i }),
    ).toHaveAttribute('href', '/procurement');
  });

  it('calls logger.error with the error via useEffect', () => {
    render(<ProcurementSessionError error={error} reset={reset} />);
    expect(loggerMocks.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error }),
      'Procurement session error',
    );
  });
});

// --- app/bid/[id]/session/loading.tsx ---
describe('Procurement Session Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ProcurementSessionLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<ProcurementSessionLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading drafting session',
    );
  });

  it('contains screen-reader text', () => {
    render(<ProcurementSessionLoading />);
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
    expect(
      screen.getByRole('link', { name: /back to procurement/i }),
    ).toHaveAttribute('href', '/procurement');
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
