import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-hydrated', () => ({
  useHydrated: vi.fn(() => true),
}));

const mockGetUser = vi.fn();
vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

import { OrganisationProfileNudge } from '@/components/dashboard/organisation-profile-nudge';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderNudge(
  overrides: Partial<{
    isProfileComplete: boolean;
    isFirstLogin: boolean;
    userRole: string;
  }> = {},
) {
  const props = {
    isProfileComplete: false,
    isFirstLogin: true,
    userRole: 'admin',
    ...overrides,
  };
  return render(React.createElement(OrganisationProfileNudge, props));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganisationProfileNudge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'test-user',
          user_metadata: {},
        },
      },
    });
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renders when isFirstLogin + profile incomplete', () => {
    renderNudge();

    expect(screen.getByTestId('organisation-profile-nudge')).toBeTruthy();
    expect(screen.getByText('Set up')).toBeTruthy();
  });

  it('does not render when profile is complete', () => {
    renderNudge({ isProfileComplete: true });

    expect(screen.queryByTestId('organisation-profile-nudge')).toBeNull();
  });

  it('does not render when not first login', () => {
    renderNudge({ isFirstLogin: false });

    expect(screen.queryByTestId('organisation-profile-nudge')).toBeNull();
  });

  it('does not render for viewers', () => {
    renderNudge({ userRole: 'viewer' });

    expect(screen.queryByTestId('organisation-profile-nudge')).toBeNull();
  });

  it('does not render when dismissed', () => {
    localStorage.setItem(
      'organisation-profile-nudge-dismissed',
      '2026-01-01T00:00:00Z',
    );

    renderNudge();

    expect(screen.queryByTestId('organisation-profile-nudge')).toBeNull();
  });

  it('shows persona-tailored copy for bid_writing focus', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'test-user',
          user_metadata: { primary_focus: 'bid_writing' },
        },
      },
    });

    renderNudge();

    // Wait for useEffect to resolve
    await screen.findByText('Add your company profile to improve bid context');
  });

  it('shows persona-tailored copy for account_management focus', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'test-user',
          user_metadata: { primary_focus: 'account_management' },
        },
      },
    });

    renderNudge();

    await screen.findByText(
      'Add your company profile to generate account briefs',
    );
  });

  it('shows persona-tailored copy for marketing focus', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'test-user',
          user_metadata: { primary_focus: 'marketing' },
        },
      },
    });

    renderNudge();

    await screen.findByText(
      'Complete your company profile for better case studies',
    );
  });

  it('shows default copy when primary_focus is unset', () => {
    renderNudge();

    expect(
      screen.getByText(
        'Tell us about your company to personalise your experience',
      ),
    ).toBeTruthy();
  });

  it('dismisses when dismiss button is clicked', async () => {
    const user = userEvent.setup();

    renderNudge();

    const dismissBtn = screen.getByLabelText(
      'Dismiss organisation profile nudge',
    );
    await user.click(dismissBtn);

    expect(screen.queryByTestId('organisation-profile-nudge')).toBeNull();
    expect(
      localStorage.getItem('organisation-profile-nudge-dismissed'),
    ).toBeTruthy();
  });

  it('renders for editor role', () => {
    renderNudge({ userRole: 'editor' });

    expect(screen.getByTestId('organisation-profile-nudge')).toBeTruthy();
  });
});
