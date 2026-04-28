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
import type { ItemProvenanceResponse } from '@/lib/provenance/item-provenance';

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

function buildFullData(): ItemProvenanceResponse {
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
    reviewSchedule: {
      nextReviewDate: '2026-10-23',
      reviewCadenceDays: 182,
      lastReviewedAt: '2026-04-23T09:00:00Z',
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
        reviewSchedule: {
          nextReviewDate: null,
          reviewCadenceDays: null,
          lastReviewedAt: null,
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

  // -------------------------------------------------------------------------
  // T4 — Review Schedule subsection
  //
  // AC1 — Next review date: DD/MM/YYYY or "Not scheduled".
  // AC2 — Review cadence: "Every {N} days ({M} months)" / "One-off review" /
  //       "No cadence set" depending on (review_cadence_days, next_review_date)
  //       combination.
  // AC3 — Last reviewed: DD/MM/YYYY (from verified_at) or "Never reviewed".
  // -------------------------------------------------------------------------

  describe('Review Schedule subsection (T4)', () => {
    function dispatchSearch() {
      const input = screen.getByLabelText(/content item uuid/i);
      fireEvent.change(input, { target: { value: VALID_UUID } });
      fireEvent.click(screen.getByRole('button', { name: /look up/i }));
    }

    it('renders the section heading and three rows for fully-populated data', async () => {
      const data = buildFullData();
      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        // Section heading
        expect(screen.getByText('Review Schedule')).toBeInTheDocument();
        // Three labelled rows
        expect(screen.getByText('Next review date')).toBeInTheDocument();
        expect(screen.getByText('Review cadence')).toBeInTheDocument();
        expect(screen.getByText('Last reviewed')).toBeInTheDocument();
      });
    });

    it('AC1 + AC2 + AC3: renders dates UK-formatted and cadence "Every 182 days (6 months)" when fully populated', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: '2026-10-23',
        reviewCadenceDays: 182,
        lastReviewedAt: '2026-04-23T09:00:00Z',
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        // AC1 — DD/MM/YYYY
        expect(screen.getByText('23/10/2026')).toBeInTheDocument();
        // AC2 — Every {N} days ({M} months) with M = round(182/30) = 6
        expect(
          screen.getByText('Every 182 days (6 months)'),
        ).toBeInTheDocument();
        // AC3 — DD/MM/YYYY for verified_at
        expect(screen.getByText('23/04/2026')).toBeInTheDocument();
      });
    });

    it('AC2: renders "One-off review" when next_review_date is set but cadence is null', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: '2026-12-01',
        reviewCadenceDays: null,
        lastReviewedAt: '2026-04-15T09:00:00Z',
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        expect(screen.getByText('01/12/2026')).toBeInTheDocument();
        expect(screen.getByText('One-off review')).toBeInTheDocument();
        expect(screen.getByText('15/04/2026')).toBeInTheDocument();
      });
    });

    it('AC1 + AC2: renders "Not scheduled" + "No cadence set" when both fields are null', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: null,
        reviewCadenceDays: null,
        lastReviewedAt: '2026-04-15T09:00:00Z',
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        expect(screen.getByText('Not scheduled')).toBeInTheDocument();
        expect(screen.getByText('No cadence set')).toBeInTheDocument();
        // Last reviewed still surfaces the date
        expect(screen.getByText('15/04/2026')).toBeInTheDocument();
      });
    });

    it('AC3: renders "Never reviewed" when verified_at is null', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: '2026-10-23',
        reviewCadenceDays: 90,
        lastReviewedAt: null,
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        expect(screen.getByText('Never reviewed')).toBeInTheDocument();
        // round(90/30) = 3 → "(3 months)"
        expect(
          screen.getByText('Every 90 days (3 months)'),
        ).toBeInTheDocument();
      });
    });

    it('AC2: pluralises correctly — "Every 1 day (0 months)" for cadence = 1', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: '2026-04-29',
        reviewCadenceDays: 1,
        lastReviewedAt: null,
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        // Math.round(1/30) = 0 → "(0 months)"
        expect(screen.getByText('Every 1 day (0 months)')).toBeInTheDocument();
      });
    });

    it('AC2: pluralises correctly — "Every 30 days (1 month)" for cadence = 30', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: '2026-05-28',
        reviewCadenceDays: 30,
        lastReviewedAt: null,
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        // Math.round(30/30) = 1 → "(1 month)" singular
        expect(screen.getByText('Every 30 days (1 month)')).toBeInTheDocument();
      });
    });

    it('AC1 + AC2 + AC3: handles all-null reviewSchedule (never-scheduled, never-reviewed)', async () => {
      const data = buildFullData();
      data.reviewSchedule = {
        nextReviewDate: null,
        reviewCadenceDays: null,
        lastReviewedAt: null,
      };

      mockUseItemProvenance.mockReturnValue({
        data,
        isLoading: false,
        isError: false,
        error: null,
      });

      renderWithQuery(<PerItemTab />);
      dispatchSearch();

      await waitFor(() => {
        expect(screen.getByText('Not scheduled')).toBeInTheDocument();
        expect(screen.getByText('No cadence set')).toBeInTheDocument();
        expect(screen.getByText('Never reviewed')).toBeInTheDocument();
      });
    });
  });
});
