/**
 * Guides Listing Page Tests
 *
 * Tests reading time estimate display, empty state search fallback link,
 * guide card rendering, and coverage label on cards.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    className,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
    variant?: string;
  }) => <span className={className}>{children}</span>,
}));

vi.mock('@/components/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

import GuidesPage from '@/app/guide/page';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mockFetchResponse(data: unknown, ok = true) {
  return vi.fn().mockResolvedValue({
    ok,
    json: () => Promise.resolve(data),
  });
}

const guideWithStats = {
  id: 'g1',
  slug: 'security-guide',
  name: 'Security Guide',
  description: 'A guide about security topics',
  guide_type: 'sector',
  domain_filter: 'security',
  icon: null,
  color: null,
  display_order: 1,
  is_published: true,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
  stats: {
    total_sections: 5,
    populated_sections: 3,
    required_sections: 4,
    populated_required: 2,
  },
};

const guideNoContent = {
  id: 'g2',
  slug: 'empty-guide',
  name: 'Empty Guide',
  description: null,
  guide_type: 'product',
  domain_filter: null,
  icon: null,
  color: null,
  display_order: 2,
  is_published: true,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
  stats: {
    total_sections: 3,
    populated_sections: 0,
    required_sections: 2,
    populated_required: 0,
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuidesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reading time estimate', () => {
    it('shows reading time on guide cards with populated sections', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // 3 populated sections * 4 min = 12 min
      expect(screen.getByText('12 min read')).toBeInTheDocument();
    });

    it('does not show reading time when no populated sections', async () => {
      global.fetch = mockFetchResponse([guideNoContent]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('Empty Guide')).toBeInTheDocument();
      });

      expect(screen.queryByText(/min read/)).not.toBeInTheDocument();
    });

    it('shows minimum 1 min read for guides with 1 populated section', async () => {
      const guideWith1Section = {
        ...guideWithStats,
        stats: { ...guideWithStats.stats, populated_sections: 1 },
      };
      global.fetch = mockFetchResponse([guideWith1Section]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // 1 section * 4 min = 4 min
      expect(screen.getByText('4 min read')).toBeInTheDocument();
    });

    it('has accessible aria-label for reading time', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(
        screen.getByLabelText('Estimated reading time: 12 minutes'),
      ).toBeInTheDocument();
    });
  });

  describe('empty state', () => {
    it('shows empty state when no guides', async () => {
      global.fetch = mockFetchResponse([]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('No guides published yet')).toBeInTheDocument();
      });
    });

    it('shows search fallback link in empty state', async () => {
      global.fetch = mockFetchResponse([]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(
          screen.getByText('Try searching for specific content'),
        ).toBeInTheDocument();
      });

      const link = screen.getByText('Try searching for specific content').closest('a');
      expect(link).toHaveAttribute('href', '/browse');
    });
  });

  describe('guide card coverage label', () => {
    it('shows section coverage stats on card', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuidesPage />);

      await waitFor(() => {
        expect(screen.getByText('3/5 sections populated')).toBeInTheDocument();
      });
    });
  });
});
