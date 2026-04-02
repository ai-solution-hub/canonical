/**
 * GovernanceSection Component Tests
 *
 * Tests the governance settings section — loading state, empty state,
 * config list rendering, add/edit dialog, and freshness recalculation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast, mockSupabaseFrom } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockSupabaseFrom: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockSupabaseFrom,
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

import { GovernanceSection } from '@/components/settings/governance-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createGovernanceConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gov-1',
    domain: 'Technology & Systems',
    posture: 'open',
    reviewer_id: null,
    timeout_days: 7,
    quality_score_threshold: 40,
    auto_flag_on_quality_drop: false,
    auto_flag_on_freshness_transition: false,
    auto_flag_cooldown_days: 7,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function setupSupabaseMock() {
  // Mock the Supabase chain for fetching last freshness check
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockLimit = vi.fn().mockReturnValue({ single: mockSingle });
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockNot = vi.fn().mockReturnValue({ order: mockOrder });
  const mockSelect = vi.fn().mockReturnValue({ not: mockNot });
  mockSupabaseFrom.mockReturnValue({ select: mockSelect });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GovernanceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    setupSupabaseMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner while fetching governance config', () => {
    // Make fetch hang
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<GovernanceSection />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows empty state when no governance rules are configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('No governance rules configured'),
      ).toBeInTheDocument();
    });
  });

  it('renders config list with domain, posture, and timeout', async () => {
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Technology & Systems',
        posture: 'review_on_change',
        timeout_days: 14,
      }),
      createGovernanceConfig({
        id: 'gov-2',
        domain: 'Corporate',
        posture: 'open',
        timeout_days: null,
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Technology & Systems')).toBeInTheDocument();
    });

    expect(screen.getByText('Corporate')).toBeInTheDocument();
    // Review on change shows timeout — use getAllByText as the description text also matches
    const reviewTexts = screen.getAllByText(/Review on Change/);
    expect(reviewTexts.length).toBeGreaterThan(0);
    expect(screen.getByText(/14 day timeout/)).toBeInTheDocument();
  });

  it('opens add dialog and submits new governance config', async () => {
    // First call: GET configs. Second: POST new config. Third: re-fetch.
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([createGovernanceConfig()]),
      });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('No governance rules configured'),
      ).toBeInTheDocument();
    });

    // Click "Add Domain" button
    await user.click(screen.getByRole('button', { name: 'Add Domain' }));

    await waitFor(() => {
      expect(screen.getByText('Add Governance Config')).toBeInTheDocument();
    });

    // Fill in the form
    await user.type(screen.getByLabelText('Domain'), 'New Domain');

    // Submit
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/governance',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({
            domain: 'New Domain',
            posture: 'open',
            timeout_days: 7,
            auto_flag_on_quality_drop: false,
            auto_flag_on_freshness_transition: false,
            auto_flag_cooldown_days: 7,
            quality_score_threshold: 40,
          }),
        }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Governance configuration saved',
    );
  });

  it('displays auto-flag indicators on config entries when enabled', async () => {
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Operations',
        posture: 'open',
        auto_flag_on_quality_drop: true,
        auto_flag_on_freshness_transition: false,
        auto_flag_cooldown_days: 14,
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Operations')).toBeInTheDocument();
    });

    // Should show auto-flag info
    expect(screen.getByText(/quality drop/)).toBeInTheDocument();
    expect(screen.getByText(/14d cooldown/)).toBeInTheDocument();
  });

  it('calls freshness recalculate API and shows success toast', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updated: 42,
            recalculated_at: '2025-03-15T12:00:00Z',
          }),
      });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Recalculate Now' }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Recalculate Now' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/freshness/recalculate-all',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Freshness recalculated: 42 items updated',
    );
  });
});
