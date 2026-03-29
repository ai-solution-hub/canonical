import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ConsentError from '@/app/oauth/consent/error';
import ConsentLoading from '@/app/oauth/consent/loading';

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

describe('OAuth Consent Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<ConsentError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<ConsentError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load the authorisation page/i)
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<ConsentError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<ConsentError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to home', () => {
    render(<ConsentError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /return home/i })).toHaveAttribute(
      'href',
      '/'
    );
  });

  it('calls console.error with the error via useEffect', () => {
    render(<ConsentError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith(
      'OAuth consent error:',
      error
    );
  });
});

describe('OAuth Consent Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<ConsentLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('renders loading text', () => {
    render(<ConsentLoading />);
    expect(screen.getByText('Loading authorisation...')).toBeInTheDocument();
  });
});
