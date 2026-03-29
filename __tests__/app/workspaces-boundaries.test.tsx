import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import WorkspacesError from '@/app/workspaces/error';
import WorkspacesLoading from '@/app/workspaces/loading';

describe('Workspaces Error Boundary', () => {
  const reset = vi.fn();
  const error = new Error('Test error');

  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    reset.mockClear();
  });

  it('renders with role="alert"', () => {
    render(<WorkspacesError error={error} reset={reset} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the heading text', () => {
    render(<WorkspacesError error={error} reset={reset} />);
    expect(
      screen.getByText(/couldn.*t load this page/i)
    ).toBeInTheDocument();
  });

  it('renders a contextual icon with aria-hidden', () => {
    render(<WorkspacesError error={error} reset={reset} />);
    const alert = screen.getByRole('alert');
    const icon = alert.querySelector('[aria-hidden="true"]');
    expect(icon).toBeInTheDocument();
  });

  it('has a "Try again" button that calls reset()', async () => {
    const user = userEvent.setup();
    render(<WorkspacesError error={error} reset={reset} />);
    await user.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it('calls console.error with the error via useEffect', () => {
    render(<WorkspacesError error={error} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith('Workspaces error:', error);
  });
});

describe('Workspaces Loading Skeleton', () => {
  it('renders with role="status"', () => {
    render(<WorkspacesLoading />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has an aria-label attribute', () => {
    render(<WorkspacesLoading />);
    expect(screen.getByRole('status')).toHaveAttribute(
      'aria-label',
      'Loading workspaces'
    );
  });

  it('contains screen-reader text', () => {
    render(<WorkspacesLoading />);
    expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();
  });
});
