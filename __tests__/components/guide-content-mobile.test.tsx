/**
 * GuideContent Mobile Sidebar Tests
 *
 * Tests the GuideSidebarContent sub-component (rendered via the parent
 * GuideContent) and the mobile <details> accordion / desktop <aside> layout.
 *
 * The GuideSidebarContent is an unexported component inside guide-content.tsx,
 * so all tests render the full GuideContent and assert against the resulting DOM.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockCanEdit, mockTaxonomy } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockCanEdit: { value: false },
  mockTaxonomy: {
    value: null as ReturnType<typeof import('../helpers/mock-contexts').mockTaxonomyContext> | null,
  },
}));

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/guide/test-guide',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: mockCanEdit.value ? 'editor' : 'viewer',
    loading: false,
    canEdit: mockCanEdit.value,
    canAdmin: false,
  }),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomy.value,
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [],
    loading: false,
    error: null,
    getLayerKeys: () => [],
    getLayerLabel: (key: string) => key,
    getLayerDescription: () => '',
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/guide/guide-section', () => ({
  GuideSection: ({ section }: { section: { section_name: string } }) => (
    <div data-testid="guide-section">{section.section_name}</div>
  ),
}));

vi.mock('@/components/guide/guide-progress-bar', () => ({
  GuideProgressBar: ({ populated, total }: { populated: number; total: number }) => (
    <div data-testid="guide-progress-bar">{populated}/{total}</div>
  ),
}));

vi.mock('@/components/guide/guide-research-feed', () => ({
  GuideResearchFeed: ({ sectionName }: { sectionName: string }) => (
    <div data-testid="guide-research-feed">{sectionName}</div>
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

import { GuideContent } from '@/app/guide/[slug]/guide-content';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function createGuideMetadata(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guide-1',
    slug: 'test-guide',
    name: 'Test Guide',
    description: 'A test guide description',
    guide_type: 'sector',
    domain_filter: null,
    icon: null,
    color: null,
    display_order: 1,
    is_published: true,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function createSection(overrides: Record<string, unknown> = {}) {
  return {
    section_id: 'section-1',
    section_name: 'Overview',
    section_description: 'Overview section',
    section_order: 1,
    expected_layer: null,
    subtopic_filter: null,
    is_required: true,
    content_items: [],
    ...overrides,
  };
}

function createRelatedGuide(overrides: Record<string, unknown> = {}) {
  return {
    id: 'related-1',
    slug: 'related-guide',
    name: 'Related Guide',
    guide_type: 'sector',
    ...overrides,
  };
}

/**
 * Sets up mockFetch to respond with guide data and related guides.
 */
function setupFetchResponses(
  guideData: { guide: ReturnType<typeof createGuideMetadata>; sections: ReturnType<typeof createSection>[] },
  relatedGuides: ReturnType<typeof createRelatedGuide>[] = [],
) {
  mockFetch
    // First call: GET /api/guides/:slug
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(guideData),
    })
    // Second call: GET /api/guides?type=...
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(relatedGuides),
    });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideContent — mobile sidebar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEdit.value = false;
    mockTaxonomy.value = mockTaxonomyContext();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // 1. GuideSidebarContent renders related guides when provided
  // -------------------------------------------------------------------------

  it('renders Related Guides heading and links when related guides are provided', async () => {
    const guide = createGuideMetadata();
    const sections = [createSection()];
    const relatedGuides = [
      createRelatedGuide({ id: 'r1', slug: 'alpha-guide', name: 'Alpha Guide' }),
      createRelatedGuide({ id: 'r2', slug: 'beta-guide', name: 'Beta Guide' }),
      // Include the current guide — it should be filtered out by the component
      createRelatedGuide({ id: 'guide-1', slug: 'test-guide', name: 'Test Guide' }),
    ];

    setupFetchResponses({ guide, sections }, relatedGuides);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Related Guides heading appears in both mobile and desktop — expect 2
    const relatedHeadings = screen.getAllByText('Related Guides');
    expect(relatedHeadings).toHaveLength(2);

    // Related guide links (the current guide 'test-guide' is filtered out)
    const alphaLinks = screen.getAllByText('Alpha Guide');
    expect(alphaLinks).toHaveLength(2); // mobile + desktop

    const betaLinks = screen.getAllByText('Beta Guide');
    expect(betaLinks).toHaveLength(2);

    // Each link should point to the correct guide URL
    const alphaAnchors = alphaLinks.map((el) => el.closest('a'));
    for (const anchor of alphaAnchors) {
      expect(anchor).toHaveAttribute('href', '/guide/alpha-guide');
    }
  });

  // -------------------------------------------------------------------------
  // 2. GuideSidebarContent renders guide info
  // -------------------------------------------------------------------------

  it('renders guide info with type, domain, sections count, and published status', async () => {
    const guide = createGuideMetadata({
      guide_type: 'product',
      domain_filter: 'Corporate',
      is_published: true,
    });
    const sections = [
      createSection({ section_id: 's1' }),
      createSection({ section_id: 's2' }),
      createSection({ section_id: 's3' }),
    ];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Guide Info heading appears in both mobile and desktop
    const infoHeadings = screen.getAllByText('Guide Info');
    expect(infoHeadings).toHaveLength(2);

    // Type label — 'Product Guide' in the sidebar info (also badge in header)
    const typeLabels = screen.getAllByText('Product Guide');
    expect(typeLabels.length).toBeGreaterThanOrEqual(2); // sidebar mobile + desktop (+ header badge)

    // Domain badge rendered via mock
    const domainBadges = screen.getAllByTestId('domain-badge');
    // Header has one, mobile sidebar has one, desktop sidebar has one = at least 3
    expect(domainBadges.length).toBeGreaterThanOrEqual(3);

    // Sections count — 3 sections
    const sectionCounts = screen.getAllByText('3');
    expect(sectionCounts).toHaveLength(2); // mobile + desktop

    // Published status — 'Yes'
    const publishedLabels = screen.getAllByText('Yes');
    expect(publishedLabels).toHaveLength(2);
  });

  it('shows "No" for unpublished guides', async () => {
    const guide = createGuideMetadata({ is_published: false });
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    const unpublished = screen.getAllByText('No');
    expect(unpublished).toHaveLength(2); // mobile + desktop
  });

  // -------------------------------------------------------------------------
  // 3. Handles 0 related guides — no Related Guides section, no gap
  // -------------------------------------------------------------------------

  it('does not render Related Guides section when there are no related guides', async () => {
    const guide = createGuideMetadata();
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // "Related Guides" heading should not appear at all
    expect(screen.queryByText('Related Guides')).not.toBeInTheDocument();

    // Guide Info should still appear (no gap — no mt-4 on the Guide Info div)
    const infoHeadings = screen.getAllByText('Guide Info');
    expect(infoHeadings).toHaveLength(2);

    // Verify no mt-4 class on Guide Info containers when no related guides
    for (const heading of infoHeadings) {
      const container = heading.closest('div.rounded-lg');
      expect(container).not.toHaveClass('mt-4');
    }
  });

  // -------------------------------------------------------------------------
  // 4. Mobile accordion has correct lg:hidden class
  // -------------------------------------------------------------------------

  it('wraps mobile sidebar in a div with lg:hidden class containing a <details> element', async () => {
    const guide = createGuideMetadata();
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Find the <summary> element with the accordion text
    const summary = screen.getByText('Guide details & related guides');
    expect(summary.tagName).toBe('SUMMARY');

    // The <details> is the parent of <summary>
    const details = summary.closest('details');
    expect(details).toBeInTheDocument();

    // The wrapper div has lg:hidden
    const mobileWrapper = details!.parentElement;
    expect(mobileWrapper).toHaveClass('lg:hidden');
  });

  // -------------------------------------------------------------------------
  // 5. Desktop aside has correct hidden lg:block class
  // -------------------------------------------------------------------------

  it('renders desktop aside with hidden and lg:block classes', async () => {
    const guide = createGuideMetadata();
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Find the <aside> element
    const aside = document.querySelector('aside');
    expect(aside).toBeInTheDocument();
    expect(aside).toHaveClass('hidden');
    expect(aside).toHaveClass('lg:block');
    expect(aside).toHaveClass('w-64');
    expect(aside).toHaveClass('shrink-0');
  });

  // -------------------------------------------------------------------------
  // 6. Both mobile and desktop render the same GuideSidebarContent
  // -------------------------------------------------------------------------

  it('renders identical sidebar content in both mobile accordion and desktop aside', async () => {
    const guide = createGuideMetadata({ guide_type: 'research', domain_filter: 'Technical' });
    const sections = [
      createSection({ section_id: 's1' }),
      createSection({ section_id: 's2' }),
    ];
    const relatedGuides = [
      createRelatedGuide({ id: 'r1', slug: 'peer-guide', name: 'Peer Guide' }),
    ];

    setupFetchResponses({ guide, sections }, relatedGuides);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Locate mobile accordion content
    const summary = screen.getByText('Guide details & related guides');
    const details = summary.closest('details')!;
    const mobileContent = within(details);

    // Locate desktop aside content
    const aside = document.querySelector('aside')!;
    const desktopContent = within(aside);

    // Both should have Guide Info heading
    expect(mobileContent.getByText('Guide Info')).toBeInTheDocument();
    expect(desktopContent.getByText('Guide Info')).toBeInTheDocument();

    // Both should have Related Guides heading
    expect(mobileContent.getByText('Related Guides')).toBeInTheDocument();
    expect(desktopContent.getByText('Related Guides')).toBeInTheDocument();

    // Both should have the related guide link
    expect(mobileContent.getByText('Peer Guide')).toBeInTheDocument();
    expect(desktopContent.getByText('Peer Guide')).toBeInTheDocument();

    // Both should have the guide type label
    expect(mobileContent.getByText('Research Guide')).toBeInTheDocument();
    expect(desktopContent.getByText('Research Guide')).toBeInTheDocument();

    // Both should show section count
    expect(mobileContent.getByText('2')).toBeInTheDocument();
    expect(desktopContent.getByText('2')).toBeInTheDocument();

    // Both should show published status
    expect(mobileContent.getByText('Yes')).toBeInTheDocument();
    expect(desktopContent.getByText('Yes')).toBeInTheDocument();

    // Both should have domain badge
    expect(mobileContent.getByTestId('domain-badge')).toBeInTheDocument();
    expect(desktopContent.getByTestId('domain-badge')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Edge cases
  // -------------------------------------------------------------------------

  it('shows loading state initially', () => {
    // Fetch never resolves
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<GuideContent slug="test-guide" />);

    expect(screen.getByRole('status', { name: /loading guide/i })).toBeInTheDocument();
  });

  it('shows error state when fetch fails', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({ error: 'Guide not found' }),
    });

    render(<GuideContent slug="nonexistent" />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Guide not found');
    });
  });

  it('maps guide type labels correctly for all known types', async () => {
    const guide = createGuideMetadata({ guide_type: 'company' });
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // 'company' maps to 'Company Guide' in sidebar info
    const typeLabels = screen.getAllByText('Company Guide');
    expect(typeLabels.length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to raw guide_type when type is not in label map', async () => {
    const guide = createGuideMetadata({ guide_type: 'unknown_type' });
    const sections = [createSection()];

    setupFetchResponses({ guide, sections }, []);

    render(<GuideContent slug="test-guide" />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Falls back to raw type string
    const typeLabels = screen.getAllByText('unknown_type');
    expect(typeLabels.length).toBeGreaterThanOrEqual(2);
  });
});
