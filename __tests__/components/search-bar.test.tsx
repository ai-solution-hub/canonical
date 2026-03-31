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
    expect(screen.getByPlaceholderText('Search your knowledge base...')).toBeInTheDocument();
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
    const stored = JSON.parse(localStorage.getItem('kb-recent-searches') ?? '[]');
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
});
