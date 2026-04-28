/**
 * Component tests for the per-item provenance tab.
 *
 * Tests loading skeleton, error state, full data render,
 * no-classification items, and no-bid-response items.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Mock the hook
// ---------------------------------------------------------------------------

const mockUseItemProvenance = vi.fn();

vi.mock('@/hooks/provenance/use-item-provenance', () => ({
  useItemProvenance: (...args: unknown[]) => mockUseItemProvenance(...args),
}));

// ---------------------------------------------------------------------------
// Import component AFTER mocks
// ---------------------------------------------------------------------------

import PerItemTab from '@/components/provenance/per-item-tab';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_UUID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithQuery(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
    },
  });

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  );
}

function buildFullData() {
  return {
    itemId: VALID_UUID,
    classification: {
      confidence: 0.86,
      primaryDomain: 'health-safety',
      primarySubtopic: 'cdm-regulations',
      secondaryDomain: 'construction',
      secondarySubtopic: 'procurement',
      reasoning: 'The document sets out duty-holder responsibilities',
      classifiedAt: '2026-04-10T12:00:00Z',
    },
    processing: {
      classificationModel: 'claude-opus-4-6',
      classificationModelSource: 'recorded' as 'recorded' | 'env_default',
      embeddingModel: 'text-embedding-3-large',
      embeddingModelSource: 'recorded' as 'recorded' | 'env_default',
      classificationTokensIn: 1420,
      classificationTokensOut: 312,
      classificationCacheCreation: 0,
      classificationCacheRead: 0,
      embeddingTokens: 890,
      estimatedClassifyCost: 0.0447,
      estimatedEmbedCost: 0.0001157,
    },
    drafting: {
      recentDrafts: [
        {
          responseId: 'resp-1',
          bidId: 'bid-1',
          bidName: 'Manchester Schools Refurb',
          questionText: 'Describe your H&S policy',
          draftedAt: '2026-04-11T10:00:00Z',
          attribution: {
            kind: 'claude' as const,
            label: 'Knowledge Hub',
            userId: 'a0000000-0000-4000-8000-000000000001',
          },
        },
      ],
      totalDraftCount: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PerItemTab', () => {
  beforeEach(() => {
    mockUseItemProvenance.mockReset();
    // Default: no item selected
    mockUseItemProvenance.mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('shows empty state with UUID input prompt', () => {
    renderWithQuery(<PerItemTab />);
    expect(screen.getByText(/enter a content item uuid/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /look up/i })).toBeDisabled();
  });

  it('enables button when a valid UUID is entered', () => {
    renderWithQuery(<PerItemTab />);
    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    expect(screen.getByRole('button', { name: /look up/i })).not.toBeDisabled();
  });

  it('does not enable button for invalid input', () => {
    renderWithQuery(<PerItemTab />);
    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: 'not-a-uuid' } });
    expect(screen.getByRole('button', { name: /look up/i })).toBeDisabled();
  });

  it('shows loading skeleton when fetching', async () => {
    mockUseItemProvenance.mockReturnValue({
      data: null,
      isLoading: true,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    // Trigger search
    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    // Now the hook should be called with the selected item
    // Since we mocked isLoading: true, it should show skeleton
    await waitFor(() => {
      expect(screen.getByTestId('per-item-skeleton')).toBeInTheDocument();
    });
  });

  it('shows error state on failure', async () => {
    mockUseItemProvenance.mockReturnValue({
      data: null,
      isLoading: false,
      isError: true,
      error: new Error('Server error'),
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument();
    });
  });

  it('renders full data with all three card groups', async () => {
    const fullData = buildFullData();
    mockUseItemProvenance.mockReturnValue({
      data: fullData,
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      // Classification card
      expect(screen.getByText('Classification')).toBeInTheDocument();
      expect(screen.getByText('86.0%')).toBeInTheDocument();
      expect(screen.getByText(/health-safety/)).toBeInTheDocument();

      // Processing card
      expect(screen.getByText('Processing')).toBeInTheDocument();
      expect(screen.getByText(/claude-opus-4-6/)).toBeInTheDocument();
      expect(screen.getByText(/text-embedding-3-large/)).toBeInTheDocument();

      // Drafting card
      expect(screen.getByText('Drafting')).toBeInTheDocument();
      expect(screen.getByText(/drafted by knowledge hub/i)).toBeInTheDocument();
      expect(
        screen.getByText(/manchester schools refurb/i),
      ).toBeInTheDocument();
    });
  });

  it('shows reasoning without truncation', async () => {
    const fullData = buildFullData();
    mockUseItemProvenance.mockReturnValue({
      data: fullData,
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      expect(
        screen.getByText('The document sets out duty-holder responsibilities'),
      ).toBeInTheDocument();
    });
  });

  it('renders "Not recorded" for null classification', async () => {
    mockUseItemProvenance.mockReturnValue({
      data: {
        itemId: VALID_UUID,
        classification: {
          confidence: null,
          primaryDomain: null,
          primarySubtopic: null,
          secondaryDomain: null,
          secondarySubtopic: null,
          reasoning: null,
          classifiedAt: null,
        },
        processing: {
          classificationModel: 'claude-opus-4-6',
          classificationModelSource: 'env_default',
          embeddingModel: 'text-embedding-3-large',
          embeddingModelSource: 'env_default',
          classificationTokensIn: null,
          classificationTokensOut: null,
          classificationCacheCreation: null,
          classificationCacheRead: null,
          embeddingTokens: null,
          estimatedClassifyCost: null,
          estimatedEmbedCost: null,
        },
        drafting: { recentDrafts: [], totalDraftCount: 0 },
      },
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      expect(screen.getByText(/has not been classified/i)).toBeInTheDocument();
    });
  });

  it('renders empty drafting state', async () => {
    const data = buildFullData();
    data.drafting = { recentDrafts: [], totalDraftCount: 0 };

    mockUseItemProvenance.mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/no bid responses cite this item/i),
      ).toBeInTheDocument();
    });
  });

  it('shows model source qualifier for env_default', async () => {
    const data = buildFullData();
    data.processing.classificationModelSource = 'env_default';
    data.processing.embeddingModelSource = 'env_default';

    mockUseItemProvenance.mockReturnValue({
      data,
      isLoading: false,
      isError: false,
      error: null,
    });

    renderWithQuery(<PerItemTab />);

    const input = screen.getByLabelText(/content item uuid/i);
    fireEvent.change(input, { target: { value: VALID_UUID } });
    fireEvent.click(screen.getByRole('button', { name: /look up/i }));

    await waitFor(() => {
      const matches = screen.getAllByText(/current default/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      // Both classification and embedding models should show the qualifier
      expect(matches).toHaveLength(2);
    });
  });
});
