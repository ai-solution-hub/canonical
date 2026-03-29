import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import GuidesError from '@/app/guide/error';
import GuidesLoading from '@/app/guide/loading';
import GuideDetailError from '@/app/guide/[slug]/error';
import GuideDetailLoading from '@/app/guide/[slug]/loading';

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

// --- app/guide/error.tsx ---
describe('Guides Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<GuidesError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<GuidesError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load guides/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<GuidesError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<GuidesError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to home', () => {
    render(<GuidesError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /return home/i })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('calls console.error with the error via useEffect', () => {
    render(<GuidesError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Guides error:', error);
  });
});

// --- app/guide/loading.tsx ---
describe('Guides Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<GuidesLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<GuidesLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading guides'
    );
  });

  it('contains screen-reader text', () => {
    render(<GuidesLoading />);
    expect(screen.getByText('Loading guides...')).toBeInTheDocument();
  });
});

// --- app/guide/[slug]/error.tsx ---
describe('Guide Detail Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<GuideDetailError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<GuideDetailError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load this guide/i)
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<GuideDetailError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<GuideDetailError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to /guide', () => {
    render(<GuideDetailError error={error} reset={reset} />);
    expect(
      screen.getByRole('link', { name: /back to guides/i })
    ).toHaveAttribute('href', '/guide');
  });

  it('calls console.error with the error via useEffect', () => {
    render(<GuideDetailError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Guide detail error:', error);
  });
});

// --- app/guide/[slug]/loading.tsx ---
describe('Guide Detail Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<GuideDetailLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<GuideDetailLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading guide'
    );
  });

  it('contains screen-reader text', () => {
    render(<GuideDetailLoading />);
    expect(screen.getByText('Loading guide...')).toBeInTheDocument();
  });
});
