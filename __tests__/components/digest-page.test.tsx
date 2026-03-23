/**
 * DigestPage Component Tests
 *
 * Tests the digest page — loading state, hero/generate states, mode selector,
 * custom filters, generation flow, past digests, and accessibility.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const {
  mockMarkBulkRead,
  mockLoadReadMarks,
  mockGetDomainNames,
  mockFetch,
  mockToast,
  mockFormatDate,
  mockDigestTypeLabel,
} = vi.hoisted(() => ({
  mockMarkBulkRead: vi.fn().mockResolvedValue(undefined),
  mockLoadReadMarks: vi.fn(),
  mockGetDomainNames: vi.fn(() => ['Corporate', 'Technical', 'Commercial']),
  mockFetch: vi.fn(),
  mockToast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  mockFormatDate: vi.fn((d: string) => d ? d.slice(0, 10) : ''),
  mockDigestTypeLabel: vi.fn((t: string) => {
    switch (t) {
      case 'weekly': return 'Weekly Digest';
      case 'daily': return 'Daily Digest';
      default: return 'Custom Digest';
    }
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/digest',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/contexts/read-marks-context', () => ({
  useReadMarks: () => ({
    markBulkRead: mockMarkBulkRead,
    loadReadMarks: mockLoadReadMarks,
  }),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: mockGetDomainNames,
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/components/digest-view', () => ({
  DigestView: ({ digest }: { digest: { id: string } }) => (
    <div data-testid="digest-view">DigestView: {digest.id}</div>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatDate: mockFormatDate,
}));

vi.mock('@/lib/digest-helpers', () => ({
  digestTypeLabel: mockDigestTypeLabel,
}));

// Import AFTER mocks
import DigestPage from '@/app/digest/page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDigest(overrides: Record<string, unknown> = {}) {
  return {
    id: 'digest-1',
    digest_type: 'weekly',
    period_start: '2026-03-01T00:00:00Z',
    period_end: '2026-03-08T00:00:00Z',
    item_count: 5,
    domain_summaries: [
      {
        domain: 'Corporate',
        item_count: 3,
        summary: 'Summary text',
        top_items: [
          { id: 'item-1', title: 'Item 1' },
          { id: 'item-2', title: 'Item 2' },
        ],
        key_themes: ['theme-1'],
      },
    ],
    theme_clusters: [],
    narrative_summary: 'A narrative summary.',
    generated_at: '2026-03-08T12:00:00Z',
    generated_by: 'system',
    tokens_used: 100,
    item_ids: ['item-1', 'item-2'],
    created_at: '2026-03-08T12:00:00Z',
    ...overrides,
  };
}

function makePastDigestEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'past-digest-1',
    digest_type: 'weekly',
    period_start: '2026-02-22T00:00:00Z',
    period_end: '2026-03-01T00:00:00Z',
    item_count: 8,
    created_at: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

/**
 * Configure mockFetch to respond to the three API endpoints.
 */
function setupFetch(options: {
  latest?: Record<string, unknown> | null;
  list?: Record<string, unknown>[];
  generateResult?: Record<string, unknown> | null;
  generateError?: string | null;
} = {}) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    if (urlStr.includes('/api/digest/latest')) {
      return {
        ok: true,
        json: async () => ({ digest: options.latest ?? null }),
      };
    }

    if (urlStr.includes('/api/digest/list')) {
      return {
        ok: true,
        json: async () => ({ digests: options.list ?? [] }),
      };
    }

    if (urlStr.includes('/api/digest/generate')) {
      if (options.generateError) {
        return {
          ok: false,
          json: async () => ({ error: options.generateError }),
        };
      }
      return {
        ok: true,
        json: async () => ({ digest: options.generateResult ?? makeDigest() }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DigestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // 1. Loading state
  it('shows loading skeleton on initial load', () => {
    // fetch never resolves — stays in loading state
    mockFetch.mockImplementation(() => new Promise(() => {}));
    render(<DigestPage />);

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  // 2. No digest (hero state)
  it('shows hero state when no digest exists', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/summary of your recent content/),
    ).toBeInTheDocument();
  });

  // 3. Mode selector tabs
  it('renders three mode tabs with correct aria attributes', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const tablist = screen.getByRole('tablist', { name: 'Digest mode' });
    expect(tablist).toBeInTheDocument();

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    // First tab (Period) should be selected by default
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  // 4. Preset mode: period select and generate button
  it('shows generate button in preset mode', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    expect(screen.getByRole('button', { name: /Generate Digest/i })).toBeInTheDocument();
  });

  // 5. Daily mode
  it('shows daily mode text when Daily tab is selected', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const dailyTab = screen.getByRole('tab', { name: /Daily/i });
    await user.click(dailyTab);

    expect(screen.getByText(/Summarise today/)).toBeInTheDocument();
  });

  // 6. Custom mode: shows filter panel
  it('shows custom filter panel when Custom tab is selected', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const customTab = screen.getByRole('tab', { name: /Custom/i });
    await user.click(customTab);

    expect(screen.getByText('Custom Digest Filters')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByLabelText('Domain')).toBeInTheDocument();
    expect(screen.getByLabelText(/Keywords/)).toBeInTheDocument();
  });

  // 7. Custom filter badges
  it('shows active filter badges in custom mode and removes on click', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const customTab = screen.getByRole('tab', { name: /Custom/i });
    await user.click(customTab);

    // Type keywords
    const keywordsInput = screen.getByLabelText(/Keywords/);
    await user.clear(keywordsInput);
    await user.type(keywordsInput, 'ai agents, claude');

    expect(screen.getByText('Active filters:')).toBeInTheDocument();
    expect(screen.getByText('ai agents')).toBeInTheDocument();
    expect(screen.getByText('claude')).toBeInTheDocument();

    // Remove the 'claude' keyword badge
    const removeButton = screen.getByRole('button', { name: 'Remove keyword filter: claude' });
    await user.click(removeButton);

    expect(screen.queryByText('claude')).not.toBeInTheDocument();
    expect(screen.getByText('ai agents')).toBeInTheDocument();
  });

  // 8. Generate preset digest
  it('calls fetch with correct body when generating preset digest', async () => {
    const user = userEvent.setup();
    const generatedDigest = makeDigest({ id: 'new-digest' });
    setupFetch({ latest: null, list: [], generateResult: generatedDigest });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: /Generate Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/digest/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"period_days":7'),
        }),
      );
    });
  });

  // 9. Generate custom digest
  it('calls fetch with custom filters when generating custom digest', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [], generateResult: makeDigest() });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const customTab = screen.getByRole('tab', { name: /Custom/i });
    await user.click(customTab);

    const keywordsInput = screen.getByLabelText(/Keywords/);
    await user.clear(keywordsInput);
    await user.type(keywordsInput, 'ai agents');

    const generateButton = screen.getByRole('button', { name: /Generate Custom Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/digest/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"digest_type":"custom"'),
        }),
      );
    });
  });

  // 10. Generating state shows spinner text
  it('shows generating text during generation', async () => {
    const user = userEvent.setup();
    // Make generate hang so we can see the generating state
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/digest/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/generate')) {
        return new Promise(() => {}); // never resolves
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: /Generate Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByText('Generating...')).toBeInTheDocument();
    });
  });

  // 11. Successful generation updates view
  it('shows DigestView after successful generation', async () => {
    const user = userEvent.setup();
    const generatedDigest = makeDigest({ id: 'generated-1' });
    setupFetch({ latest: null, list: [], generateResult: generatedDigest });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: /Generate Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(mockToast.success).toHaveBeenCalledWith('Digest generated successfully');
  });

  // 12. Generation error
  it('shows toast error when generation fails', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [], generateError: 'Insufficient content' });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: /Generate Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Insufficient content');
    });
  });

  // 13. Digest view state renders controls and DigestView
  it('renders bar controls and DigestView when digest exists', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    // Bar variant shows "Generate New" not "Generate Digest"
    expect(screen.getByRole('button', { name: /Generate New/i })).toBeInTheDocument();
  });

  // 14. Mark all as read
  it('calls markBulkRead with item IDs when mark all as read is clicked', async () => {
    const user = userEvent.setup();
    const digest = makeDigest({ item_ids: ['item-1', 'item-2', 'item-3'] });
    setupFetch({ latest: digest, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    const markAllButton = screen.getByRole('button', { name: /Mark all as read/i });
    await user.click(markAllButton);

    await waitFor(() => {
      expect(mockMarkBulkRead).toHaveBeenCalledWith(
        ['item-1', 'item-2', 'item-3'],
        'digest',
      );
    });
  });

  // 15. Past digests list
  it('renders previous digests excluding the current one', async () => {
    const digest = makeDigest({ id: 'current-digest' });
    const pastList = [
      { ...digest, id: 'current-digest' },
      makePastDigestEntry({ id: 'past-1' }),
      makePastDigestEntry({ id: 'past-2' }),
    ];
    setupFetch({ latest: digest, list: pastList });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.getByText('Previous Digests')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Previous digests' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  // 16. Load past digest
  it('loads a past digest when clicked', async () => {
    const user = userEvent.setup();
    const currentDigest = makeDigest({ id: 'current-digest' });
    const pastEntry = makePastDigestEntry({ id: 'past-1' });
    setupFetch({ latest: currentDigest, list: [currentDigest, pastEntry] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Previous Digests')).toBeInTheDocument();
    });

    // Click the past digest entry — this triggers loadDigest which calls fetch
    const list = screen.getByRole('list', { name: 'Previous digests' });
    const pastButton = within(list).getAllByRole('button')[0];
    await user.click(pastButton);

    // It should have called fetch to load the full digest
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/digest/list?limit=50'),
      );
    });
  });

  // 17. Empty past digests
  it('does not render previous digests section when none exist', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [digest] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.queryByText('Previous Digests')).not.toBeInTheDocument();
  });

  // 18. aria-live regions
  it('has aria-live region during generating state', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/digest/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/generate')) {
        return new Promise(() => {});
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Generate Digest/i }));

    await waitFor(() => {
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  // 19. Content digest section has correct aria-label
  it('wraps content in section with correct aria-label', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    expect(screen.getByRole('region', { name: 'Content digest' })).toBeInTheDocument();
  });

  // 20. Mode switching works correctly
  it('switches between all three modes', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    // Start in preset mode
    expect(screen.getByRole('tab', { name: /Period/i })).toHaveAttribute('aria-selected', 'true');

    // Switch to daily
    await user.click(screen.getByRole('tab', { name: /Daily/i }));
    expect(screen.getByRole('tab', { name: /Daily/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Period/i })).toHaveAttribute('aria-selected', 'false');

    // Switch to custom
    await user.click(screen.getByRole('tab', { name: /Custom/i }));
    expect(screen.getByRole('tab', { name: /Custom/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /Daily/i })).toHaveAttribute('aria-selected', 'false');
  });

  // 21. loadReadMarks is called on mount
  it('calls loadReadMarks on mount', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(mockLoadReadMarks).toHaveBeenCalled();
    });
  });

  // 22. Mark all as read extracts IDs from domain_summaries when item_ids is empty
  it('extracts item IDs from domain_summaries when item_ids is not present', async () => {
    const user = userEvent.setup();
    const digest = makeDigest({
      item_ids: [],
      domain_summaries: [
        {
          domain: 'Corporate',
          item_count: 2,
          summary: 'Summary',
          top_items: [
            { id: 'ds-item-1', title: 'DS Item 1' },
            { id: 'ds-item-2', title: 'DS Item 2' },
          ],
          key_themes: [],
        },
      ],
    });
    setupFetch({ latest: digest, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Mark all as read/i }));

    await waitFor(() => {
      expect(mockMarkBulkRead).toHaveBeenCalledWith(
        ['ds-item-1', 'ds-item-2'],
        'digest',
      );
    });
  });

  // 23. Generate button is disabled during generation
  it('disables generate button while generating', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/digest/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/digest/generate')) {
        return new Promise(() => {});
      }
      return { ok: true, json: async () => ({}) };
    });

    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', { name: /Generate Digest/i });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Generating/i })).toBeDisabled();
    });
  });

  // 24. tabpanel has correct aria-labelledby
  it('renders tabpanel with correct aria-labelledby for active mode', async () => {
    setupFetch({ latest: null, list: [] });
    render(<DigestPage />);

    await waitFor(() => {
      expect(screen.getByText('Content Digest')).toBeInTheDocument();
    });

    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel).toHaveAttribute('aria-labelledby', 'tab-preset');
  });
});
