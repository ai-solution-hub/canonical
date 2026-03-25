import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignmentManager } from '@/components/review/assignment-manager';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetDomainNames = vi.fn().mockReturnValue(['H&S', 'Environmental', 'Quality']);

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: mockGetDomainNames,
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getSubtopics: () => [],
    getDomainColourKey: () => 'default',
    formatSubtopic: (s: string) => s,
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// Global fetch mock
const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  global.fetch = fetchMock as typeof global.fetch;

  // Default mocks for initial loads
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.includes('/api/entities/users')) {
      return new Response(
        JSON.stringify([
          { id: 'user-1', email: 'alice@example.com', display_name: 'Alice Smith' },
          { id: 'user-2', email: 'bob@example.com', display_name: 'Bob Jones' },
        ]),
        { status: 200 },
      );
    }

    if (typeof url === 'string' && url.includes('/api/review/assignments')) {
      return new Response(
        JSON.stringify({ assignments: [] }),
        { status: 200 },
      );
    }

    if (typeof url === 'string' && url.includes('/api/review/queue')) {
      return new Response(
        JSON.stringify({ total: 42, items: [] }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({}), { status: 200 });
  });
});

afterEach(() => {
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AssignmentManager', () => {
  it('renders the create assignment form', async () => {
    render(<AssignmentManager />);

    expect(screen.getByText('Create Review Assignment')).toBeInTheDocument();
    expect(screen.getByText('Reviewer')).toBeInTheDocument();
    expect(screen.getByText('Domains')).toBeInTheDocument();
    expect(screen.getByText('Content Types')).toBeInTheDocument();
    expect(screen.getByText('Freshness')).toBeInTheDocument();
    expect(screen.getByText('Due Date (optional)')).toBeInTheDocument();
    expect(screen.getByText('Notes (optional)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create assignment/i })).toBeInTheDocument();
  });

  it('loads and displays team members', async () => {
    render(<AssignmentManager />);

    // Initially shows loading text
    expect(screen.getByText(/loading team members/i)).toBeInTheDocument();

    // Wait for members to load
    await waitFor(() => {
      expect(screen.queryByText(/loading team members/i)).not.toBeInTheDocument();
    });
  });

  it('renders domain checkboxes from taxonomy', async () => {
    render(<AssignmentManager />);

    // Domain names from the mocked taxonomy
    expect(screen.getByLabelText('Filter by H&S')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Environmental')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by Quality')).toBeInTheDocument();
  });

  it('renders freshness checkboxes', () => {
    render(<AssignmentManager />);

    expect(screen.getByLabelText('Filter by fresh')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by aging')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by stale')).toBeInTheDocument();
    expect(screen.getByLabelText('Filter by expired')).toBeInTheDocument();
  });

  it('toggles domain selection on checkbox click', async () => {
    const user = userEvent.setup();
    render(<AssignmentManager />);

    const hsCheckbox = screen.getByLabelText('Filter by H&S');
    expect(hsCheckbox).not.toBeChecked();

    await user.click(hsCheckbox);
    expect(hsCheckbox).toBeChecked();

    await user.click(hsCheckbox);
    expect(hsCheckbox).not.toBeChecked();
  });

  it('shows notes input with max length', () => {
    render(<AssignmentManager />);

    const notesInput = screen.getByPlaceholderText(/focus on items imported/i);
    expect(notesInput).toBeInTheDocument();
    expect(notesInput).toHaveAttribute('maxlength', '500');
  });

  it('shows estimated item count', async () => {
    render(<AssignmentManager />);

    await waitFor(() => {
      expect(screen.getByText(/estimated items/i)).toBeInTheDocument();
      expect(screen.getByText('42')).toBeInTheDocument();
    });
  });

  it('displays active assignments section when assignments exist', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/entities/users')) {
        return new Response(
          JSON.stringify([
            { id: 'user-1', email: 'alice@example.com', display_name: 'Alice' },
          ]),
          { status: 200 },
        );
      }

      if (typeof url === 'string' && url.includes('/api/review/assignments')) {
        return new Response(
          JSON.stringify({
            assignments: [
              {
                id: 'assign-1',
                reviewer_id: 'user-1',
                assigned_by: 'admin-1',
                status: 'active',
                notes: 'Review H&S items',
                filter_domains: ['H&S'],
                filter_content_types: [],
                filter_freshness: [],
                item_count: 10,
                due_date: '2026-04-01T00:00:00.000Z',
                created_at: '2026-03-25T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (typeof url === 'string' && url.includes('/api/review/queue')) {
        return new Response(
          JSON.stringify({ total: 42, items: [] }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<AssignmentManager />);

    await waitFor(() => {
      expect(screen.getByText('Active Assignments')).toBeInTheDocument();
    });

    // Assignment details visible
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Review H&S items')).toBeInTheDocument();

    // Action buttons visible (within the Active Assignments card)
    expect(screen.getByRole('button', { name: /complete/i })).toBeInTheDocument();
    // Use getAllByRole since there may be other cancel-like buttons; just check it exists
    const cancelButtons = screen.getAllByRole('button', { name: /cancel/i });
    expect(cancelButtons.length).toBeGreaterThan(0);
  });

  it('calls PATCH to complete an assignment', async () => {
    const user = userEvent.setup();

    fetchMock.mockImplementation(async (url: string, options?: RequestInit) => {
      if (typeof url === 'string' && url.includes('/api/entities/users')) {
        return new Response(
          JSON.stringify([
            { id: 'user-1', email: 'alice@example.com', display_name: 'Alice' },
          ]),
          { status: 200 },
        );
      }

      if (typeof url === 'string' && url.includes('/api/review/assignments')) {
        if (options?.method === 'PATCH') {
          return new Response(
            JSON.stringify({ assignment: { id: 'assign-1', status: 'completed' } }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            assignments: [
              {
                id: 'assign-1',
                reviewer_id: 'user-1',
                assigned_by: 'admin-1',
                status: 'active',
                notes: null,
                filter_domains: [],
                filter_content_types: [],
                filter_freshness: [],
                item_count: 5,
                due_date: null,
                created_at: '2026-03-25T00:00:00.000Z',
              },
            ],
          }),
          { status: 200 },
        );
      }

      if (typeof url === 'string' && url.includes('/api/review/queue')) {
        return new Response(
          JSON.stringify({ total: 5, items: [] }),
          { status: 200 },
        );
      }

      return new Response(JSON.stringify({}), { status: 200 });
    });

    render(<AssignmentManager />);

    await waitFor(() => {
      expect(screen.getByText('Active Assignments')).toBeInTheDocument();
    });

    const completeBtn = screen.getByRole('button', { name: /complete/i });
    await user.click(completeBtn);

    // Verify PATCH was called
    await waitFor(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const patchCalls = (fetchMock.mock.calls as any[]).filter(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('/api/review/assignments') &&
          call[1]?.method === 'PATCH',
      );
      expect(patchCalls).toHaveLength(1);
      const body = JSON.parse(patchCalls[0][1].body as string);
      expect(body.id).toBe('assign-1');
      expect(body.status).toBe('completed');
    });
  });
});
