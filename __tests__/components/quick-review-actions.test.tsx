/**
 * QuickReviewActions Component Tests
 *
 * Tests the compact verify/flag button group for browse content cards and rows.
 * Covers role gating, button state, popover interaction, and API calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock useUserRole
const mockCanEdit = { value: true };
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: mockCanEdit.value ? 'editor' : 'viewer',
    loading: false,
    canEdit: mockCanEdit.value,
    canAdmin: false,
  }),
}));

// Mock sonner
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

import { QuickReviewActions } from '@/components/content/quick-review-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchOk() {
  global.fetch = vi.fn().mockResolvedValue({ ok: true });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('QuickReviewActions', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetchOk();
    mockCanEdit.value = true;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('renders nothing when canEdit is false', () => {
    const { container } = render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={false}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders verify and flag buttons when canEdit is true', () => {
    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
    expect(screen.getByLabelText('Flag for review')).toBeInTheDocument();
  });

  it('verify button shows "Verify" label when verifiedAt is null', () => {
    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Verify')).toBeInTheDocument();
  });

  it('verify button shows "Unverify" label when verifiedAt is set', () => {
    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt="2026-01-01T00:00:00Z"
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Unverify')).toBeInTheDocument();
  });

  it('click verify calls API with verify action', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Verify'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: 'item-1', action: 'verify' }),
      });
    });
  });

  it('click verify calls stopPropagation', () => {
    const parentClick = vi.fn();

    render(
       
      <div onClick={parentClick}>
        <QuickReviewActions
          itemId="item-1"
          itemTitle="Test"
          verifiedAt={null}
          canEdit={true}
        />
      </div>,
    );

    fireEvent.click(screen.getByLabelText('Verify'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('flag button opens popover on click', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag for review'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Why does this need attention?')).toBeInTheDocument();
    });
  });

  it('flag popover has reason input and submit button', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag for review'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Why does this need attention?')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });
  });

  it('submit flag with reason calls API with flag_details', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag for review'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Why does this need attention?')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Why does this need attention?');
    await user.type(input, 'Outdated info');
    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: 'item-1',
          action: 'flag',
          flag_details: 'Outdated info',
        }),
      });
    });
  });

  it('submit flag with empty reason omits flag_details', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag for review'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Submit' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Submit' }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: 'item-1', action: 'flag' }),
      });
    });
  });

  it('Enter key in flag input submits', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Flag for review'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Why does this need attention?')).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText('Why does this need attention?');
    await user.type(input, 'Needs review');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: 'item-1',
          action: 'flag',
          flag_details: 'Needs review',
        }),
      });
    });
  });

  it('unflag button visible when hasQualityFlag is true', () => {
    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        hasQualityFlag={true}
        canEdit={true}
      />,
    );
    expect(screen.getByLabelText('Resolve flag')).toBeInTheDocument();
  });

  it('click unflag calls API directly (no popover)', async () => {
    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        hasQualityFlag={true}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Resolve flag'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/review/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_id: 'item-1', action: 'unflag' }),
      });
    });
  });

  it('buttons disabled while pending', async () => {
    let resolvePromise!: () => void;
    global.fetch = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = () => resolve({ ok: true });
      }),
    );

    const user = userEvent.setup();

    render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
        canEdit={true}
      />,
    );

    await user.click(screen.getByLabelText('Verify'));

    await waitFor(() => {
      const buttons = screen.getAllByRole('button');
      buttons.forEach((btn) => {
        expect(btn).toBeDisabled();
      });
    });

    // Cleanup
    resolvePromise();
  });

  it('falls back to useUserRole when canEdit prop is undefined', () => {
    mockCanEdit.value = false;

    const { container } = render(
      <QuickReviewActions
        itemId="item-1"
        itemTitle="Test"
        verifiedAt={null}
      />,
    );

    // Should render nothing because useUserRole returns canEdit=false
    expect(container.innerHTML).toBe('');
  });
});
