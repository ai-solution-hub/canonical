/**
 * Entity Admin List Component Tests
 *
 * Tests the EntityList component — loading state, entity display,
 * search, type filtering, detail panel opening.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Stub sub-modals to isolate EntityList
vi.mock('@/components/entity-management/merge-modal', () => ({
  MergeModal: () => <div data-testid="merge-modal">MergeModal</div>,
}));

vi.mock('@/components/entity-management/split-modal', () => ({
  SplitModal: () => <div data-testid="split-modal">SplitModal</div>,
}));

vi.mock('@/components/entity-management/entity-detail-panel', () => ({
  EntityDetailPanel: ({
    canonicalName,
    open,
  }: {
    canonicalName: string | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) =>
    open ? (
      <div data-testid="entity-detail-panel">Detail: {canonicalName}</div>
    ) : null,
}));

import { EntityList } from '@/components/entity-management/entity-list';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createEntityResponse(
  overrides: Partial<{
    entities: unknown[];
    total: number;
  }> = {},
) {
  return {
    entities: overrides.entities ?? [
      {
        canonical_name: 'Acme Corporation',
        entity_type: 'organisation',
        mention_count: 15,
        variant_count: 3,
        variant_names: ['Acme Corporation', 'Acme Corp', 'ACME'],
        relationship_count: 5,
        has_type_conflict: false,
        types_seen: ['organisation'],
      },
      {
        canonical_name: 'ISO 27001',
        entity_type: 'certification',
        mention_count: 8,
        variant_count: 1,
        variant_names: ['ISO 27001'],
        relationship_count: 2,
        has_type_conflict: false,
        types_seen: ['certification'],
      },
      {
        canonical_name: 'Data Protection Act',
        entity_type: 'regulation',
        mention_count: 4,
        variant_count: 2,
        variant_names: ['Data Protection Act', 'DPA'],
        relationship_count: 1,
        has_type_conflict: true,
        types_seen: ['regulation', 'framework'],
      },
    ],
    total: overrides.total ?? 3,
  };
}

function setupFetchResponses(response = createEntityResponse()) {
  mockFetch.mockImplementation((url: string) => {
    if (typeof url === 'string' && url.includes('/api/entities')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(response),
      });
    }
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ entities: [], total: 0 }),
    });
  });
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.clearAllMocks();
  globalThis.fetch = mockFetch;
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityList', () => {
  it('shows loading state initially', () => {
    setupFetchResponses();
    render(<EntityList />);

    // Before the debounce timer fires there should be a loader
    expect(
      screen.queryByRole('list', { name: /entity list/i }),
    ).not.toBeInTheDocument();
  });

  it('renders entity list after loading', async () => {
    setupFetchResponses();
    render(<EntityList />);

    // Advance past the 300ms debounce
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    expect(screen.getByText('Data Protection Act')).toBeInTheDocument();
  });

  it('shows summary statistics', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument(); // total entities
    });
  });

  it('displays mention and variant counts', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Check Acme's counts are rendered
    expect(screen.getByText('15m')).toBeInTheDocument();
    expect(screen.getByText('3v')).toBeInTheDocument();
  });

  it('shows entity count text', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText(/3 entities shown/)).toBeInTheDocument();
    });
  });

  it('shows empty state when no entities found', async () => {
    setupFetchResponses({ entities: [], total: 0 });
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('No entities found.')).toBeInTheDocument();
    });
  });

  it('shows type conflict warning', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Data Protection Act')).toBeInTheDocument();
    });

    // The DPA entity has a type conflict — look for the warning icon
    const typeConflictIcons = screen.getAllByLabelText('Type conflict');
    expect(typeConflictIcons.length).toBeGreaterThan(0);
  });

  it('has a search input', async () => {
    setupFetchResponses();
    render(<EntityList />);

    const searchInput = screen.getByLabelText('Search entities');
    expect(searchInput).toBeInTheDocument();
  });

  it('triggers fetch with search query after debounce', async () => {
    setupFetchResponses();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    mockFetch.mockClear();

    const searchInput = screen.getByLabelText('Search entities');
    await user.clear(searchInput);
    await user.type(searchInput, 'iso');

    // Advance past the debounce
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      const calls = mockFetch.mock.calls;
      const lastCall = calls[calls.length - 1];
      expect(String(lastCall[0])).toContain('search=iso');
    });
  });

  it('renders view detail button for each entity', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    const detailButtons = screen.getAllByTitle('View entity detail');
    expect(detailButtons.length).toBe(3);
  });

  it('opens detail panel when view detail button clicked', async () => {
    setupFetchResponses();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    const detailButton = screen.getByLabelText(
      'View detail for Acme Corporation',
    );
    await user.click(detailButton);

    expect(screen.getByTestId('entity-detail-panel')).toBeInTheDocument();
    expect(screen.getByText('Detail: Acme Corporation')).toBeInTheDocument();
  });

  it('shows error toast when fetch fails', async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'fail' }),
      }),
    );
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Failed to load entities');
    });
  });

  it('renders split button only for entities with multiple variants', async () => {
    setupFetchResponses();
    render(<EntityList />);
    vi.advanceTimersByTime(350);

    await waitFor(() => {
      expect(screen.getByText('Acme Corporation')).toBeInTheDocument();
    });

    // Acme (3 variants) and DPA (2 variants) should have split buttons
    // ISO 27001 (1 variant) should not
    const splitButtons = screen.getAllByTitle('Split entity');
    expect(splitButtons.length).toBe(2);
  });
});
