/**
 * DigestPage Component Tests
 *
 * Tests the digest page — loading state, hero/generate states, mode selector,
 * custom filters, generation flow, past digests, and accessibility.
 *
 * Updated for TanStack Query migration (Wave 2A) and digest-to-"Change Report"
 * vocabulary reframing.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';

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
  mockGetUser,
} = vi.hoisted(() => ({
  mockMarkBulkRead: vi.fn().mockResolvedValue(undefined),
  mockLoadReadMarks: vi.fn(),
  mockGetDomainNames: vi.fn(() => ['Corporate', 'Technical', 'Commercial']),
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockFormatDate: vi.fn((d: string) => (d ? d.slice(0, 10) : '')),
  mockDigestTypeLabel: vi.fn((t: string) => {
    switch (t) {
      case 'weekly':
        return 'Weekly Change Report';
      case 'daily':
        return 'Daily Change Report';
      default:
        return 'Custom Change Report';
    }
  }),
  mockGetUser: vi.fn(),
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

vi.mock('@/components/digest/digest-view', () => ({
  DigestView: ({ digest }: { digest: { id: string } }) => (
    <div data-testid="digest-view">DigestView: {digest.id}</div>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatDate: mockFormatDate,
}));

vi.mock('@/lib/digest/digest-helpers', () => ({
  digestTypeLabel: mockDigestTypeLabel,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

// Import AFTER mocks
import DigestPage from '@/app/digest/page';

// ---------------------------------------------------------------------------
// Fixed time anchor for date-sensitive assertions (CLAUDE.md gotcha: pin
// `Date.now()` with `vi.spyOn` so 24h-boundary logic is deterministic).
// ---------------------------------------------------------------------------
const NOW_MS = new Date('2026-04-15T12:00:00Z').getTime();
const HOUR_MS = 60 * 60 * 1000;

/** Return an ISO timestamp for a user created N hours before NOW_MS. */
function userCreatedHoursAgo(hours: number) {
  return new Date(NOW_MS - hours * HOUR_MS).toISOString();
}

/**
 * Default `mockGetUser` for the existing suite — unauthenticated. This keeps
 * `isOver24h` and `isNewAccount` both false so the pre-P0-11 hero copy
 * renders and auto-gen does not fire. The two new P0-11 tests at the bottom
 * override this per-test with `mockOldAccount()` / `mockNewAccount()`.
 */
function mockUnauthenticated() {
  mockGetUser.mockResolvedValue({ data: { user: null } });
}

function mockOldAccount() {
  mockGetUser.mockResolvedValue({
    data: {
      user: { id: 'test-user', created_at: userCreatedHoursAgo(48) },
    },
  });
}

function mockNewAccount() {
  mockGetUser.mockResolvedValue({
    data: {
      user: { id: 'new-user', created_at: userCreatedHoursAgo(2) },
    },
  });
}

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
 * Configure mockFetch to respond to the digest API endpoints.
 */
function setupFetch(
  options: {
    latest?: Record<string, unknown> | null;
    list?: Record<string, unknown>[];
    detail?: Record<string, unknown> | null;
    generateResult?: Record<string, unknown> | null;
    generateError?: string | null;
  } = {},
) {
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

    // Match /api/digest/{id} — the detail endpoint
    if (/\/api\/digest\/(?!latest|list|generate)[^/]+/.test(urlStr)) {
      return {
        ok: true,
        json: async () => ({ digest: options.detail ?? makeDigest() }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

/**
 * Render DigestPage wrapped in QueryClientProvider.
 */
function renderDigestPage() {
  const { Wrapper } = createQueryWrapper();
  return render(<DigestPage />, { wrapper: Wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DigestPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    // Pin Date.now() so the 24h account-age boundary (P0-11 auto-gen
    // gate) is deterministic AND so the `/digest` custom date-range
    // default — computed via a lazy `useState` initialiser in
    // `app/digest/page.tsx` that calls `Date.now()` directly — resolves
    // to a fixed value across renders. Without the pin both a real
    // date-boundary flake and a snapshot-style drift in the default
    // filter are possible.
    vi.spyOn(Date, 'now').mockReturnValue(NOW_MS);
    // Default: unauthenticated session — keeps the pre-existing suite on
    // the original hero copy and ensures auto-gen does not fire. P0-11
    // tests override this explicitly.
    mockUnauthenticated();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // 1. Loading state
  it('shows loading skeleton on initial load', () => {
    // fetch never resolves — stays in loading state
    mockFetch.mockImplementation(() => new Promise(() => {}));
    renderDigestPage();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  // 2. No digest (hero state) — now says "Change Reports"
  it('shows hero state when no digest exists', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/what changed in your knowledge base/),
    ).toBeInTheDocument();
  });

  // 3. Mode selector tabs — now labelled "Report mode"
  it('renders three mode tabs with correct aria attributes', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const tablist = screen.getByRole('tablist', { name: 'Report mode' });
    expect(tablist).toBeInTheDocument();

    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(3);

    // First tab (Period) should be selected by default
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  // 4. Preset mode: period select and generate button — now "Generate Report"
  it('shows generate button in preset mode', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Generate Report/i }),
    ).toBeInTheDocument();
  });

  // 5. Daily mode
  it('shows daily mode text when Daily tab is selected', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const dailyTab = screen.getByRole('tab', { name: /Daily/i });
    await user.click(dailyTab);

    expect(screen.getByText(/Summarise today/)).toBeInTheDocument();
  });

  // 6. Custom mode: shows filter panel — now "Custom Report Filters"
  it('shows custom filter panel when Custom tab is selected', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const customTab = screen.getByRole('tab', { name: /Custom/i });
    await user.click(customTab);

    expect(screen.getByText('Custom Report Filters')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByLabelText('Domain')).toBeInTheDocument();
    expect(screen.getByLabelText(/Keywords/)).toBeInTheDocument();
  });

  // 7. Custom filter badges
  it('shows active filter badges in custom mode and removes on click', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
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
    const removeButton = screen.getByRole('button', {
      name: 'Remove keyword filter: claude',
    });
    await user.click(removeButton);

    expect(screen.queryByText('claude')).not.toBeInTheDocument();
    expect(screen.getByText('ai agents')).toBeInTheDocument();
  });

  // 8. Generate preset digest
  it('calls fetch with correct body when generating preset digest', async () => {
    const user = userEvent.setup();
    const generatedDigest = makeDigest({ id: 'new-digest' });
    setupFetch({ latest: null, list: [], generateResult: generatedDigest });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
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

  // 9. Generate custom digest — button now says "Generate Custom Report"
  it('calls fetch with custom filters when generating custom digest', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [], generateResult: makeDigest() });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const customTab = screen.getByRole('tab', { name: /Custom/i });
    await user.click(customTab);

    const keywordsInput = screen.getByLabelText(/Keywords/);
    await user.clear(keywordsInput);
    await user.type(keywordsInput, 'ai agents');

    const generateButton = screen.getByRole('button', {
      name: /Generate Custom Report/i,
    });
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

    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
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
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Report generated successfully',
    );
  });

  // 12. Generation error
  it('shows toast error when generation fails', async () => {
    const user = userEvent.setup();
    setupFetch({
      latest: null,
      list: [],
      generateError: 'Insufficient content',
    });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledWith('Insufficient content');
    });
  });

  // 13. Digest view state renders controls and DigestView — "Generate New Report"
  it('renders bar controls and DigestView when digest exists', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    // Bar variant shows "Generate New Report"
    expect(
      screen.getByRole('button', { name: /Generate New Report/i }),
    ).toBeInTheDocument();
  });

  // 14. Mark all as read
  it('calls markBulkRead with item IDs when mark all as read is clicked', async () => {
    const user = userEvent.setup();
    const digest = makeDigest({ item_ids: ['item-1', 'item-2', 'item-3'] });
    setupFetch({ latest: digest, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    const markAllButton = screen.getByRole('button', {
      name: /Mark all as read/i,
    });
    await user.click(markAllButton);

    await waitFor(() => {
      expect(mockMarkBulkRead).toHaveBeenCalledWith(
        ['item-1', 'item-2', 'item-3'],
        'digest',
      );
    });
  });

  // 15. Past digests list — now "Previous Reports"
  it('renders previous reports excluding the current one', async () => {
    const digest = makeDigest({ id: 'current-digest' });
    const pastList = [
      { ...digest, id: 'current-digest' },
      makePastDigestEntry({ id: 'past-1' }),
      makePastDigestEntry({ id: 'past-2' }),
    ];
    setupFetch({ latest: digest, list: pastList });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.getByText('Previous Reports')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Previous reports' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  // 16. Load past digest
  it('loads a past digest when clicked', async () => {
    const user = userEvent.setup();
    const currentDigest = makeDigest({ id: 'current-digest' });
    const pastEntry = makePastDigestEntry({ id: 'past-1' });
    setupFetch({ latest: currentDigest, list: [currentDigest, pastEntry] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Previous Reports')).toBeInTheDocument();
    });

    // Click the past digest entry — this triggers loadDigest which calls fetch
    const list = screen.getByRole('list', { name: 'Previous reports' });
    const pastButton = within(list).getAllByRole('button')[0];
    await user.click(pastButton);

    // It should have called the detail endpoint directly, not the list endpoint
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContainEqual(
        expect.stringContaining('/api/digest/past-1'),
      );
    });
  });

  // 17. Empty past digests
  it('does not render previous reports section when none exist', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [digest] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.queryByText('Previous Reports')).not.toBeInTheDocument();
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

    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Generate Report/i }));

    await waitFor(() => {
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  // 19. Content section has correct aria-label — now "Change reports"
  it('wraps content in section with correct aria-label', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('region', { name: 'Change reports' }),
    ).toBeInTheDocument();
  });

  // 20. Mode switching works correctly
  it('switches between all three modes', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // Start in preset mode
    expect(screen.getByRole('tab', { name: /Period/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Switch to daily
    await user.click(screen.getByRole('tab', { name: /Daily/i }));
    expect(screen.getByRole('tab', { name: /Daily/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Period/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );

    // Switch to custom
    await user.click(screen.getByRole('tab', { name: /Custom/i }));
    expect(screen.getByRole('tab', { name: /Custom/i })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('tab', { name: /Daily/i })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  // 21. loadReadMarks is called on mount
  it('calls loadReadMarks on mount', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

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
    renderDigestPage();

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

    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: /Generating/i }),
      ).toBeDisabled();
    });
  });

  // 24. tabpanel has correct aria-labelledby
  it('renders tabpanel with correct aria-labelledby for active mode', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel).toHaveAttribute('aria-labelledby', 'tab-preset');
  });

  // 25. Mark all as read button is positioned after digest content, not in controls
  it('renders mark all as read button after digest content, not in controls bar', async () => {
    const digest = makeDigest();
    setupFetch({ latest: digest, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    const markAllButton = screen.getByRole('button', {
      name: /Mark all as read/i,
    });
    expect(markAllButton).toBeInTheDocument();

    // The button should be a sibling of the DigestView, not inside the controls
    // Verify by checking its parent structure — it should not be inside a tabpanel
    const tabpanel = screen.getByRole('tabpanel');
    expect(
      within(tabpanel).queryByRole('button', { name: /Mark all as read/i }),
    ).not.toBeInTheDocument();
  });

  // 26. Mark all as read button is not shown when no digest exists
  it('does not render mark all as read button in hero state', async () => {
    setupFetch({ latest: null, list: [] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: /Mark all as read/i }),
    ).not.toBeInTheDocument();
  });

  // ─── P0-11: /digest auto-gen guard on account age > 24h ───

  // 27. New account (< 24h): no auto-gen, new-account empty-state visible,
  //     manual Generate button still functional.
  it('new account (< 24h) does NOT auto-generate and renders new-account empty-state', async () => {
    mockNewAccount();
    const generated = makeDigest({ id: 'new-account-manual' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    renderDigestPage();

    // New-account copy should appear.
    await waitFor(() => {
      expect(
        screen.getByText(/No activity yet — check back/i),
      ).toBeInTheDocument();
    });

    // The default hero copy ("See what changed in your knowledge base,
    // grouped by domain with cross-cutting themes identified.") must NOT
    // render in this branch. Match on the distinctive "grouped by domain"
    // fragment rather than the less specific "what changed" phrase, which
    // also appears in the new-account copy.
    expect(
      screen.queryByText(/grouped by domain with cross-cutting themes/i),
    ).not.toBeInTheDocument();

    // Confirm no auto-gen call fired. Wait long enough for any stray effect
    // to land — a short delay is fine; we assert the absence of the POST.
    await new Promise((r) => setTimeout(r, 25));

    const generateCalls = mockFetch.mock.calls.filter(
      (call: [string, ...unknown[]]) => {
        const url = String(call[0]);
        return url.includes('/api/digest/generate');
      },
    );
    expect(generateCalls).toHaveLength(0);

    // Manual Generate button is still functional — the user can override
    // the guard if they really want to.
    const user = userEvent.setup();
    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    expect(generateButton).toBeEnabled();
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/digest/generate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // 28. Established account (> 24h): auto-gen fires exactly once with the
  //     weekly defaults.
  it('established account (> 24h) auto-generates weekly report on first visit', async () => {
    mockOldAccount();
    const generated = makeDigest({ id: 'auto-generated' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    renderDigestPage();

    // The auto-gen effect fires after the initial queries settle.
    await waitFor(() => {
      const generateCalls = mockFetch.mock.calls.filter(
        (call: [string, ...unknown[]]) => {
          const url = String(call[0]);
          return url.includes('/api/digest/generate');
        },
      );
      expect(generateCalls).toHaveLength(1);
    });

    // Verify the auto-gen payload matches the weekly default.
    const generateCall = mockFetch.mock.calls.find(
      (call: [string, ...unknown[]]) => {
        const url = String(call[0]);
        return url.includes('/api/digest/generate');
      },
    );
    expect(generateCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"period_days":7'),
      }),
    );
    expect(String(generateCall?.[1]?.body)).toContain('"digest_type":"weekly"');

    // On success the page transitions to the digest view.
    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });
  });

  // 29. Auto-gen does NOT fire when a digest already exists — even for
  //     established accounts. Prevents burning an AI call on a page refresh.
  it('does not auto-generate when a digest is already cached', async () => {
    mockOldAccount();
    const existing = makeDigest({ id: 'existing' });
    setupFetch({ latest: existing, list: [existing] });
    renderDigestPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    // Give any stray effect time to run.
    await new Promise((r) => setTimeout(r, 25));

    const generateCalls = mockFetch.mock.calls.filter(
      (call: [string, ...unknown[]]) => {
        const url = String(call[0]);
        return url.includes('/api/digest/generate');
      },
    );
    expect(generateCalls).toHaveLength(0);
  });
});
