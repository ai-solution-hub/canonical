import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EntityCoOccurrence, type CoOccurrencePair } from '@/components/item-detail/entity-co-occurrence';

// ---------------------------------------------------------------------------
// Mock fetch globally
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helper data
// ---------------------------------------------------------------------------

const MOCK_PAIRS: CoOccurrencePair[] = [
  {
    entity_a: 'Acme Corp',
    type_a: 'organisation',
    entity_b: 'ISO 27001',
    type_b: 'certification',
    shared_count: 5,
  },
  {
    entity_a: 'Cyber Essentials',
    type_a: 'certification',
    entity_b: 'NCSC',
    type_b: 'organisation',
    shared_count: 3,
  },
];

function mockSuccessResponse(pairs: CoOccurrencePair[] = MOCK_PAIRS) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ pairs, total: pairs.length }),
  });
}

function mockErrorResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 500,
    json: async () => ({ error: 'Server error' }),
  });
}

function mockEmptyResponse() {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ pairs: [], total: 0 }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityCoOccurrence', () => {
  it('shows loading state while fetching', async () => {
    // Make fetch hang to observe loading state
    mockFetch.mockReturnValueOnce(new Promise(() => {}));

    render(<EntityCoOccurrence show defaultOpen />);

    expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
  });

  it('renders entity pairs after successful fetch', async () => {
    mockSuccessResponse();

    render(<EntityCoOccurrence show defaultOpen />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    expect(screen.getByText('Cyber Essentials')).toBeInTheDocument();
    expect(screen.getByText('NCSC')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('shows empty state when no pairs returned', async () => {
    mockEmptyResponse();

    render(<EntityCoOccurrence show defaultOpen />);

    await waitFor(() => {
      expect(
        screen.getByText(/no frequently co-occurring entities found/i),
      ).toBeInTheDocument();
    });
  });

  it('shows error message on fetch failure', async () => {
    mockErrorResponse();

    render(<EntityCoOccurrence show defaultOpen />);

    await waitFor(() => {
      expect(
        screen.getByText(/could not load co-occurrence data/i),
      ).toBeInTheDocument();
    });
  });

  it('calls onEntityClick when an entity button is clicked', async () => {
    mockSuccessResponse();
    const handleClick = vi.fn();

    const user = userEvent.setup();
    render(<EntityCoOccurrence show defaultOpen onEntityClick={handleClick} />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Filter by entity: Acme Corp'));
    expect(handleClick).toHaveBeenCalledWith('Acme Corp');

    await user.click(screen.getByLabelText('Filter by entity: ISO 27001'));
    expect(handleClick).toHaveBeenCalledWith('ISO 27001');
  });

  it('does not render when show is false', () => {
    render(<EntityCoOccurrence show={false} />);
    expect(screen.queryByText('Entity Co-occurrence')).not.toBeInTheDocument();
  });

  it('does not re-fetch after initial load', async () => {
    mockSuccessResponse();

    const { rerender } = render(<EntityCoOccurrence show defaultOpen />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Re-render — should not fetch again
    rerender(<EntityCoOccurrence show defaultOpen />);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('fetches with correct URL parameters', async () => {
    mockSuccessResponse();

    render(<EntityCoOccurrence show maxPairs={15} defaultOpen />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/entities/co-occurrence?limit=15&min=2',
    );
  });

  it('renders entity type badges with correct aria labels', async () => {
    mockSuccessResponse();

    render(<EntityCoOccurrence show defaultOpen />);

    await waitFor(() => {
      expect(screen.getByText('Acme Corp')).toBeInTheDocument();
    });

    // Check the list structure
    const list = screen.getByRole('list', { name: /co-occurring entity pairs/i });
    expect(list).toBeInTheDocument();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });
});
