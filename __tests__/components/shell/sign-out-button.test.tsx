/**
 * SignOutButton Component Tests
 *
 * Verifies the sign-out button calls `supabase.auth.signOut()` and then
 * performs a full-page navigation to `/login`. Covers both the desktop
 * (icon-only) and mobile (drawer row) variants, the disabled/busy state
 * during the round-trip, and the `onBeforeNavigate` hook used by the
 * mobile drawer to close itself.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { signOutSpy, createClientSpy } = vi.hoisted(() => {
  const signOutSpy = vi.fn().mockResolvedValue({ error: null });
  const createClientSpy = vi.fn(() => ({
    auth: { signOut: signOutSpy },
  }));
  return { signOutSpy, createClientSpy };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: createClientSpy,
}));

// Import AFTER mocks
import { SignOutButton } from '@/components/shell/sign-out-button';

// ---------------------------------------------------------------------------
// window.location — JSDOM doesn't allow direct href assignment, so we
// replace the whole location object with a writable stub.
// ---------------------------------------------------------------------------

let originalLocation: Location;

beforeEach(() => {
  originalLocation = window.location;
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: { href: '' } as Location,
  });
  signOutSpy.mockClear();
  createClientSpy.mockClear();
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SignOutButton', () => {
  describe('desktop variant (default)', () => {
    it('renders an icon button with an accessible name', () => {
      render(<SignOutButton />);
      const button = screen.getByRole('button', { name: 'Sign out' });
      expect(button).toBeInTheDocument();
      expect(button).not.toBeDisabled();
    });

    it('calls supabase.auth.signOut() and navigates to /login on click', async () => {
      const user = userEvent.setup();
      render(<SignOutButton />);

      await user.click(screen.getByRole('button', { name: 'Sign out' }));

      await waitFor(() => {
        expect(signOutSpy).toHaveBeenCalledTimes(1);
      });
      expect(window.location.href).toBe('/login');
    });

    it('navigates to /login even if signOut rejects (does not trap the user)', async () => {
      signOutSpy.mockRejectedValueOnce(new Error('Network error'));
      const user = userEvent.setup();
      render(<SignOutButton />);

      await user.click(screen.getByRole('button', { name: 'Sign out' }));

      await waitFor(() => {
        expect(window.location.href).toBe('/login');
      });
      expect(signOutSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('mobile variant', () => {
    it('renders a row-styled button with the "Sign out" label visible', () => {
      render(<SignOutButton variant="mobile" />);
      const button = screen.getByRole('button', { name: 'Sign out' });
      expect(button).toBeInTheDocument();
      // Mobile variant shows visible text (not just aria-label)
      expect(button).toHaveTextContent('Sign out');
    });

    it('invokes onBeforeNavigate before redirecting', async () => {
      const onBeforeNavigate = vi.fn();
      const user = userEvent.setup();
      render(
        <SignOutButton variant="mobile" onBeforeNavigate={onBeforeNavigate} />,
      );

      await user.click(screen.getByRole('button', { name: 'Sign out' }));

      await waitFor(() => {
        expect(onBeforeNavigate).toHaveBeenCalledTimes(1);
      });
      expect(signOutSpy).toHaveBeenCalledTimes(1);
      expect(window.location.href).toBe('/login');
    });
  });

  it('is disabled while a sign-out is in flight to prevent double-click', async () => {
    // Make the signOut promise hang so we can observe the disabled state
    let resolveSignOut: (value: { error: null }) => void = () => {};
    signOutSpy.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        }),
    );

    const user = userEvent.setup();
    render(<SignOutButton />);

    const button = screen.getByRole('button', { name: 'Sign out' });
    await user.click(button);

    // After the first click, the button should be disabled and aria-busy
    await waitFor(() => {
      expect(button).toBeDisabled();
    });
    expect(button).toHaveAttribute('aria-busy', 'true');

    // A second click should be a no-op — the handler early-returns
    await user.click(button);
    expect(signOutSpy).toHaveBeenCalledTimes(1);

    // Let the promise resolve so the test cleans up
    resolveSignOut({ error: null });
  });
});
