import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockUseOrganisationProfile = vi.fn();
vi.mock('@/hooks/use-organisation-profile', () => ({
  useOrganisationProfile: () => mockUseOrganisationProfile(),
}));

const mockMutate = vi.fn();
const mockMutationState = {
  mutate: mockMutate,
  isPending: false,
};

vi.mock('@tanstack/react-query', async () => {
  const actual = await vi.importActual('@tanstack/react-query');
  return {
    ...actual,
    useMutation: vi.fn(() => mockMutationState),
  };
});

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { OrganisationSection } from '@/components/settings/organisation-section';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const COMPLETE_PROFILE = {
  id: 'a0000000-0000-4000-8000-000000000001',
  name: 'Acme Services',
  description: 'A test company',
  website_url: 'https://acme.example.com',
  sectors: ['Technology'],
  services: ['Consulting'],
  certifications: ['ISO 27001'],
  geographic_scope: ['UK'],
  target_customers: 'Public sector',
  value_proposition: 'Best in class',
  key_topics: ['AI'],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

function renderSection() {
  return render(
    React.createElement(
      createWrapper(),
      null,
      React.createElement(OrganisationSection),
    ),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganisationSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no profile exists', () => {
    mockUseOrganisationProfile.mockReturnValue({
      profile: null,
      isLoaded: true,
      isComplete: false,
      editUrl: '/settings?section=organisation',
    });

    renderSection();

    expect(screen.getByText('No organisation profile yet')).toBeTruthy();
    expect(screen.getByText('Create Organisation Profile')).toBeTruthy();
  });

  it('renders pre-populated form when profile exists', () => {
    mockUseOrganisationProfile.mockReturnValue({
      profile: COMPLETE_PROFILE,
      isLoaded: true,
      isComplete: true,
      editUrl: '/settings?section=organisation',
    });

    renderSection();

    const nameInput = screen.getByLabelText('Organisation Name *') as HTMLInputElement;
    expect(nameInput.value).toBe('Acme Services');
    expect(screen.getByText('Save Changes')).toBeTruthy();
    // Empty state should not be shown
    expect(screen.queryByText('No organisation profile yet')).toBeNull();
  });

  it('renders loading state when not yet loaded', () => {
    mockUseOrganisationProfile.mockReturnValue({
      profile: null,
      isLoaded: false,
      isComplete: false,
      editUrl: '/settings?section=organisation',
    });

    renderSection();

    // Should show spinner, not the form
    expect(screen.queryByText('Organisation Name *')).toBeNull();
  });

  it('does not show competitors field (SI-only)', () => {
    mockUseOrganisationProfile.mockReturnValue({
      profile: COMPLETE_PROFILE,
      isLoaded: true,
      isComplete: true,
      editUrl: '/settings?section=organisation',
    });

    renderSection();

    expect(screen.queryByText('Competitors')).toBeNull();
  });

  it('submit calls upsert with correct payload', async () => {
    const user = userEvent.setup();

    mockUseOrganisationProfile.mockReturnValue({
      profile: null,
      isLoaded: true,
      isComplete: false,
      editUrl: '/settings?section=organisation',
    });

    renderSection();

    // Fill in name
    const nameInput = screen.getByLabelText('Organisation Name *');
    await user.type(nameInput, 'New Company');

    // Add a sector
    const sectorInput = screen.getByPlaceholderText('Type a sector and press Enter');
    await user.type(sectorInput, 'Healthcare');
    await user.keyboard('{Enter}');

    // Submit
    const submitBtn = screen.getByText('Create Organisation Profile');
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockMutate).toHaveBeenCalled();
    });

    const callArg = mockMutate.mock.calls[0][0];
    expect(callArg.name).toBe('New Company');
    expect(callArg.sectors).toEqual(['Healthcare']);
  });
});
