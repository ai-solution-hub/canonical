/**
 * GovernanceSection Component Tests
 *
 * Tests the governance settings section — loading state, empty state,
 * config list rendering with preset badges, add/edit dialog with
 * domain dropdown + preset picker, and freshness recalculation.
 *
 * Note: Radix Select and RadioGroup interactions are unreliable in jsdom.
 * We test dialog structure and config list rendering here; full form
 * submission is covered by the API route tests and E2E tests.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast, mockSupabaseFrom, mockUseTaxonomy } = vi.hoisted(
  () => ({
    mockFetch: vi.fn(),
    mockToast: {
      success: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warning: vi.fn(),
    },
    mockSupabaseFrom: vi.fn(),
    mockUseTaxonomy: vi.fn(),
  }),
);

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: mockSupabaseFrom,
  }),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockUseTaxonomy(),
}));

// ConceptHelp renders a Radix Tooltip which needs a TooltipProvider.
// Stub it to avoid wiring one up across every render call.
vi.mock('@/components/ui/concept-help', () => ({
  ConceptHelp: ({ concept }: { concept: string }) => (
    <span data-testid={`concept-help-${concept}`} />
  ),
}));

import { GovernanceSection } from '@/components/settings/governance-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_TAXONOMY_DOMAINS = [
  {
    id: 'dom-1',
    name: 'Technology & Systems',
    display_name: 'Technology & Systems',
    display_order: 1,
    colour: 'tech',
    is_active: true,
    provenance: 'seed',
  },
  {
    id: 'dom-2',
    name: 'Corporate',
    display_name: 'Corporate',
    display_order: 2,
    colour: 'corporate',
    is_active: true,
    provenance: 'seed',
  },
  {
    id: 'dom-3',
    name: 'Operations',
    display_name: 'Operations',
    display_order: 3,
    colour: 'operations',
    is_active: true,
    provenance: 'seed',
  },
];

function createGovernanceConfig(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gov-1',
    domain: 'Technology & Systems',
    posture: 'open',
    preset: 'light_touch',
    reviewer_id: null,
    timeout_days: null,
    quality_score_threshold: 40,
    auto_flag_on_quality_drop: false,
    auto_flag_on_freshness_transition: false,
    auto_flag_cooldown_days: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: null,
    ...overrides,
  };
}

function setupSupabaseMock() {
  const mockSingle = vi.fn().mockResolvedValue({ data: null, error: null });
  const mockLimit = vi.fn().mockReturnValue({ single: mockSingle });
  const mockOrder = vi.fn().mockReturnValue({ limit: mockLimit });
  const mockNot = vi.fn().mockReturnValue({ order: mockOrder });
  const mockSelect = vi.fn().mockReturnValue({ not: mockNot });
  mockSupabaseFrom.mockReturnValue({ select: mockSelect });
}

function setupDefaultTaxonomy() {
  mockUseTaxonomy.mockReturnValue({
    domains: DEFAULT_TAXONOMY_DOMAINS,
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => DEFAULT_TAXONOMY_DOMAINS.map((d) => d.name),
    getSubtopics: () => [],
    getDomainColourKey: () => 'corporate',
    formatSubtopic: (s: string) => s,
    formatDomainName: (d: string) => d,
    refresh: vi.fn(),
  });
}

function setupEmptyTaxonomy() {
  mockUseTaxonomy.mockReturnValue({
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getDomainNames: () => [],
    getSubtopics: () => [],
    getDomainColourKey: () => 'corporate',
    formatSubtopic: (s: string) => s,
    formatDomainName: (d: string) => d,
    refresh: vi.fn(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GovernanceSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', mockFetch);
    setupSupabaseMock();
    setupDefaultTaxonomy();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows a loading spinner while fetching governance config', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<GovernanceSection />);

    const spinner = document.querySelector('.animate-spin');
    expect(spinner).toBeInTheDocument();
  });

  it('shows empty state when no governance rules are configured', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('No governance rules configured'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Add a domain and choose a preset to get started.'),
    ).toBeInTheDocument();
  });

  it('renders config list with domain and preset badge', async () => {
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Technology & Systems',
        preset: 'strict',
        posture: 'review_on_change',
      }),
      createGovernanceConfig({
        id: 'gov-2',
        domain: 'Corporate',
        preset: 'light_touch',
        posture: 'open',
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Technology & Systems')).toBeInTheDocument();
    });

    expect(screen.getByText('Corporate')).toBeInTheDocument();

    // Should show preset badges
    expect(screen.getByText('Strict')).toBeInTheDocument();
    expect(screen.getByText('Light-touch')).toBeInTheDocument();
  });

  it('infers preset from posture when preset column is null', async () => {
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Technology & Systems',
        preset: null,
        posture: 'review_on_change',
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Technology & Systems')).toBeInTheDocument();
    });

    // Should infer strict from review_on_change posture
    expect(screen.getByText('Strict')).toBeInTheDocument();
  });

  it('opens add dialog with preset picker when Add Domain is clicked', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('No governance rules configured'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Add Domain' }));

    await waitFor(() => {
      expect(screen.getByText('Add Governance Config')).toBeInTheDocument();
    });

    // Should show preset radio options
    expect(screen.getByText('Light-touch')).toBeInTheDocument();
    expect(screen.getByText('Strict')).toBeInTheDocument();

    // Should show preset descriptions
    expect(
      screen.getByText(
        'All edits land immediately. Low-scoring items surface to your attention, but nothing is blocked.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Edits to this domain are held for review. Stale or low-quality items are automatically flagged.',
      ),
    ).toBeInTheDocument();

    // Should have domain selector
    expect(screen.getByText('Select a domain')).toBeInTheDocument();

    // Should have Save button
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    // Should have Cancel button
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('shows empty taxonomy message in add dialog when no domains exist', async () => {
    setupEmptyTaxonomy();

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByText('No governance rules configured'),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Add Domain' }));

    await waitFor(() => {
      expect(screen.getByText('Add Governance Config')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'No taxonomy domains configured. Add domains in the taxonomy settings first.',
      ),
    ).toBeInTheDocument();
  });

  it('shows all-configured message when all domains have rules', async () => {
    // All 3 taxonomy domains already have governance config
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Technology & Systems',
        preset: 'light_touch',
      }),
      createGovernanceConfig({
        id: 'gov-2',
        domain: 'Corporate',
        preset: 'strict',
      }),
      createGovernanceConfig({
        id: 'gov-3',
        domain: 'Operations',
        preset: 'light_touch',
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Technology & Systems')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Add Domain' }));

    await waitFor(() => {
      expect(screen.getByText('Add Governance Config')).toBeInTheDocument();
    });

    expect(
      screen.getByText(
        'All taxonomy domains already have governance rules configured.',
      ),
    ).toBeInTheDocument();
  });

  it('shows edit dialog title when editing existing config', async () => {
    const configs = [
      createGovernanceConfig({
        id: 'gov-1',
        domain: 'Technology & Systems',
        preset: 'light_touch',
      }),
    ];
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(configs),
    });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Technology & Systems')).toBeInTheDocument();
    });

    // Click the Edit button on the existing config
    const listItem = screen.getByRole('listitem');
    const editButton = within(listItem).getByRole('button', { name: 'Edit' });
    await user.click(editButton);

    await waitFor(() => {
      expect(screen.getByText('Edit Governance Config')).toBeInTheDocument();
    });

    // Domain should be shown as read-only text, not a dropdown
    // The domain name appears in the dialog as plain text
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText('Technology & Systems'),
    ).toBeInTheDocument();
  });

  it('preserves Content Freshness section', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    });
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(screen.getByText('Content Freshness')).toBeInTheDocument();
    });

    expect(
      screen.getByRole('button', { name: 'Recalculate Now' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('concept-help-freshness')).toBeInTheDocument();
  });

  it('calls freshness recalculate API and shows success toast', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([]) })
      .mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            updated: 42,
            recalculated_at: '2025-03-15T12:00:00Z',
          }),
      });

    const user = userEvent.setup();
    render(<GovernanceSection />);

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Recalculate Now' }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Recalculate Now' }));

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/freshness/recalculate-all',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    expect(mockToast.success).toHaveBeenCalledWith(
      'Freshness recalculated: 42 items updated',
    );
  });
});
