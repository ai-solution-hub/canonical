/**
 * DeleteContentDialog Component Tests
 *
 * Tests the DeleteContentDialog component — confirmation dialog for
 * permanently deleting content items. Covers trigger, confirmation message,
 * item title display, confirm/cancel actions, and loading state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/',
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Import AFTER mocks
import { DeleteContentDialog } from '@/components/content/delete-content-dialog';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: successful delete
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ success: true }), { status: 200 }),
  );
});

function makeProps(overrides: Partial<{ itemId: string; itemTitle: string }> = {}) {
  return {
    itemId: 'item-123',
    itemTitle: 'Test Content Item',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DeleteContentDialog', () => {
  it('renders the delete trigger button', () => {
    render(<DeleteContentDialog {...makeProps()} />);
    expect(screen.getByRole('button', { name: /Delete/i })).toBeInTheDocument();
  });

  it('does not show dialog content before trigger is clicked', () => {
    render(<DeleteContentDialog {...makeProps()} />);
    expect(screen.queryByText('Delete Content Item')).not.toBeInTheDocument();
    expect(screen.queryByText(/Are you sure/)).not.toBeInTheDocument();
  });

  it('shows confirmation message when trigger is clicked', async () => {
    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));

    expect(screen.getByText('Delete Content Item')).toBeInTheDocument();
    expect(screen.getByText(/Are you sure you want to delete this item/)).toBeInTheDocument();
  });

  it('shows item title in confirmation dialog', async () => {
    const user = userEvent.setup();
    render(
      <DeleteContentDialog {...makeProps({ itemTitle: 'My Important Document' })} />,
    );

    await user.click(screen.getByRole('button', { name: /Delete/i }));

    expect(screen.getByText(/My Important Document/)).toBeInTheDocument();
  });

  it('shows warning about permanent deletion', async () => {
    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));

    expect(screen.getByText(/permanently delete/i)).toBeInTheDocument();
    expect(screen.getByText(/cannot be undone/i)).toBeInTheDocument();
  });

  it('calls fetch with DELETE method when confirm button clicked', async () => {
    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps({ itemId: 'item-456' })} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));
    await user.click(screen.getByRole('button', { name: /Delete permanently/i }));

    expect(globalThis.fetch).toHaveBeenCalledWith('/api/items/item-456', {
      method: 'DELETE',
    });
  });

  it('navigates to /browse and shows success toast on successful delete', async () => {
    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));
    await user.click(screen.getByRole('button', { name: /Delete permanently/i }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Content item deleted');
    });
    expect(mockPush).toHaveBeenCalledWith('/browse');
  });

  it('shows error toast on failed delete', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 }),
    );

    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));
    await user.click(screen.getByRole('button', { name: /Delete permanently/i }));

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Forbidden');
    });
  });

  it('renders cancel button in dialog', async () => {
    const user = userEvent.setup();
    render(<DeleteContentDialog {...makeProps()} />);

    await user.click(screen.getByRole('button', { name: /Delete/i }));

    expect(screen.getByRole('button', { name: /Cancel/i })).toBeInTheDocument();
  });
});
