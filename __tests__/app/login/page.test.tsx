/**
 * Login Page Tests
 *
 * Tests the login page: ARIA label, email placeholder UK format,
 * and basic structure.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({ error: null }),
      signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

import LoginPage from '@/app/login/page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  describe('ARIA label', () => {
    it('has aria-label "Sign in to Canonical" on outer container', () => {
      render(<LoginPage />);
      expect(screen.getByLabelText('Sign in to Canonical')).toBeInTheDocument();
    });
  });

  describe('email placeholder', () => {
    it('uses .co.uk domain in email placeholder', () => {
      render(<LoginPage />);
      const emailInput = screen.getByPlaceholderText('sarah@company.co.uk');
      expect(emailInput).toBeInTheDocument();
    });

    it('email input has correct type', () => {
      render(<LoginPage />);
      const emailInput = screen.getByPlaceholderText('sarah@company.co.uk');
      expect(emailInput).toHaveAttribute('type', 'email');
    });
  });

  describe('basic structure', () => {
    it('displays Canonical brand heading', () => {
      render(<LoginPage />);
      expect(screen.getByText('Canonical')).toBeInTheDocument();
    });

    it('displays sign-in subtitle on email step', () => {
      render(<LoginPage />);
      expect(
        screen.getByText('Sign in to your knowledge base'),
      ).toBeInTheDocument();
    });

    it('has a Continue button', () => {
      render(<LoginPage />);
      expect(
        screen.getByRole('button', { name: 'Continue' }),
      ).toBeInTheDocument();
    });

    it('announces step 1 of 3 for screen readers', () => {
      render(<LoginPage />);
      expect(
        screen.getByText('Step 1 of 3: Enter your email address'),
      ).toBeInTheDocument();
    });
  });
});
