/**
 * ContentSuggestionsSection Component Tests
 *
 * Tests:
 *   - Loading state
 *   - Renders suggestions with domain badges and Claude buttons
 *   - Empty state (no suggestions)
 *   - Error state
 *   - Links to coverage page
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => ['Security', 'Compliance', 'Corporate'],
    getSubtopics: () => [],
    getDomainColourKey: (name: string) => name.toLowerCase(),
    formatSubtopic: (s: string) => s,
    formatDomainName: (d: string) => d,
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/claude-prompt-button', () => ({
  ClaudePromptButton: ({ label }: { label: string; prompt: string }) => (
    <button data-testid="claude-prompt-button">{label}</button>
  ),
}));

vi.mock('@/components/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

const { ContentSuggestionsSection } = await import(
  '@/components/dashboard/content-suggestions-section'
);

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const SAMPLE_SUGGESTIONS = [
  {
    id: 'abc123',
    suggestion_type: 'empty_subtopic',
    priority: 'critical',
    domain: 'Security',
    subtopic: 'Certifications',
    title: 'No content for Certifications',
    description: 'Security has zero content for Certifications.',
    suggested_content_type: 'policy',
    item_count: 0,
  },
  {
    id: 'def456',
    suggestion_type: 'stale_only',
    priority: 'high',
    domain: 'Compliance',
    subtopic: 'ISO Standards',
    title: 'All content stale in ISO Standards',
    description: 'Compliance / ISO Standards has 2 items, all stale or expired.',
    item_count: 2,
    freshness_breakdown: { fresh: 0, aging: 0, stale: 1, expired: 1 },
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ContentSuggestionsSection', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = mockFetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('shows loading skeletons initially', () => {
    // Never resolves — stays in loading state
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<ContentSuggestionsSection />);

    expect(screen.getByLabelText('Content suggestions')).toBeInTheDocument();
  });

  it('renders suggestions after loading', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SUGGESTIONS,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      expect(screen.getByText('No content for Certifications')).toBeInTheDocument();
    });

    // Check domain badges are rendered
    const badges = screen.getAllByTestId('domain-badge');
    expect(badges.length).toBe(2);
    expect(badges[0]).toHaveTextContent('Security');
    expect(badges[1]).toHaveTextContent('Compliance');

    // Check Claude prompt buttons are rendered
    const buttons = screen.getAllByTestId('claude-prompt-button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders priority labels', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SUGGESTIONS,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      expect(screen.getByText('Critical')).toBeInTheDocument();
      expect(screen.getByText('High')).toBeInTheDocument();
    });
  });

  it('renders nothing when no suggestions returned', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    const { container } = render(<ContentSuggestionsSection />);

    await waitFor(() => {
      // Should not render the section at all
      expect(container.querySelector('[aria-label="Content suggestions"]')).toBeNull();
    });
  });

  it('shows error state on fetch failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      expect(screen.getByText(/could not load suggestions/i)).toBeInTheDocument();
    });
  });

  it('shows "Fill all gaps" button when 2+ suggestions', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SUGGESTIONS,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      const fillAllButton = screen.getAllByTestId('claude-prompt-button')
        .find((btn) => btn.textContent === 'Fill all gaps');
      expect(fillAllButton).toBeDefined();
    });
  });

  it('includes coverage page links', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SUGGESTIONS,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      const links = screen.getAllByRole('link', { name: /coverage/i });
      expect(links.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('passes limit query param to API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => [],
    });

    render(<ContentSuggestionsSection limit={3} />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith('/api/content-suggestions?limit=3');
    });
  });

  it('renders freshness bar for suggestions with freshness_breakdown', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => SAMPLE_SUGGESTIONS,
    });

    render(<ContentSuggestionsSection />);

    await waitFor(() => {
      // The stale_only suggestion has freshness_breakdown
      const freshnessBar = screen.getByRole('img', { name: /freshness/i });
      expect(freshnessBar).toBeInTheDocument();
    });
  });
});
