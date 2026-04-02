import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ItemError from '@/app/item/[id]/error';
import ItemDetailLoading from '@/app/item/[id]/loading';
import ItemNewError from '@/app/item/new/error';
import NewItemLoading from '@/app/item/new/loading';
import BatchCreateError from '@/app/item/new/batch/error';
import BatchCreateLoading from '@/app/item/new/batch/loading';

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

// --- app/item/[id]/error.tsx ---
describe('Item Detail Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ItemError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ItemError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load this item/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ItemError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ItemError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /browse', () => {
    render(<ItemError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to browse/i }),
    ).toHaveAttribute('href', '/browse');
  });

  it('calls console.error with the error via useEffect', () => {
    render(<ItemError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Item error:', error);
  });
});

// --- app/item/[id]/loading.tsx ---
describe('Item Detail Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ItemDetailLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<ItemDetailLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading item',
    );
  });

  it('contains screen-reader text', () => {
    render(<ItemDetailLoading />);
    expect(screen.getByText('Loading item...')).toBeInTheDocument();
  });
});

// --- app/item/new/error.tsx ---
describe('Item New Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ItemNewError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ItemNewError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load this page/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ItemNewError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ItemNewError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<ItemNewError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Page error:', error);
  });
});

// --- app/item/new/loading.tsx ---
describe('Item New Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<NewItemLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<NewItemLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading content creation',
    );
  });

  it('contains screen-reader text', () => {
    render(<NewItemLoading />);
    expect(screen.getByText('Loading content creation...')).toBeInTheDocument();
  });
});

// --- app/item/new/batch/error.tsx ---
describe('Batch Create Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<BatchCreateError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<BatchCreateError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load batch creation/i),
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<BatchCreateError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<BatchCreateError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /item/new', () => {
    render(<BatchCreateError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to create/i }),
    ).toHaveAttribute('href', '/item/new');
  });

  it('calls console.error with the error via useEffect', () => {
    render(<BatchCreateError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Batch creation error:', error);
  });
});

// --- app/item/new/batch/loading.tsx ---
describe('Batch Create Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<BatchCreateLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<BatchCreateLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading batch creation',
    );
  });

  it('contains screen-reader text', () => {
    render(<BatchCreateLoading />);
    expect(screen.getByText('Loading batch creation...')).toBeInTheDocument();
  });
});
