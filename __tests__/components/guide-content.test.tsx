/**
 * GuideContent Component Tests
 *
 * Tests the guide content rendering including:
 * - Guide Info metadata visibility based on user role
 * - Related Guides rendering on mobile (outside accordion)
 * - Desktop sidebar rendering
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockCanEdit } = vi.hoisted(() => ({
  mockCanEdit: { value: true },
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({
    role: mockCanEdit.value ? 'admin' : 'viewer',
    loading: false,
    canEdit: mockCanEdit.value,
    canAdmin: mockCanEdit.value,
  }),
}));

vi.mock('@/components/guide/guide-section', () => ({
  GuideSection: ({ section }: { section: { section_name: string } }) => (
    <div data-testid="guide-section">{section.section_name}</div>
  ),
}));

vi.mock('@/components/guide/guide-progress-bar', () => ({
  GuideProgressBar: () => <div data-testid="guide-progress-bar" />,
}));

vi.mock('@/components/guide/guide-research-feed', () => ({
  GuideResearchFeed: () => <div data-testid="guide-research-feed" />,
}));

vi.mock('@/components/guide/guide-table-of-contents', () => ({
  GuideTableOfContents: () => <div data-testid="guide-toc" />,
}));

vi.mock('@/components/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { GuideContent } from '@/app/guide/[slug]/guide-content';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockGuideData = {
  guide: {
    id: 'guide-1',
    slug: 'test-guide',
    name: 'Test Guide',
    description: 'A test guide',
    guide_type: 'sector',
    domain_filter: 'energy',
    icon: null,
    color: null,
    display_order: 1,
    is_published: true,
    created_by: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
  sections: [
    {
      section_id: 'section-1',
      section_name: 'Overview',
      section_description: null,
      section_order: 1,
      expected_layer: null,
      subtopic_filter: null,
      is_required: true,
      content_items: [
        {
          content_id: 'item-1',
          content_title: 'Test Item',
          content_type: 'article',
          content_layer: null,
          content_brief: null,
          content_freshness: null,
          content_verified_at: null,
          content_captured_date: null,
        },
      ],
    },
  ],
};

const mockRelatedGuides = [
  { id: 'guide-2', slug: 'related-guide', name: 'Related Guide', guide_type: 'sector' },
  { id: 'guide-3', slug: 'another-guide', name: 'Another Guide', guide_type: 'sector' },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanEdit.value = true;

    // Mock fetch for guide data and related guides
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mockGuideData),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          ...mockRelatedGuides,
          { id: 'guide-1', slug: 'test-guide', name: 'Test Guide', guide_type: 'sector' },
        ]),
      });
  });

  it('renders guide name after loading', async () => {
    render(<GuideContent slug="test-guide" />);
    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });
  });

  describe('Guide Info visibility', () => {
    it('shows Guide Info card for editors', async () => {
      mockCanEdit.value = true;
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      // Guide Info headings should be present (desktop + mobile accordion)
      const guideInfoHeadings = screen.getAllByText('Guide Info');
      expect(guideInfoHeadings.length).toBeGreaterThanOrEqual(1);
    });

    it('hides Guide Info card for viewers', async () => {
      mockCanEdit.value = false;
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      // Guide Info should not be rendered for viewers
      expect(screen.queryByText('Guide Info')).not.toBeInTheDocument();
    });

    it('hides Edit Guide button for viewers', async () => {
      mockCanEdit.value = false;
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      expect(screen.queryByText('Edit Guide')).not.toBeInTheDocument();
    });
  });

  describe('Related Guides', () => {
    it('renders Related Guides for all roles', async () => {
      mockCanEdit.value = false;
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      // Related Guides should be visible even for viewers
      const relatedHeadings = screen.getAllByText('Related Guides');
      expect(relatedHeadings.length).toBeGreaterThanOrEqual(1);
    });

    it('renders related guide links', async () => {
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      // Should show the related guides (not the current guide)
      const relatedLinks = screen.getAllByText('Related Guide');
      expect(relatedLinks.length).toBeGreaterThanOrEqual(1);
    });

    it('does not show mobile accordion for viewers when no Guide Info', async () => {
      mockCanEdit.value = false;
      render(<GuideContent slug="test-guide" />);
      await waitFor(() => {
        expect(screen.getByText('Test Guide')).toBeInTheDocument();
      });
      // The "Guide details" accordion summary should not appear for viewers
      expect(screen.queryByText('Guide details')).not.toBeInTheDocument();
    });
  });
});
