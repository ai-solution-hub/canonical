/**
 * PrioritySelector Component Tests
 *
 * Tests the PrioritySelector component — optimistic priority updates
 * with rollback on API failure, popover options, and disabled state.
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
    warning: vi.fn(),
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

// Import AFTER mocks
import {
  PrioritySelector,
  PriorityBadge,
} from '@/components/shared/priority-selector';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchSuccess() {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ ok: true }), { status: 200 }),
  );
}

function mockFetchFailure(message = 'Server error') {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify({ error: message }), { status: 500 }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PrioritySelector', () => {
  beforeEach(() => {
    mockToast.mockClear();
    mockToast.error.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders with the current priority label in aria-label', () => {
    render(<PrioritySelector itemId="item-1" priority="high" />);
    expect(screen.getByLabelText('Priority: High')).toBeInTheDocument();
  });

  it('renders "Set priority" label when priority is null', () => {
    render(<PrioritySelector itemId="item-1" priority={null} />);
    expect(screen.getByLabelText('Set priority')).toBeInTheDocument();
  });

  it('shows priority options dropdown on click', async () => {
    const user = userEvent.setup();
    render(<PrioritySelector itemId="item-1" priority={null} />);

    await user.click(screen.getByLabelText('Set priority'));

    await waitFor(() => {
      expect(screen.getByText('High')).toBeInTheDocument();
      expect(screen.getByText('Medium')).toBeInTheDocument();
      expect(screen.getByText('Low')).toBeInTheDocument();
      expect(screen.getByText('Clear')).toBeInTheDocument();
    });
  });

  it('calls onChanged with new priority on selection', async () => {
    const user = userEvent.setup();
    mockFetchSuccess();
    const onChanged = vi.fn();

    render(
      <PrioritySelector
        itemId="item-1"
        priority={null}
        onChanged={onChanged}
      />,
    );

    await user.click(screen.getByLabelText('Set priority'));
    await waitFor(() => {
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    await user.click(screen.getByText('High'));

    expect(onChanged).toHaveBeenCalledWith('high');
  });

  it('performs optimistic update immediately', async () => {
    const user = userEvent.setup();
    // Delay the fetch so we can observe the optimistic state
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      () =>
        new Promise((resolve) =>
          setTimeout(
            () =>
              resolve(
                new Response(JSON.stringify({ ok: true }), { status: 200 }),
              ),
            100,
          ),
        ),
    );

    render(<PrioritySelector itemId="item-1" priority={null} />);

    await user.click(screen.getByLabelText('Set priority'));
    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Medium'));

    // Immediately after click, the aria-label should reflect the optimistic update
    expect(screen.getByLabelText('Priority: Medium')).toBeInTheDocument();
  });

  it('rolls back on API failure and shows error toast', async () => {
    const user = userEvent.setup();
    mockFetchFailure('Server error');
    const onChanged = vi.fn();

    render(
      <PrioritySelector itemId="item-1" priority="low" onChanged={onChanged} />,
    );

    // Open popover
    await user.click(screen.getByLabelText('Priority: Low'));
    await waitFor(() => {
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    // Select High
    await user.click(screen.getByText('High'));

    // First call is the optimistic update
    expect(onChanged).toHaveBeenCalledWith('high');

    // After fetch resolves with error, should rollback
    await waitFor(() => {
      expect(onChanged).toHaveBeenCalledWith('low');
      expect(mockToast.error).toHaveBeenCalledWith('Failed to update priority');
    });

    // The button label should revert to "low"
    expect(screen.getByLabelText('Priority: Low')).toBeInTheDocument();
  });

  it('shows success toast after API success', async () => {
    const user = userEvent.setup();
    mockFetchSuccess();

    render(<PrioritySelector itemId="item-1" priority={null} />);

    await user.click(screen.getByLabelText('Set priority'));
    await waitFor(() => {
      expect(screen.getByText('High')).toBeInTheDocument();
    });

    await user.click(screen.getByText('High'));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith('Priority: High', {
        duration: 1500,
      });
    });
  });

  it('sends PATCH request to correct API endpoint', async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );

    render(<PrioritySelector itemId="item-42" priority={null} />);

    await user.click(screen.getByLabelText('Set priority'));
    await waitFor(() => {
      expect(screen.getByText('Medium')).toBeInTheDocument();
    });

    await user.click(screen.getByText('Medium'));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith('/api/items/item-42/priority', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priority: 'medium' }),
      });
    });
  });
});

// ---------------------------------------------------------------------------
// PriorityBadge tests
// ---------------------------------------------------------------------------

describe('PriorityBadge', () => {
  it('renders badge with visible text for high priority', () => {
    render(<PriorityBadge priority="high" />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.getByTitle('High priority')).toBeInTheDocument();
  });

  it('renders badge with visible text for medium priority', () => {
    render(<PriorityBadge priority="medium" />);
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByTitle('Medium priority')).toBeInTheDocument();
  });

  it('renders badge with visible text for low priority', () => {
    render(<PriorityBadge priority="low" />);
    expect(screen.getByText('Low')).toBeInTheDocument();
    expect(screen.getByTitle('Low priority')).toBeInTheDocument();
  });

  it('renders nothing for null priority', () => {
    const { container } = render(<PriorityBadge priority={null} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing for invalid priority value', () => {
    const { container } = render(<PriorityBadge priority="invalid" />);
    expect(container.innerHTML).toBe('');
  });
});
