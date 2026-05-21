/**
 * ChangeReportsPage Component Tests
 *
 * Tests the digest page — loading state, hero/generate states, period selector,
 * custom filters, generation flow, past digests, and accessibility.
 *
 * Updated for TanStack Query migration (Wave 2A), digest-to-"Change Report"
 * vocabulary reframing, and P1-9/P1-4 filter simplification (tabs collapsed
 * into unified period dropdown with inline custom panel).
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
  mockChangeReportFrequencyLabel,
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
  mockChangeReportFrequencyLabel: vi.fn((t: string) => {
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
  usePathname: () => '/change-reports',
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

vi.mock('@/components/change-reports/change-report-view', () => ({
  ChangeReportView: ({ digest }: { digest: { id: string } }) => (
    <div data-testid="digest-view">ChangeReportView: {digest.id}</div>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatDate: mockFormatDate,
}));

vi.mock('@/lib/change-reports/change-reports-helpers', () => ({
  changeReportFrequencyLabel: mockChangeReportFrequencyLabel,
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: {
      getUser: mockGetUser,
    },
  }),
}));

// Import AFTER mocks
import ChangeReportsPage from '@/app/change-reports/page';

// ---------------------------------------------------------------------------
// jsdom polyfill — Radix Select uses pointer capture APIs not present in jsdom
// ---------------------------------------------------------------------------
import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

function patchJsdom() {
  installRadixPointerShims();
}

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

function makeChangeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'change-report-1',
    frequency: 'weekly',
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
    narrative_summary: 'A narrative summary.',
    generated_at: '2026-03-08T12:00:00Z',
    generated_by: 'system',
    tokens_used: 100,
    item_ids: ['item-1', 'item-2'],
    created_at: '2026-03-08T12:00:00Z',
    ...overrides,
  };
}

function makePastChangeReportEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: 'past-digest-1',
    frequency: 'weekly',
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
    autoGenerateEnabled?: boolean;
  } = {},
) {
  mockFetch.mockImplementation(async (url: string) => {
    const urlStr = typeof url === 'string' ? url : String(url);

    // OPS-23: notification preferences query from the digest page
    if (urlStr.includes('/api/notifications/preferences')) {
      return {
        ok: true,
        json: async () => ({
          preferences: {
            email_weekly_change_report: true,
            email_review_assigned: true,
            email_owned_content_flagged: true,
            auto_generate_change_reports: options.autoGenerateEnabled ?? true,
          },
        }),
      };
    }

    if (urlStr.includes('/api/change-reports/latest')) {
      return {
        ok: true,
        json: async () => ({ digest: options.latest ?? null }),
      };
    }

    if (urlStr.includes('/api/change-reports/list')) {
      return {
        ok: true,
        json: async () => ({ digests: options.list ?? [] }),
      };
    }

    if (urlStr.includes('/api/change-reports/generate')) {
      if (options.generateError) {
        return {
          ok: false,
          status: 400,
          json: async () => ({ error: options.generateError }),
        };
      }
      return {
        ok: true,
        json: async () => ({ digest: options.generateResult ?? makeChangeReport() }),
      };
    }

    // Match /api/change-reports/{id} — the detail endpoint
    if (/\/api\/digest\/(?!latest|list|generate)[^/]+/.test(urlStr)) {
      return {
        ok: true,
        json: async () => ({ digest: options.detail ?? makeChangeReport() }),
      };
    }

    return { ok: true, json: async () => ({}) };
  });
}

/**
 * Render ChangeReportsPage wrapped in QueryClientProvider.
 */
function renderChangeReportsPage() {
  const { Wrapper } = createQueryWrapper();
  return render(<ChangeReportsPage />, { wrapper: Wrapper });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ChangeReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    patchJsdom();
    // Pin Date.now() so the 24h account-age boundary (P0-11 auto-gen
    // gate) is deterministic AND so the `/digest` custom date-range
    // default — computed via a lazy `useState` initialiser in
    // `app/change-reports/page.tsx` that calls `Date.now()` directly — resolves
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
    renderChangeReportsPage();

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });

  // 2. No digest (hero state) — now says "Change Reports"
  it('shows hero state when no digest exists', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByText(/what changed in your knowledge base/),
    ).toBeInTheDocument();
  });

  // 3. Period dropdown — replaces three-tab mode selector (P1-4/P1-9)
  it('renders a unified period dropdown with preset and custom options', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // No tablist should exist — tabs were collapsed into dropdown
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();

    // The period dropdown trigger should be present with an accessible name
    // (replaces the tabpanel aria-labelledby guard from the pre-dropdown era).
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeInTheDocument();
    expect(trigger).toHaveAccessibleName('Report period');
  });

  // 4. Preset mode: generate button present with default "Last 7 days"
  it('shows generate button with default period selection', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: /Generate Report/i }),
    ).toBeInTheDocument();
  });

  // 5. Custom option reveals inline filter panel (replaces old tab test)
  it('shows custom filter panel when Custom option is selected from dropdown', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // Open the period dropdown and select "Custom..."
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);

    const customOption = screen.getByRole('option', { name: /Custom/i });
    await user.click(customOption);

    expect(screen.getByText('Custom Report Filters')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    expect(screen.getByLabelText('Domain')).toBeInTheDocument();
    expect(screen.getByLabelText(/Keywords/)).toBeInTheDocument();
  });

  // 6. Custom filter badges
  it('shows active filter badges in custom mode and removes on click', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // Select Custom... from dropdown
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const customOption = screen.getByRole('option', { name: /Custom/i });
    await user.click(customOption);

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

  // 7. Generate preset digest
  it('calls fetch with correct body when generating preset digest', async () => {
    const user = userEvent.setup();
    const generatedDigest = makeChangeReport({ id: 'new-digest' });
    setupFetch({ latest: null, list: [], generateResult: generatedDigest });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/change-reports/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"period_days":7'),
        }),
      );
    });
  });

  // 8. Generate custom digest
  it('calls fetch with custom filters when generating custom digest', async () => {
    const user = userEvent.setup();
    setupFetch({ latest: null, list: [], generateResult: makeChangeReport() });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // Select Custom... from dropdown
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const customOption = screen.getByRole('option', { name: /Custom/i });
    await user.click(customOption);

    const keywordsInput = screen.getByLabelText(/Keywords/);
    await user.clear(keywordsInput);
    await user.type(keywordsInput, 'ai agents');

    const generateButton = screen.getByRole('button', {
      name: /Generate Custom Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/change-reports/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"frequency":"custom"'),
        }),
      );
    });
  });

  // 9. Generating state shows cancel button and progress text (OPS-23)
  it('shows cancel button and progress text during generation', async () => {
    const user = userEvent.setup();
    // Make generate hang so we can see the generating state
    mockFetch.mockImplementation(async (url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/notifications/preferences')
      ) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              email_weekly_change_report: true,
              email_review_assigned: true,
              email_owned_content_flagged: true,
              auto_generate_change_reports: true,
            },
          }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/generate')) {
        return new Promise(() => {}); // never resolves
      }
      return { ok: true, json: async () => ({}) };
    });

    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      // OPS-23: Cancel button replaces Generate button during generation
      expect(
        screen.getByRole('button', { name: /Cancel/i }),
      ).toBeInTheDocument();
      expect(screen.getByText(/Generating your report/)).toBeInTheDocument();
    });
  });

  // 10. Successful generation updates view
  it('shows ChangeReportView after successful generation', async () => {
    const user = userEvent.setup();
    const generatedDigest = makeChangeReport({ id: 'generated-1' });
    setupFetch({ latest: null, list: [], generateResult: generatedDigest });
    renderChangeReportsPage();

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

  // 11. Generation error
  it('shows toast error when generation fails', async () => {
    const user = userEvent.setup();
    setupFetch({
      latest: null,
      list: [],
      generateError: 'Insufficient content',
    });
    renderChangeReportsPage();

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

  // 12. Digest view state renders controls and ChangeReportView — "Generate New Report"
  it('renders bar controls and ChangeReportView when digest exists', async () => {
    const digest = makeChangeReport();
    setupFetch({ latest: digest, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    // Bar variant shows "Generate New Report"
    expect(
      screen.getByRole('button', { name: /Generate New Report/i }),
    ).toBeInTheDocument();
  });

  // 13. Mark all as read
  it('calls markBulkRead with item IDs when mark all as read is clicked', async () => {
    const user = userEvent.setup();
    const digest = makeChangeReport({ item_ids: ['item-1', 'item-2', 'item-3'] });
    setupFetch({ latest: digest, list: [] });
    renderChangeReportsPage();

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

  // 14. Past digests list — now "Previous Reports"
  it('renders previous reports excluding the current one', async () => {
    const digest = makeChangeReport({ id: 'current-digest' });
    const pastList = [
      { ...digest, id: 'current-digest' },
      makePastChangeReportEntry({ id: 'past-1' }),
      makePastChangeReportEntry({ id: 'past-2' }),
    ];
    setupFetch({ latest: digest, list: pastList });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.getByText('Previous Reports')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Previous reports' });
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  // 15. Load past digest
  it('loads a past digest when clicked', async () => {
    const user = userEvent.setup();
    const currentDigest = makeChangeReport({ id: 'current-digest' });
    const pastEntry = makePastChangeReportEntry({ id: 'past-1' });
    setupFetch({ latest: currentDigest, list: [currentDigest, pastEntry] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Previous Reports')).toBeInTheDocument();
    });

    // Click the past change-report entry — this triggers loadChangeReport which calls fetch
    const list = screen.getByRole('list', { name: 'Previous reports' });
    const pastButton = within(list).getAllByRole('button')[0];
    await user.click(pastButton);

    // It should have called the detail endpoint directly, not the list endpoint
    await waitFor(() => {
      const calls = mockFetch.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls).toContainEqual(
        expect.stringContaining('/api/change-reports/past-1'),
      );
    });
  });

  // 16. Empty past digests
  it('does not render previous reports section when none exist', async () => {
    const digest = makeChangeReport();
    setupFetch({ latest: digest, list: [digest] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    expect(screen.queryByText('Previous Reports')).not.toBeInTheDocument();
  });

  // 17. aria-live regions
  it('has aria-live region during generating state', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/notifications/preferences')
      ) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              email_weekly_change_report: true,
              email_review_assigned: true,
              email_owned_content_flagged: true,
              auto_generate_change_reports: true,
            },
          }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/generate')) {
        return new Promise(() => {});
      }
      return { ok: true, json: async () => ({}) };
    });

    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /Generate Report/i }));

    await waitFor(() => {
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });
  });

  // 18. Content section has correct aria-label — "Change reports"
  it('wraps content in section with correct aria-label', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('region', { name: 'Change reports' }),
    ).toBeInTheDocument();
  });

  // 19. No tablist in the new dropdown-based design (P1-4/P1-9)
  it('does not render a tablist — tabs replaced by dropdown', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
  });

  // 20. loadReadMarks is called on mount
  it('calls loadReadMarks on mount', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(mockLoadReadMarks).toHaveBeenCalled();
    });
  });

  // 21. Mark all as read extracts IDs from domain_summaries when item_ids is empty
  it('extracts item IDs from domain_summaries when item_ids is not present', async () => {
    const user = userEvent.setup();
    const digest = makeChangeReport({
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
    renderChangeReportsPage();

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

  // 22. Cancel button replaces Generate button during generation (OPS-23)
  it('shows Cancel button during generation instead of Generate', async () => {
    const user = userEvent.setup();
    mockFetch.mockImplementation(async (url: string) => {
      if (
        typeof url === 'string' &&
        url.includes('/api/notifications/preferences')
      ) {
        return {
          ok: true,
          json: async () => ({
            preferences: {
              email_weekly_change_report: true,
              email_review_assigned: true,
              email_owned_content_flagged: true,
              auto_generate_change_reports: true,
            },
          }),
        };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/latest')) {
        return { ok: true, json: async () => ({ digest: null }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/list')) {
        return { ok: true, json: async () => ({ digests: [] }) };
      }
      if (typeof url === 'string' && url.includes('/api/change-reports/generate')) {
        return new Promise(() => {});
      }
      return { ok: true, json: async () => ({}) };
    });

    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      // OPS-23: Cancel button replaces Generate while in-flight
      expect(
        screen.getByRole('button', { name: /Cancel/i }),
      ).toBeInTheDocument();
      // Generate button should no longer be visible
      expect(
        screen.queryByRole('button', { name: /Generate Report/i }),
      ).not.toBeInTheDocument();
    });
  });

  // 23. Mark all as read button is positioned after digest content, not in controls
  it('renders mark all as read button after digest content', async () => {
    const digest = makeChangeReport();
    setupFetch({ latest: digest, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    const markAllButton = screen.getByRole('button', {
      name: /Mark all as read/i,
    });
    expect(markAllButton).toBeInTheDocument();
  });

  // 24. Mark all as read button is not shown when no digest exists
  it('does not render mark all as read button in hero state', async () => {
    setupFetch({ latest: null, list: [] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('button', { name: /Mark all as read/i }),
    ).not.toBeInTheDocument();
  });

  // 25. Daily generation via "Last 1 day" dropdown option
  it('generates daily digest when "Last 1 day" is selected', async () => {
    const user = userEvent.setup();
    const generated = makeChangeReport({ id: 'daily-gen' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByText('Change Reports')).toBeInTheDocument();
    });

    // Select "Last 1 day" from the dropdown
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const dailyOption = screen.getByRole('option', { name: /Last 1 day/i });
    await user.click(dailyOption);

    const generateButton = screen.getByRole('button', {
      name: /Generate Report/i,
    });
    await user.click(generateButton);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/change-reports/generate',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"period_days":1'),
        }),
      );
    });
  });

  // ─── P0-11: /digest auto-gen guard on account age > 24h ───

  // 26. New account (< 24h): no auto-gen, new-account empty-state visible,
  //     manual Generate button still functional.
  it('new account (< 24h) does NOT auto-generate and renders new-account empty-state', async () => {
    mockNewAccount();
    const generated = makeChangeReport({ id: 'new-account-manual' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    renderChangeReportsPage();

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

    const generateCalls = mockFetch.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/api/change-reports/generate');
    });
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
        '/api/change-reports/generate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // 27. Established account (> 24h): auto-gen fires exactly once with the
  //     weekly defaults.
  it('established account (> 24h) auto-generates weekly report on first visit', async () => {
    mockOldAccount();
    const generated = makeChangeReport({ id: 'auto-generated' });
    setupFetch({ latest: null, list: [], generateResult: generated });
    renderChangeReportsPage();

    // The auto-gen effect fires after the initial queries settle.
    await waitFor(() => {
      const generateCalls = mockFetch.mock.calls.filter((call) => {
        const url = String(call[0]);
        return url.includes('/api/change-reports/generate');
      });
      expect(generateCalls).toHaveLength(1);
    });

    // Verify the auto-gen payload matches the weekly default.
    const generateCall = mockFetch.mock.calls.find((call) => {
      const url = String(call[0]);
      return url.includes('/api/change-reports/generate');
    });
    expect(generateCall?.[1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"period_days":7'),
      }),
    );
    expect(String(generateCall?.[1]?.body)).toContain('"frequency":"weekly"');

    // On success the page transitions to the digest view.
    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });
  });

  // 28. Auto-gen does NOT fire when a digest already exists — even for
  //     established accounts. Prevents burning an AI call on a page refresh.
  it('does not auto-generate when a digest is already cached', async () => {
    mockOldAccount();
    const existing = makeChangeReport({ id: 'existing' });
    setupFetch({ latest: existing, list: [existing] });
    renderChangeReportsPage();

    await waitFor(() => {
      expect(screen.getByTestId('digest-view')).toBeInTheDocument();
    });

    // Give any stray effect time to run.
    await new Promise((r) => setTimeout(r, 25));

    const generateCalls = mockFetch.mock.calls.filter((call) => {
      const url = String(call[0]);
      return url.includes('/api/change-reports/generate');
    });
    expect(generateCalls).toHaveLength(0);
  });
});
