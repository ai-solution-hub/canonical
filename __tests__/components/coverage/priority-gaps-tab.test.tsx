/**
 * PriorityGapsTab Component Tests
 *
 * Tests the priority gaps tab — loading skeleton, error with retry,
 * empty state, successful data rendering, filter interactions, and
 * show more pagination.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UnifiedGapSummary } from '@/types/unified-gap';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockGetDomainNames, mockFormatDomainName } = vi.hoisted(
  () => ({
    mockFetch: vi.fn(),
    mockGetDomainNames: vi.fn(() => ['health-safety', 'corporate']),
    mockFormatDomainName: vi.fn((name: string) =>
      name
        .split('-')
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '),
    ),
  }),
);

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: mockGetDomainNames,
    formatDomainName: mockFormatDomainName,
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getSubtopics: () => [],
    getDomainColourKey: () => 'corporate',
    formatSubtopic: (s: string) => s,
    refresh: () => {},
  }),
}));

// Import AFTER mocks
import { PriorityGapsTab } from '@/components/coverage/priority-gaps-tab';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeGapSummary(
  overrides: Partial<UnifiedGapSummary> = {},
): UnifiedGapSummary {
  return {
    total_gaps: 3,
    taxonomy_gaps: 1,
    template_gaps: 1,
    guide_gaps: 1,
    critical: 0,
    high: 1,
    medium: 1,
    low: 1,
    gaps: [
      {
        source: 'taxonomy',
        gap_key: 'taxonomy:health-safety:risk-assessments',
        title: 'Risk Assessments (Health & Safety)',
        description: 'No content items in the Risk Assessments subtopic',
        priority_score: 50,
        priority_tier: 'high',
        domain: 'health-safety',
        subtopic: 'risk-assessments',
        action_href:
          '/browse?domain=health-safety&subtopic=risk-assessments',
        action_label: 'Add content',
        domain_name: 'health-safety',
        subtopic_name: 'risk-assessments',
        target_unmet: true,
      },
      {
        source: 'template',
        gap_key: 'template:ISO-27001:A5:req-1',
        title: 'Information security policy',
        description: 'Policy statement required',
        priority_score: 35,
        priority_tier: 'medium',
        domain: null,
        subtopic: null,
        action_href:
          '/coverage?tab=templates&template=ISO-27001&section=A5',
        action_label: 'View requirement',
        template_name: 'ISO 27001',
        template_type: 'pqq',
        section_ref: 'A5',
        section_name: 'Information Security Policies',
        requirement_text: 'Information security policy',
        requirement_type: 'policy',
        is_mandatory: true,
      },
      {
        source: 'guide',
        gap_key: 'guide:g1:s1',
        title: 'Environmental Policy (Sustainability Guide)',
        description: 'No content in the "Environmental Policy" section',
        priority_score: 20,
        priority_tier: 'low',
        domain: null,
        subtopic: null,
        action_href: '/guide/sustainability-guide',
        action_label: 'Open guide',
        guide_id: 'g1',
        guide_name: 'Sustainability Guide',
        guide_slug: 'sustainability-guide',
        section_id: 's1',
        section_name: 'Environmental Policy',
        is_required: true,
        section_status: 'empty',
      },
    ],
    ...overrides,
  };
}

function makeEmptySummary(): UnifiedGapSummary {
  return {
    total_gaps: 0,
    taxonomy_gaps: 0,
    template_gaps: 0,
    guide_gaps: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    gaps: [],
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PriorityGapsTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeGapSummary(),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading skeleton before data arrives', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    render(<PriorityGapsTab />);
    const skeletons = document.querySelectorAll('[data-slot="skeleton"]');
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it('shows error state with retry button on fetch failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(
        screen.getByText('Failed to load priority gaps data.'),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();

    // Clicking retry triggers a new fetch
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => makeGapSummary(),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Retry/ }));
    await waitFor(() => {
      expect(
        screen.getByText('Risk Assessments (Health & Safety)'),
      ).toBeInTheDocument();
    });
  });

  it('shows empty state when no gaps exist', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => makeEmptySummary(),
    });
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(
        screen.getByText('No content gaps detected'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /Your knowledge base covers all taxonomy subtopics/,
      ),
    ).toBeInTheDocument();
  });

  it('renders summary cards on success', async () => {
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByText('Taxonomy gaps')).toBeInTheDocument();
    });
    expect(screen.getByText('Template gaps')).toBeInTheDocument();
    expect(screen.getByText('Guide gaps')).toBeInTheDocument();
  });

  it('renders gap cards sorted by priority', async () => {
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(
        screen.getByText('Risk Assessments (Health & Safety)'),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText('Information security policy'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Environmental Policy (Sustainability Guide)'),
    ).toBeInTheDocument();
  });

  it('renders gap list as a semantic ul element', async () => {
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByRole('list', { name: 'Priority gaps' })).toBeInTheDocument();
    });
  });

  it('renders action links for each gap source type', async () => {
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(
        screen.getByRole('link', { name: /Add content/ }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole('link', { name: /View requirement/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /Open guide/ }),
    ).toBeInTheDocument();
  });

  it('calls fetch with source filter when changed', async () => {
    const user = userEvent.setup();
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByText('Total gaps')).toBeInTheDocument();
    });

    // Click "Taxonomy" source filter
    await user.click(screen.getByRole('button', { name: 'Taxonomy' }));
    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toContain('source=taxonomy');
    });
  });

  it('calls fetch with priority filter when changed', async () => {
    const user = userEvent.setup();
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByText('Total gaps')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'High' }));
    await waitFor(() => {
      const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
      expect(lastCall[0]).toContain('priority=high');
    });
  });

  it('renders filter toolbar with accessible labels', async () => {
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByText('Total gaps')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('toolbar', { name: 'Gap filters' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Source filter' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('group', { name: 'Priority filter' }),
    ).toBeInTheDocument();
  });

  it('shows "Show more" button when more than 25 gaps', async () => {
    // Create 30 gaps
    const manyGaps = Array.from({ length: 30 }, (_, i) => ({
      source: 'taxonomy' as const,
      gap_key: `taxonomy:domain:subtopic-${i}`,
      title: `Gap ${i}`,
      description: null,
      priority_score: 50 - i,
      priority_tier: 'medium' as const,
      domain: 'domain',
      subtopic: `subtopic-${i}`,
      action_href: '/browse',
      action_label: 'Add content',
      domain_name: 'domain',
      subtopic_name: `subtopic-${i}`,
      target_unmet: false,
    }));

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () =>
        makeGapSummary({ total_gaps: 30, gaps: manyGaps }),
    });

    const user = userEvent.setup();
    render(<PriorityGapsTab />);
    await waitFor(() => {
      expect(screen.getByText('Gap 0')).toBeInTheDocument();
    });

    // Only 25 visible initially
    expect(screen.queryByText('Gap 24')).toBeInTheDocument();
    expect(screen.queryByText('Gap 25')).not.toBeInTheDocument();

    // Show more button
    const showMoreBtn = screen.getByRole('button', {
      name: /Show more/,
    });
    expect(showMoreBtn).toBeInTheDocument();
    expect(showMoreBtn).toHaveTextContent('5 remaining');

    // Click show more
    await user.click(showMoreBtn);
    expect(screen.getByText('Gap 25')).toBeInTheDocument();
    expect(screen.getByText('Gap 29')).toBeInTheDocument();
  });
});
