import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import SettingsError from '@/app/settings/error';
import SettingsLoading from '@/app/settings/loading';

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

describe('Settings Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<SettingsError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<SettingsError error={error} reset={reset} />);
    expect(screen.getByText(/couldn.*t load settings/i)).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<SettingsError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<SettingsError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('has a navigation link to home', () => {
    render(<SettingsError error={error} reset={reset} />);
    expect(screen.getByRole('link', { name: /return home/i })).toHaveAttribute(
      'href',
      '/',
    );
  });

  it('calls console.error with the error via useEffect', () => {
    render(<SettingsError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Settings error:', error);
  });
});

describe('Settings Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<SettingsLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<SettingsLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading settings',
    );
  });

  it('contains screen-reader text', () => {
    render(<SettingsLoading />);
    expect(screen.getByText('Loading settings...')).toBeInTheDocument();
  });
});
