/**
 * TagAutocomplete Component Tests
 *
 * Tests the TagAutocomplete component — input rendering, suggestion fetching,
 * keyboard navigation, selection, and dropdown behaviour.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { TagAutocomplete } from '@/components/shared/tag-autocomplete';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockFetch(suggestions: Array<{ tag: string; count: number }> = []) {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve(suggestions),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TagAutocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('renders input with combobox role', () => {
    vi.stubGlobal('fetch', createMockFetch());
    render(<TagAutocomplete type="user" onSelect={vi.fn()} />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('shows suggestions dropdown after typing', async () => {
    const mockFetch = createMockFetch([
      { tag: 'security', count: 5 },
      { tag: 'servers', count: 3 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'se');
    // Debounce fires after 200ms
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    expect(screen.getByText('security')).toBeInTheDocument();
    expect(screen.getByText('servers')).toBeInTheDocument();
  });

  it('excludes tags in excludeTags array', async () => {
    const mockFetch = createMockFetch([
      { tag: 'security', count: 5 },
      { tag: 'servers', count: 3 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <TagAutocomplete type="user" onSelect={vi.fn()} excludeTags={['security']} />,
    );

    await user.type(screen.getByRole('combobox'), 'se');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });
    expect(screen.queryByText('security')).not.toBeInTheDocument();
    expect(screen.getByText('servers')).toBeInTheDocument();
  });

  it('ArrowDown/ArrowUp navigates suggestions', async () => {
    const mockFetch = createMockFetch([
      { tag: 'alpha', count: 5 },
      { tag: 'beta', count: 3 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'a');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.keyboard('{ArrowDown}');
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(options[0]).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('Enter selects highlighted suggestion', async () => {
    const mockFetch = createMockFetch([
      { tag: 'alpha', count: 5 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const onSelect = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('alpha');
  });

  it('Enter on empty suggestions creates new tag from input', async () => {
    const mockFetch = createMockFetch([]);
    vi.stubGlobal('fetch', mockFetch);

    const onSelect = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'newtag');
    vi.advanceTimersByTime(250);

    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith('newtag');
  });

  it('Escape closes dropdown', async () => {
    const mockFetch = createMockFetch([
      { tag: 'alpha', count: 5 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={vi.fn()} />);

    await user.type(screen.getByRole('combobox'), 'a');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('click on suggestion calls onSelect', async () => {
    const mockFetch = createMockFetch([
      { tag: 'alpha', count: 5 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const onSelect = vi.fn();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<TagAutocomplete type="user" onSelect={onSelect} />);

    await user.type(screen.getByRole('combobox'), 'a');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    await user.click(screen.getByText('alpha'));
    expect(onSelect).toHaveBeenCalledWith('alpha');
  });

  it('click outside closes dropdown', async () => {
    const mockFetch = createMockFetch([
      { tag: 'alpha', count: 5 },
    ]);
    vi.stubGlobal('fetch', mockFetch);

    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <div>
        <TagAutocomplete type="user" onSelect={vi.fn()} />
        <button>Outside</button>
      </div>,
    );

    await user.type(screen.getByRole('combobox'), 'a');
    vi.advanceTimersByTime(250);

    await waitFor(() => {
      expect(screen.getByRole('listbox')).toBeInTheDocument();
    });

    // Click outside
    await user.click(screen.getByText('Outside'));
    await waitFor(() => {
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    });
  });
});
