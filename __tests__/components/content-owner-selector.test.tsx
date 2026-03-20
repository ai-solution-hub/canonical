/**
 * ContentOwnerSelector Component Tests
 *
 * Tests the combobox for assigning/clearing content owner:
 * rendering, user selection, clearing, loading state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// Mock global fetch
vi.stubGlobal('fetch', mockFetch);

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

import { ContentOwnerSelector } from '@/components/content-owner-selector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MOCK_USERS = [
  { id: 'user-1', display_name: 'Alice Admin', email: 'alice@example.com', role: 'admin' },
  { id: 'user-2', display_name: 'Bob Editor', email: 'bob@example.com', role: 'editor' },
  { id: 'user-3', display_name: null, email: 'viewer@example.com', role: 'viewer' },
];

function setupFetchMock() {
  mockFetch.mockImplementation(async (url: string, options?: RequestInit) => {
    if (url === '/api/admin/users') {
      return {
        ok: true,
        json: async () => MOCK_USERS,
      };
    }
    if (typeof url === 'string' && url.includes('/owner')) {
      return {
        ok: true,
        json: async () => ({ success: true }),
      };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentOwnerSelector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupFetchMock();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', mockFetch);
  });

  it('renders with "Unassigned" when no owner is set', () => {
    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
      />,
    );
    expect(screen.getByRole('button', { name: /unassigned/i })).toBeInTheDocument();
  });

  it('renders with the current owner name', () => {
    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId="user-1"
        currentOwnerName="Alice Admin"
      />,
    );
    expect(screen.getByText('Alice Admin')).toBeInTheDocument();
  });

  it('opens popover and shows eligible users (admin + editor only)', async () => {
    const user = userEvent.setup();
    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /unassigned/i }));

    // Wait for users to load — only admin and editor should appear
    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
      expect(screen.getByText('Bob Editor')).toBeInTheDocument();
    });

    // Viewer should not appear (filtered out)
    expect(screen.queryByText('viewer@example.com')).not.toBeInTheDocument();
  });

  it('shows loading state while fetching users', async () => {
    const user = userEvent.setup();

    // Make fetch hang
    mockFetch.mockImplementation(
      () => new Promise(() => {}), // never resolves
    );

    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /unassigned/i }));

    expect(screen.getByText('Loading users...')).toBeInTheDocument();
  });

  it('calls onOwnerChanged and PATCH API when selecting a user', async () => {
    const user = userEvent.setup();
    const onOwnerChanged = vi.fn();

    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
        onOwnerChanged={onOwnerChanged}
      />,
    );

    await user.click(screen.getByRole('button', { name: /unassigned/i }));

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Alice Admin'));

    // Should have called PATCH /api/items/item-1/owner
    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('/owner') &&
          (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.owner_id).toBe('user-1');
    });

    expect(onOwnerChanged).toHaveBeenCalledWith('user-1');
  });

  it('shows "Clear owner" option when an owner is assigned', async () => {
    const user = userEvent.setup();
    const onOwnerChanged = vi.fn();

    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId="user-1"
        currentOwnerName="Alice Admin"
        onOwnerChanged={onOwnerChanged}
      />,
    );

    await user.click(screen.getByText('Alice Admin'));

    await waitFor(() => {
      expect(screen.getByText('Clear owner')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Clear owner'));

    await waitFor(() => {
      const patchCall = mockFetch.mock.calls.find(
        (call: unknown[]) =>
          typeof call[0] === 'string' &&
          call[0].includes('/owner') &&
          (call[1] as RequestInit)?.method === 'PATCH',
      );
      expect(patchCall).toBeTruthy();
      const body = JSON.parse((patchCall![1] as RequestInit).body as string);
      expect(body.owner_id).toBeNull();
    });

    expect(onOwnerChanged).toHaveBeenCalledWith(null);
  });

  it('filters users by search text', async () => {
    const user = userEvent.setup();

    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
      />,
    );

    await user.click(screen.getByRole('button', { name: /unassigned/i }));

    await waitFor(() => {
      expect(screen.getByText('Alice Admin')).toBeInTheDocument();
    });

    // Type in search box
    const searchInput = screen.getByPlaceholderText('Search users...');
    await user.type(searchInput, 'bob');

    // Alice should be filtered out, Bob should remain
    expect(screen.queryByText('Alice Admin')).not.toBeInTheDocument();
    expect(screen.getByText('Bob Editor')).toBeInTheDocument();
  });

  it('disables the button when disabled prop is true', () => {
    render(
      <ContentOwnerSelector
        itemId="item-1"
        currentOwnerId={null}
        currentOwnerName={null}
        disabled
      />,
    );
    expect(screen.getByRole('button', { name: /unassigned/i })).toBeDisabled();
  });
});
