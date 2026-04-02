/**
 * StarButton Component Tests
 *
 * Tests the StarButton component — star rendering, toggling, optimistic
 * updates, Supabase RPC calls, and rollback on error.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRpc } = vi.hoisted(() => ({
  mockRpc: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    rpc: mockRpc,
  }),
}));

import { StarButton } from '@/components/shared/star-button';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StarButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders star button', () => {
    render(<StarButton itemId="item-1" starred={false} />);
    expect(screen.getByRole('button', { name: /star/i })).toBeInTheDocument();
  });

  it('shows filled star label when starred is true', () => {
    render(<StarButton itemId="item-1" starred={true} />);
    expect(
      screen.getByRole('button', { name: 'Remove star' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows outline star label when starred is false', () => {
    render(<StarButton itemId="item-1" starred={false} />);
    expect(
      screen.getByRole('button', { name: 'Star this item' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onToggle on click with optimistic update', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<StarButton itemId="item-1" starred={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('calls supabase rpc toggle_star', async () => {
    const user = userEvent.setup();
    render(<StarButton itemId="item-1" starred={false} />);

    await user.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('toggle_star', {
        p_item_id: 'item-1',
        p_starred: true,
      });
    });
  });

  it('rolls back on API error', async () => {
    mockRpc.mockResolvedValueOnce({ error: { message: 'Fail' } });

    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<StarButton itemId="item-1" starred={false} onToggle={onToggle} />);

    await user.click(screen.getByRole('button'));

    // First call: optimistic (true)
    expect(onToggle).toHaveBeenCalledWith(true);

    // After error: rollback (false)
    await waitFor(() => {
      expect(onToggle).toHaveBeenCalledWith(false);
    });

    // Button should revert to "Star this item"
    expect(
      screen.getByRole('button', { name: 'Star this item' }),
    ).toBeInTheDocument();
  });
});
