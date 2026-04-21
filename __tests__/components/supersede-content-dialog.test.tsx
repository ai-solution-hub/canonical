/**
 * SupersedeContentDialog component tests (S186 WP-B.5).
 *
 * Confirmation modal for admins to mark a content item as superseded by
 * a newer item. Covers trigger rendering, UUID validation, self-ref
 * block, PATCH wiring, error surfacing, and loading state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockRefresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: mockRefresh,
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
import { SupersedeContentDialog } from '@/components/content/supersede-content-dialog';
import { toast } from 'sonner';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(
      JSON.stringify({ success: true, old_item: {}, new_item: {} }),
      { status: 200 },
    ),
  );
});

function makeProps(
  overrides: Partial<{ itemId: string; itemTitle: string }> = {},
) {
  return {
    itemId: OLD_ID,
    itemTitle: 'Old revision',
    ...overrides,
  };
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: /Mark as superseded/i }),
  );
  return user;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SupersedeContentDialog', () => {
  it('renders the trigger button with data-supersede-trigger', () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    const btn = screen.getByRole('button', { name: /Mark as superseded/i });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('data-supersede-trigger');
  });

  it('dialog content is hidden until trigger is clicked', () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    expect(
      screen.queryByText(/Mark item as superseded/i),
    ).not.toBeInTheDocument();
  });

  it('shows item title + UUID input on open', async () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    await openDialog();

    expect(screen.getByText('Mark item as superseded')).toBeInTheDocument();
    expect(screen.getByText(/Old revision/)).toBeInTheDocument();
    expect(
      screen.getByTestId('supersede-new-id-input'),
    ).toBeInTheDocument();
  });

  it('blocks submit when UUID is empty', async () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    await openDialog();
    const confirm = screen.getByRole('button', { name: /Confirm supersession/i });
    expect(confirm).toBeDisabled();
  });

  it('shows inline error for malformed UUID and does not fetch', async () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    const user = await openDialog();

    await user.type(
      screen.getByTestId('supersede-new-id-input'),
      'not-a-uuid',
    );
    await user.click(
      screen.getByRole('button', { name: /Confirm supersession/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /valid UUID/i,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects self-supersession before fetch', async () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    const user = await openDialog();

    await user.type(screen.getByTestId('supersede-new-id-input'), OLD_ID);
    await user.click(
      screen.getByRole('button', { name: /Confirm supersession/i }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /supersede this item with itself/i,
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('sends PATCH with field=superseded_by + value=new_id on confirm', async () => {
    render(<SupersedeContentDialog {...makeProps()} />);
    const user = await openDialog();

    await user.type(screen.getByTestId('supersede-new-id-input'), NEW_ID);
    await user.click(
      screen.getByRole('button', { name: /Confirm supersession/i }),
    );

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        `/api/items/${OLD_ID}`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            field: 'superseded_by',
            value: NEW_ID,
          }),
        }),
      );
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith(
        'Item marked as superseded',
      );
      expect(mockRefresh).toHaveBeenCalled();
    });
  });

  it('shows inline error with error_code when PATCH returns 409', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: 'Cannot form a chain',
          error_code: 'NEW_ALREADY_SUPERSEDED',
        }),
        { status: 409 },
      ),
    );

    render(<SupersedeContentDialog {...makeProps()} />);
    const user = await openDialog();

    await user.type(screen.getByTestId('supersede-new-id-input'), NEW_ID);
    await user.click(
      screen.getByRole('button', { name: /Confirm supersession/i }),
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Cannot form a chain/);
    expect(alert).toHaveTextContent(/NEW_ALREADY_SUPERSEDED/);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
