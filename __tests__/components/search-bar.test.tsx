import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { SearchBar } from '@/components/browse/search-bar';

describe('SearchBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('renders with default placeholder', () => {
    render(<SearchBar />);
    expect(screen.getByPlaceholderText('Search...')).toBeInTheDocument();
  });

  it('shows full placeholder for hero variant', () => {
    render(<SearchBar variant="hero" />);
    expect(
      screen.getByPlaceholderText('Search your knowledge base...'),
    ).toBeInTheDocument();
  });

  it('renders with default value', () => {
    render(<SearchBar defaultValue="test query" />);
    expect(screen.getByDisplayValue('test query')).toBeInTheDocument();
  });

  it('navigates to search page on form submit', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'knowledge base');
    await user.keyboard('{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/browse?q=knowledge%20base');
  });

  it('does not navigate on empty query submit', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    await user.click(input);
    await user.keyboard('{Enter}');
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('stores recent searches in localStorage', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    await user.type(input, 'my search');
    await user.keyboard('{Enter}');
    const stored = JSON.parse(
      localStorage.getItem('kb-recent-searches') ?? '[]',
    );
    expect(stored).toContain('my search');
  });

  it('has combobox role for accessibility', () => {
    render(<SearchBar />);
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('has search form role', () => {
    render(<SearchBar />);
    expect(screen.getByRole('search')).toBeInTheDocument();
  });

  it('renders hero variant with larger input', () => {
    render(<SearchBar variant="hero" />);
    const input = screen.getByRole('combobox');
    expect(input.className).toContain('h-12');
  });

  it('renders compact variant by default', () => {
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    expect(input.className).toContain('h-9');
  });

  it('trims whitespace from search queries', async () => {
    const user = userEvent.setup();
    render(<SearchBar />);
    const input = screen.getByRole('combobox');
    await user.type(input, '  trimmed search  ');
    await user.keyboard('{Enter}');
    expect(mockPush).toHaveBeenCalledWith('/browse?q=trimmed%20search');
  });

  // ---------------------------------------------------------------------------
  // Inline variant tests (P1-30 Phase 1)
  // ---------------------------------------------------------------------------
  describe('inline variant', () => {
    it('renders with inline placeholder', () => {
      render(<SearchBar variant="inline" />);
      expect(
        screen.getByPlaceholderText('Search your knowledge...'),
      ).toBeInTheDocument();
    });

    it('renders inline input with correct height class', () => {
      render(<SearchBar variant="inline" />);
      const input = screen.getByRole('combobox');
      expect(input.className).toContain('h-10');
    });

    it('does not show keyboard shortcut badge', () => {
      render(<SearchBar variant="inline" />);
      // Compact variant shows Cmd+K / Ctrl+K badge — inline should not
      const kbd = document.querySelector('kbd');
      expect(kbd).toBeNull();
    });

    it('calls onSearch on submit instead of navigating', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar variant="inline" onSearch={onSearch} />);
      const input = screen.getByRole('combobox');
      await user.type(input, 'test query');
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledWith('test query');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('calls onClear when empty form submitted', async () => {
      const onClear = vi.fn();
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(
        <SearchBar variant="inline" onSearch={onSearch} onClear={onClear} />,
      );
      const input = screen.getByRole('combobox');
      await user.click(input);
      await user.keyboard('{Enter}');
      expect(onClear).toHaveBeenCalled();
      expect(onSearch).not.toHaveBeenCalled();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('does not navigate on submit', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar variant="inline" onSearch={onSearch} />);
      const input = screen.getByRole('combobox');
      await user.type(input, 'some query');
      await user.keyboard('{Enter}');
      expect(mockPush).not.toHaveBeenCalled();
    });

    it('forwards inputRef to the underlying input element', () => {
      const ref = { current: null } as React.RefObject<HTMLInputElement | null>;
      render(<SearchBar variant="inline" inputRef={ref} />);
      expect(ref.current).toBeInstanceOf(HTMLInputElement);
    });

    it('renders with defaultValue', () => {
      render(<SearchBar variant="inline" defaultValue="initial search" />);
      expect(screen.getByDisplayValue('initial search')).toBeInTheDocument();
    });

    it('has search form role with search content label', () => {
      render(<SearchBar variant="inline" />);
      const form = screen.getByRole('search');
      expect(form).toHaveAttribute('aria-label', 'Search content');
    });

    it('has combobox role for accessibility', () => {
      render(<SearchBar variant="inline" />);
      expect(screen.getByRole('combobox')).toBeInTheDocument();
    });

    it('stores recent searches in localStorage on submit', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar variant="inline" onSearch={onSearch} />);
      const input = screen.getByRole('combobox');
      await user.type(input, 'inline search');
      await user.keyboard('{Enter}');
      const stored = JSON.parse(
        localStorage.getItem('kb-recent-searches') ?? '[]',
      );
      expect(stored).toContain('inline search');
    });

    it('trims whitespace from inline search queries', async () => {
      const onSearch = vi.fn();
      const user = userEvent.setup();
      render(<SearchBar variant="inline" onSearch={onSearch} />);
      const input = screen.getByRole('combobox');
      await user.type(input, '  trimmed inline  ');
      await user.keyboard('{Enter}');
      expect(onSearch).toHaveBeenCalledWith('trimmed inline');
    });
  });

  // ---------------------------------------------------------------------------
  // Compact variant suggestion parity (SD-9)
  // ---------------------------------------------------------------------------
  describe('compact variant suggestion parity', () => {
    it('calls loadSuggestions on focus (parity with hero)', async () => {
      // Both hero and compact should call loadSuggestions on focus.
      // We verify this by checking that fetch is called when focusing compact.
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ keywords: ['topic1'] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      const user = userEvent.setup();
      render(<SearchBar variant="compact" />);
      const input = screen.getByRole('combobox');
      await user.click(input);
      // loadSuggestions should have been triggered by focus
      expect(fetchSpy).toHaveBeenCalledWith('/api/search/suggestions');
      fetchSpy.mockRestore();
    });
  });
});
