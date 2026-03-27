/**
 * VerificationHistory Component Tests
 *
 * Tests the VerificationHistory and LatestVerificationNote components:
 * - Renders history items with correct action types and styling
 * - Shows empty state when no history exists
 * - Displays notes when present
 * - Displays performer names via useDisplayNames
 * - Expand/collapse toggle
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock Supabase client and useDisplayNames
// ---------------------------------------------------------------------------

const { mockChain, mockFrom, mockDisplayNames } = vi.hoisted(() => {
  const chain: Record<string, ReturnType<typeof vi.fn>> = {};
  const methods = ['select', 'eq', 'order', 'limit', 'maybeSingle'];
  for (const m of methods) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // Default: resolve to empty data (return object with .catch for chaining)
  chain.catch = vi.fn().mockReturnValue(chain);
  chain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
    resolve({ data: [], error: null });
    return { catch: vi.fn() };
  });
  chain.maybeSingle = vi.fn().mockReturnValue({
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: null, error: null });
      return { catch: vi.fn() };
    }),
    catch: vi.fn(),
  });

  return {
    mockChain: chain,
    mockFrom: vi.fn().mockReturnValue(chain),
    mockDisplayNames: vi.fn().mockReturnValue(new Map()),
  };
});

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockFrom,
  }),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: mockDisplayNames,
}));

// ---------------------------------------------------------------------------
// Import components under test (AFTER mocks)
// ---------------------------------------------------------------------------

import {
  VerificationHistory,
  LatestVerificationNote,
} from '@/components/item-detail/verification-history';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const ITEM_ID = '00000000-0000-4000-8000-000000000001';
const USER_1 = '00000000-0000-4000-8000-000000000011';
const USER_2 = '00000000-0000-4000-8000-000000000012';

const SAMPLE_ENTRIES = [
  {
    id: 'entry-1',
    content_item_id: ITEM_ID,
    action_type: 'verify',
    note: 'Content looks accurate',
    performed_by: USER_1,
    performed_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(), // 1 hour ago
  },
  {
    id: 'entry-2',
    content_item_id: ITEM_ID,
    action_type: 'flag',
    note: 'Statistics need updating',
    performed_by: USER_2,
    performed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
  },
  {
    id: 'entry-3',
    content_item_id: ITEM_ID,
    action_type: 'unverify',
    note: null,
    performed_by: USER_1,
    performed_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week ago
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function resetMocks() {
  vi.clearAllMocks();

  // Reset chain to return self for all methods
  const methods = ['select', 'eq', 'order', 'limit', 'maybeSingle'];
  for (const m of methods) {
    mockChain[m] = vi.fn().mockReturnValue(mockChain);
  }
  mockChain.catch = vi.fn().mockReturnValue(mockChain);
  mockChain.then = vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
    resolve({ data: [], error: null });
    return { catch: vi.fn() };
  });
  mockChain.maybeSingle = vi.fn().mockReturnValue({
    then: vi.fn().mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: null, error: null });
      return { catch: vi.fn() };
    }),
    catch: vi.fn(),
  });
  mockFrom.mockReturnValue(mockChain);

  // Default display names
  const names = new Map<string, string>();
  names.set(USER_1, 'Alice Smith');
  names.set(USER_2, 'Bob Jones');
  mockDisplayNames.mockReturnValue(names);
}

// ---------------------------------------------------------------------------
// LatestVerificationNote
// ---------------------------------------------------------------------------

describe('LatestVerificationNote', () => {
  beforeEach(resetMocks);

  it('renders nothing when no history exists', async () => {
    mockChain.maybeSingle.mockResolvedValue({ data: null, error: null });

    const { container } = render(
      <LatestVerificationNote contentItemId={ITEM_ID} />,
    );

    // Wait for the effect to run
    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('verification_history');
    });

    // Should render nothing (no note)
    expect(container.querySelector('p')).toBeNull();
  });

  it('renders nothing when latest entry has no note', async () => {
    mockChain.maybeSingle.mockResolvedValue({
      data: { ...SAMPLE_ENTRIES[2], note: null },
      error: null,
    });

    const { container } = render(
      <LatestVerificationNote contentItemId={ITEM_ID} />,
    );

    await waitFor(() => {
      expect(mockFrom).toHaveBeenCalledWith('verification_history');
    });

    expect(container.querySelector('p')).toBeNull();
  });

  it('renders the note when latest entry has one', async () => {
    mockChain.maybeSingle.mockResolvedValue({
      data: SAMPLE_ENTRIES[0],
      error: null,
    });

    render(<LatestVerificationNote contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Content looks accurate/)).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// VerificationHistory
// ---------------------------------------------------------------------------

describe('VerificationHistory', () => {
  beforeEach(resetMocks);

  it('shows empty state when no history exists', async () => {
    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/No verification history/)).toBeInTheDocument();
    });
  });

  it('shows the count of history entries in the toggle button', async () => {
    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });
  });

  it('is collapsed by default', async () => {
    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    // The list should not be visible yet
    expect(screen.queryByRole('list', { name: 'Verification history' })).not.toBeInTheDocument();
  });

  it('expands when the toggle button is clicked', async () => {
    const user = userEvent.setup();

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    // Click to expand
    await user.click(screen.getByText(/Verification history \(3\)/));

    // Now the list should be visible
    expect(screen.getByRole('list', { name: 'Verification history' })).toBeInTheDocument();
  });

  it('renders all action types with correct labels', async () => {
    const user = userEvent.setup();

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Verification history \(3\)/));

    // Check action type labels
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText('Flagged')).toBeInTheDocument();
    expect(screen.getByText('Unverified')).toBeInTheDocument();
  });

  it('shows notes where present and omits for null notes', async () => {
    const user = userEvent.setup();

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Verification history \(3\)/));

    // Notes for entries 0 and 1
    expect(screen.getByText('Content looks accurate')).toBeInTheDocument();
    expect(screen.getByText('Statistics need updating')).toBeInTheDocument();

    // Entry 3 has no note — should only have 2 italic note paragraphs
    const notes = screen.getAllByText(/Content looks accurate|Statistics need updating/);
    expect(notes).toHaveLength(2);
  });

  it('displays performer names from useDisplayNames', async () => {
    const user = userEvent.setup();

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Verification history \(3\)/));

    // Alice is the performer for entries 0 and 2
    expect(screen.getAllByText(/by Alice Smith/)).toHaveLength(2);
    // Bob is the performer for entry 1
    expect(screen.getByText(/by Bob Jones/)).toBeInTheDocument();
  });

  it('shows "Unknown user" when display name is not available', async () => {
    const user = userEvent.setup();

    // Return empty display names
    mockDisplayNames.mockReturnValue(new Map());

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: [SAMPLE_ENTRIES[0]], error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(1\)/)).toBeInTheDocument();
    });

    await user.click(screen.getByText(/Verification history \(1\)/));

    expect(screen.getByText(/by Unknown user/)).toBeInTheDocument();
  });

  it('has correct aria-expanded attribute on toggle', async () => {
    const user = userEvent.setup();

    mockChain.then.mockImplementation((resolve: (v: unknown) => void) => {
      resolve({ data: SAMPLE_ENTRIES, error: null });
      return { catch: vi.fn() };
    });

    render(<VerificationHistory contentItemId={ITEM_ID} />);

    await waitFor(() => {
      expect(screen.getByText(/Verification history \(3\)/)).toBeInTheDocument();
    });

    const toggleButton = screen.getByRole('button', { name: /Verification history/ });
    expect(toggleButton).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggleButton);
    expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
  });
});
