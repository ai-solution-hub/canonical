/**
 * Coverage tabs access-gating tests (P1-11 Option A)
 *
 * Verifies that viewer role is redirected away from /coverage,
 * while editors and admins retain full access.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() -- mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockReplace, mockUserRole, mockSearchParamsStore } = vi.hoisted(
  () => ({
    mockReplace: vi.fn(),
    mockUserRole: {
      role: 'editor' as string | null,
      loading: false,
      canEdit: true,
      canAdmin: false,
    },
    mockSearchParamsStore: {
      store: new Map<string, string>(),
      get(key: string) {
        return this.store.get(key) ?? null;
      },
      toString() {
        const params = new URLSearchParams();
        this.store.forEach((v: string, k: string) => params.set(k, v));
        return params.toString();
      },
      set(key: string, value: string) {
        this.store.set(key, value);
      },
      clear() {
        this.store.clear();
      },
    },
  }),
);

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParamsStore,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/coverage',
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

vi.mock('@/components/ui/concept-help', () => ({
  ConceptHelp: () => null,
}));

// Stub child tab components to isolate the access-gating logic
vi.mock('@/app/coverage/coverage-content', () => ({
  CoverageContent: () => <div data-testid="tab-taxonomy">Taxonomy</div>,
}));

vi.mock('@/components/coverage/template-coverage-content', () => ({
  TemplateCoverageContent: () => (
    <div data-testid="tab-templates">Templates</div>
  ),
}));

vi.mock('@/components/coverage/coverage-guide-tab', () => ({
  CoverageGuideTab: () => <div data-testid="tab-guides">Guides content</div>,
}));

vi.mock('@/components/coverage/priority-gaps-tab', () => ({
  PriorityGapsTab: () => (
    <div data-testid="tab-priority-gaps">Priority Gaps</div>
  ),
}));

import { CoveragePageTabs } from '@/app/coverage/coverage-tabs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoveragePageTabs access gating (P1-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore.clear();
    // Default: editor with access
    mockUserRole.role = 'editor';
    mockUserRole.loading = false;
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
  });

  // Test 1: Viewer redirect
  it('redirects viewer to /browse and renders null', () => {
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = false;

    const { container } = render(<CoveragePageTabs />);

    expect(mockReplace).toHaveBeenCalledWith('/browse');
    // Should render nothing (null) -- no tabs visible
    expect(container.innerHTML).toBe('');
  });

  // Test 2: Editor access
  it('renders tabs for editor role', () => {
    mockUserRole.role = 'editor';
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = false;

    render(<CoveragePageTabs />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tab-priority-gaps')).toBeInTheDocument();
  });

  // Test 3: Admin access
  it('renders tabs for admin role', () => {
    mockUserRole.role = 'admin';
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = true;
    mockUserRole.loading = false;

    render(<CoveragePageTabs />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tab-priority-gaps')).toBeInTheDocument();
  });

  // Test 4: Loading state -- no redirect while loading
  it('does not redirect while role is still loading', () => {
    mockUserRole.role = null;
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = true;

    render(<CoveragePageTabs />);

    // Must NOT redirect during loading -- would flicker editors
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
