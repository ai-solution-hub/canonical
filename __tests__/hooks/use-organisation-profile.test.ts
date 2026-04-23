import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Mock fetchers
vi.mock('@/lib/query/fetchers', () => ({
  fetchJson: vi.fn(),
}));

import { fetchJson } from '@/lib/query/fetchers';
import { useOrganisationProfile } from '@/hooks/use-organisation-profile';

const mockFetchJson = vi.mocked(fetchJson);

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useOrganisationProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { profile: null, isLoaded: true, isComplete: false } when no primary profile exists', async () => {
    mockFetchJson.mockResolvedValue({ profile: null });

    const { result } = renderHook(() => useOrganisationProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    expect(result.current.profile).toBeNull();
    expect(result.current.isComplete).toBe(false);
    expect(result.current.editUrl).toBe('/settings?section=organisation');
  });

  it('returns complete profile when primary profile exists with name + sectors + services', async () => {
    mockFetchJson.mockResolvedValue({ profile: COMPLETE_PROFILE });

    const { result } = renderHook(() => useOrganisationProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    expect(result.current.profile).toEqual(COMPLETE_PROFILE);
    expect(result.current.isComplete).toBe(true);
  });

  it('isComplete is false when sectors is empty', async () => {
    mockFetchJson.mockResolvedValue({
      profile: { ...COMPLETE_PROFILE, sectors: [] },
    });

    const { result } = renderHook(() => useOrganisationProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    expect(result.current.isComplete).toBe(false);
  });

  it('isComplete is false when name is empty', async () => {
    mockFetchJson.mockResolvedValue({
      profile: { ...COMPLETE_PROFILE, name: '' },
    });

    const { result } = renderHook(() => useOrganisationProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    expect(result.current.isComplete).toBe(false);
  });

  it('isComplete is false when services is empty', async () => {
    mockFetchJson.mockResolvedValue({
      profile: { ...COMPLETE_PROFILE, services: [] },
    });

    const { result } = renderHook(() => useOrganisationProfile(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isLoaded).toBe(true);
    });

    expect(result.current.isComplete).toBe(false);
  });
});
