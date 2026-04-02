/**
 * Guides Listing Page Tests
 *
 * Tests reading time estimate display, empty state search fallback link,
 * guide card rendering, coverage label on cards, and search/filter functionality.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Mock state for useSearchParams
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockSearchParams = vi.hoisted(() => {
  const store = new Map<string, string>();
  return {
    store,
    get: (key: string) => store.get(key) ?? null,
    toString: () => {
      const params = new URLSearchParams();
      store.forEach((v, k) => params.set(k, v));
      return params.toString();
    },
    set: (key: string, value: string) => store.set(key, value),
    clear: () => store.clear(),
  };
});

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

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParams,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/guide',
}));

vi.mock('@/components/ui/badge', () => ({
  Badge: ({
    children,
    className,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    className?: string;
    variant?: string;
    'aria-label'?: string;
  }) => (
    <span className={className} aria-label={ariaLabel}>
      {children}
    </span>
  ),
}));

vi.mock('@/components/shared/domain-badge', () => ({
  DomainBadge: ({ domain }: { domain: string }) => (
    <span data-testid="domain-badge">{domain}</span>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: React.ComponentProps<'input'>) => <input {...props} />,
}));

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="select" data-value={value}>
      {typeof onValueChange === 'function' && (
        <input
          data-testid="select-change"
          type="hidden"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        />
      )}
      {children}
    </div>
  ),
  SelectTrigger: ({
    children,
    'aria-label': ariaLabel,
    className,
  }: {
    children: React.ReactNode;
    'aria-label'?: string;
    className?: string;
  }) => (
    <button aria-label={ariaLabel} className={className}>
      {children}
    </button>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <span>{placeholder}</span>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SelectItem: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value: string;
  }) => <div data-value={value}>{children}</div>,
}));

import { GuideContent } from '@/app/guide/guide-content';

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

const guideResearch = {
  id: 'g3',
  slug: 'research-guide',
  name: 'Research Overview',
  description: 'Comprehensive research methodology guide',
  guide_type: 'research',
  domain_filter: 'methodology',
  icon: null,
  color: null,
  display_order: 3,
  is_published: true,
  created_at: '2025-01-01',
  updated_at: '2025-01-01',
  stats: {
    total_sections: 4,
    populated_sections: 4,
    required_sections: 4,
    populated_required: 4,
  },
};

const allGuides = [guideWithStats, guideNoContent, guideResearch];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams.clear();
  });

  describe('reading time estimate', () => {
    it('shows reading time on guide cards with populated sections', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // 3 populated sections * 4 min = 12 min
      expect(screen.getByText('12 min read')).toBeInTheDocument();
    });

    it('does not show reading time when no populated sections', async () => {
      global.fetch = mockFetchResponse([guideNoContent]);

      render(<GuideContent />);

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

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // 1 section * 4 min = 4 min
      expect(screen.getByText('4 min read')).toBeInTheDocument();
    });

    it('has accessible aria-label for reading time', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuideContent />);

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

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('No guides published yet')).toBeInTheDocument();
      });
    });

    it('shows search fallback link in empty state', async () => {
      global.fetch = mockFetchResponse([]);

      render(<GuideContent />);

      await waitFor(() => {
        expect(
          screen.getByText('Try searching for specific content'),
        ).toBeInTheDocument();
      });

      const link = screen
        .getByText('Try searching for specific content')
        .closest('a');
      expect(link).toHaveAttribute('href', '/browse');
    });
  });

  describe('guide card coverage label', () => {
    it('shows section coverage stats on card', async () => {
      global.fetch = mockFetchResponse([guideWithStats]);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('3/5 sections populated')).toBeInTheDocument();
      });
    });
  });

  describe('filter bar', () => {
    it('renders search input and type filter when guides exist', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Search guides')).toBeInTheDocument();
      expect(screen.getByLabelText('Filter by type')).toBeInTheDocument();
    });

    it('renders domain filter when guides have domain_filter values', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Filter by domain')).toBeInTheDocument();
    });

    it('does not render filter bar when no guides exist', async () => {
      global.fetch = mockFetchResponse([]);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('No guides published yet')).toBeInTheDocument();
      });

      expect(screen.queryByLabelText('Search guides')).not.toBeInTheDocument();
    });
  });

  describe('search filtering', () => {
    it('updates URL param when typing in search input', async () => {
      global.fetch = mockFetchResponse(allGuides);
      const user = userEvent.setup();

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      const searchInput = screen.getByLabelText('Search guides');
      await user.type(searchInput, 'security');

      // router.replace should have been called with q param
      expect(mockReplace).toHaveBeenCalled();
      const lastCall =
        mockReplace.mock.calls[mockReplace.mock.calls.length - 1];
      expect(lastCall[0]).toContain('q=');
    });

    it('filters guides by name (case-insensitive) via URL param', async () => {
      mockSearchParams.set('q', 'security');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // Only the security guide should show
      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Research Overview')).not.toBeInTheDocument();
    });

    it('filters guides by description via URL param', async () => {
      mockSearchParams.set('q', 'methodology');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Research Overview')).toBeInTheDocument();
      });

      expect(screen.queryByText('Security Guide')).not.toBeInTheDocument();
    });
  });

  describe('type filtering', () => {
    it('filters guides by type via URL param', async () => {
      mockSearchParams.set('type', 'sector');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Research Overview')).not.toBeInTheDocument();
    });
  });

  describe('domain filtering', () => {
    it('filters guides by domain via URL param', async () => {
      mockSearchParams.set('domain', 'methodology');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Research Overview')).toBeInTheDocument();
      });

      expect(screen.queryByText('Security Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
    });
  });

  describe('combined AND filtering', () => {
    it('applies search and type filters together', async () => {
      mockSearchParams.set('q', 'guide');
      mockSearchParams.set('type', 'sector');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // "guide" appears in Security Guide name + sector type filter
      // Empty Guide matches "guide" in name but is product type
      // Research Overview does not match "guide" in name
      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Research Overview')).not.toBeInTheDocument();
    });

    it('applies all three filters together', async () => {
      mockSearchParams.set('q', 'security');
      mockSearchParams.set('type', 'sector');
      mockSearchParams.set('domain', 'security');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Research Overview')).not.toBeInTheDocument();
    });
  });

  describe('clear filters', () => {
    it('shows clear filters button when filters are active', async () => {
      mockSearchParams.set('q', 'security');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
    });

    it('calls router.replace with plain pathname on clear', async () => {
      mockSearchParams.set('q', 'security');
      global.fetch = mockFetchResponse(allGuides);
      const user = userEvent.setup();

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      const clearButton = screen.getByLabelText('Clear all filters');
      await user.click(clearButton);

      expect(mockReplace).toHaveBeenCalledWith('/guide', { scroll: false });
    });

    it('does not show clear filters button when no filters active', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(
        screen.queryByLabelText('Clear all filters'),
      ).not.toBeInTheDocument();
    });
  });

  describe('no-results empty state', () => {
    it('shows "No guides match your filters" when filters exclude all guides', async () => {
      mockSearchParams.set('q', 'nonexistent-term-xyz');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(
          screen.getByText('No guides match your filters'),
        ).toBeInTheDocument();
      });

      expect(
        screen.getByText(
          'Try broadening your search or removing some filters.',
        ),
      ).toBeInTheDocument();
    });

    it('has a clear filters link in the no-results state', async () => {
      mockSearchParams.set('type', 'custom');
      global.fetch = mockFetchResponse([guideWithStats]); // no custom guides

      render(<GuideContent />);

      await waitFor(() => {
        expect(
          screen.getByText('No guides match your filters'),
        ).toBeInTheDocument();
      });

      const clearButton = screen.getByText('Clear all filters');
      expect(clearButton).toBeInTheDocument();
    });

    it('does not show no-results state when guides exist and no filters active', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(
        screen.queryByText('No guides match your filters'),
      ).not.toBeInTheDocument();
    });
  });

  describe('URL param persistence', () => {
    it('pre-populates search input from q URL param', async () => {
      mockSearchParams.set('q', 'security');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      const searchInput = screen.getByLabelText(
        'Search guides',
      ) as HTMLInputElement;
      expect(searchInput.value).toBe('security');
    });

    it('renders with combined URL params and shows filtered results', async () => {
      mockSearchParams.set('q', 'security');
      mockSearchParams.set('type', 'sector');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      // Other guides should be filtered out
      expect(screen.queryByText('Empty Guide')).not.toBeInTheDocument();
      expect(screen.queryByText('Research Overview')).not.toBeInTheDocument();
    });
  });

  describe('active filter count', () => {
    it('shows count badge with correct number of active filters', async () => {
      mockSearchParams.set('q', 'security');
      mockSearchParams.set('type', 'sector');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('2 active filters')).toBeInTheDocument();
    });

    it('shows singular label for 1 active filter', async () => {
      mockSearchParams.set('q', 'guide');
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('1 active filter')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has aria-live region for filter results', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      const liveRegion = screen
        .getByText('Security Guide')
        .closest('[aria-live]');
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-label on search input', async () => {
      global.fetch = mockFetchResponse(allGuides);

      render(<GuideContent />);

      await waitFor(() => {
        expect(screen.getByText('Security Guide')).toBeInTheDocument();
      });

      expect(screen.getByLabelText('Search guides')).toBeInTheDocument();
    });
  });
});
