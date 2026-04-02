/**
 * WorkspaceSelector Component Tests
 *
 * Tests the WorkspaceSelector component — button rendering, workspace badges,
 * popover interaction, loading state, filtering, create option, and API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({ toast: mockToast }));

import { WorkspaceSelector } from '@/components/workspace/workspace-selector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WORKSPACES = [
  {
    id: 'ws-1',
    name: 'Bid Alpha',
    description: null,
    color: '#3b82f6',
    icon: 'folder',
    type: 'bid',
    is_archived: false,
    created_at: '',
    updated_at: '',
  },
  {
    id: 'ws-2',
    name: 'Bid Beta',
    description: null,
    color: '#ef4444',
    icon: 'folder',
    type: 'bid',
    is_archived: false,
    created_at: '',
    updated_at: '',
  },
];

function setupFetch(
  allWorkspaces = WORKSPACES,
  itemWorkspaces: typeof WORKSPACES = [],
) {
  const mockFetch = vi.fn().mockImplementation((url: string) => {
    if (url === '/api/workspaces') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(allWorkspaces),
      });
    }
    if (url.includes('/workspaces')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(itemWorkspaces),
      });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  });
  vi.stubGlobal('fetch', mockFetch);
  return mockFetch;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders "Assign to..." button when no workspaces assigned', () => {
    setupFetch();
    render(<WorkspaceSelector itemId="item-1" />);
    expect(
      screen.getByRole('button', { name: /assign to/i }),
    ).toBeInTheDocument();
  });

  it('renders assigned workspace badges after fetching', async () => {
    setupFetch(WORKSPACES, [WORKSPACES[0]]);
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);

    // Open popover to trigger fetch
    const trigger = screen.getByRole('button', {
      name: /manage assignments|assign to/i,
    });
    await user.click(trigger);

    await waitFor(() => {
      // Both the badge and the list entry show "Bid Alpha"
      const matches = screen.getAllByText('Bid Alpha');
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });

    // The remove badge button should be present
    await waitFor(() => {
      expect(
        screen.getByLabelText('Remove from Bid Alpha'),
      ).toBeInTheDocument();
    });
  });

  it('popover opens with search input', async () => {
    setupFetch();
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);
    await user.click(screen.getByRole('button', { name: /assign to/i }));
    await waitFor(() => {
      expect(
        screen.getByPlaceholderText(/search or create/i),
      ).toBeInTheDocument();
    });
  });

  it('shows loading state while fetching', async () => {
    // Slow fetch that never resolves immediately
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => new Promise(() => {})),
    );
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);
    await user.click(screen.getByRole('button', { name: /assign to/i }));
    await waitFor(() => {
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  it('shows filtered workspace list', async () => {
    setupFetch();
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);
    await user.click(screen.getByRole('button', { name: /assign to/i }));

    await waitFor(() => {
      expect(screen.getByText('Bid Alpha')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search or create/i);
    await user.type(searchInput, 'Beta');

    // Alpha should be hidden, Beta visible
    expect(screen.queryByText('Bid Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Bid Beta')).toBeInTheDocument();
  });

  it('shows create option when search has no match', async () => {
    setupFetch();
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);
    await user.click(screen.getByRole('button', { name: /assign to/i }));

    await waitFor(() => {
      expect(screen.getByText('Bid Alpha')).toBeInTheDocument();
    });

    const searchInput = screen.getByPlaceholderText(/search or create/i);
    await user.type(searchInput, 'New Workspace');

    await waitFor(() => {
      expect(screen.getByText(/Create/)).toBeInTheDocument();
    });
  });

  it('remove badge button calls toggle API', async () => {
    const mockFetch = setupFetch(WORKSPACES, [WORKSPACES[0]]);
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);

    // Open popover to trigger workspace fetch
    await user.click(screen.getByRole('button', { name: /assign to/i }));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Remove from Bid Alpha'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText('Remove from Bid Alpha'));

    // Should call the toggle API
    expect(mockFetch).toHaveBeenCalledWith(
      '/api/items/item-1/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('unassign'),
      }),
    );
  });

  it('workspace toggle calls correct API', async () => {
    const mockFetch = setupFetch(WORKSPACES, []);
    const user = userEvent.setup();
    render(<WorkspaceSelector itemId="item-1" />);

    await user.click(screen.getByRole('button', { name: /assign to/i }));

    await waitFor(() => {
      expect(screen.getByText('Bid Alpha')).toBeInTheDocument();
    });

    // Click on a workspace to assign it
    await user.click(screen.getByText('Bid Alpha'));

    expect(mockFetch).toHaveBeenCalledWith(
      '/api/items/item-1/workspaces',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('assign'),
      }),
    );
  });
});
