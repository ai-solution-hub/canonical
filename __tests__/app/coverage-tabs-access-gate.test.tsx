/**
 * Coverage tabs access-gating tests (P1-11 Option A)
 *
 * Verifies that viewer role is redirected away from /coverage,
 * while editors and admins retain full access.
 *
 * ID-131.19 fix-Executor escalation 2 (DR-034): CoveragePageTabs no longer
 * hosts multiple tabs (taxonomy/priority-gaps/guides retired) — it renders
 * the single surviving TemplateCoverageContent view directly. The
 * deep-link (?tab=) coverage that lived alongside this file retired with
 * the multi-tab shell; only the access-gating behaviour is still relevant
 * here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() -- mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockReplace, mockUserRole } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockUserRole: {
    role: 'editor' as string | null,
    loading: false,
    canEdit: true,
    canAdmin: false,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUserRole,
}));

vi.mock('@/components/ui/concept-help', () => ({
  ConceptHelp: () => null,
}));

// Stub the surviving tab content to isolate the access-gating logic.
vi.mock('@/components/coverage/template-coverage-content', () => ({
  TemplateCoverageContent: () => (
    <div data-testid="tab-templates">Templates</div>
  ),
}));

import { CoveragePageTabs } from '@/app/coverage/coverage-tabs';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CoveragePageTabs access gating (P1-11)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: editor with access
    mockUserRole.role = 'editor';
    mockUserRole.loading = false;
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
  });

  // Test 1: Viewer redirect
  it('redirects viewer to /library and renders null', () => {
    mockUserRole.role = 'viewer';
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = false;

    const { container } = render(<CoveragePageTabs />);

    expect(mockReplace).toHaveBeenCalledWith('/library');
    // Should render nothing (null) -- no content visible
    expect(container.innerHTML).toBe('');
  });

  // Test 2: Editor access
  it('renders the template coverage view for editor role', () => {
    mockUserRole.role = 'editor';
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = false;

    render(<CoveragePageTabs />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tab-templates')).toBeInTheDocument();
  });

  // Test 3: Admin access
  it('renders the template coverage view for admin role', () => {
    mockUserRole.role = 'admin';
    mockUserRole.canEdit = true;
    mockUserRole.canAdmin = true;
    mockUserRole.loading = false;

    render(<CoveragePageTabs />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('tab-templates')).toBeInTheDocument();
  });

  // Test 4: Loading state -- no redirect while loading
  // Intent: the guard renders the full view while `loading: true` so that
  // editors/admins never see a flash-of-redirect during the role resolution
  // tick. The positive assertion on the heading documents the expected
  // visible state; the negative assertion on `mockReplace` is the critical
  // correctness check.
  it('does not redirect while role is still loading', () => {
    mockUserRole.role = null;
    mockUserRole.canEdit = false;
    mockUserRole.canAdmin = false;
    mockUserRole.loading = true;

    render(<CoveragePageTabs />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
  });
});
