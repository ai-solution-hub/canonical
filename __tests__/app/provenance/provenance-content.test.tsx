/**
 * ProvenanceContent shell tests
 *
 * Tests role gating, tab navigation, URL sync, and fallback states for the
 * provenance shell component.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockRouter, mockSearchParams, mockUserRole } = vi.hoisted(() => ({
  mockRouter: {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn().mockResolvedValue(undefined),
  },
  mockSearchParams: { value: new URLSearchParams() },
  mockUserRole: {
    role: 'admin' as string | null,
    loading: false,
    canEdit: true,
    canAdmin: true,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => mockRouter,
  usePathname: () => '/provenance',
  useSearchParams: () => mockSearchParams.value,
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => ({ ...mockUserRole }),
}));

// Mock the dynamic tab content components
vi.mock('@/components/provenance/per-item-tab', () => ({
  default: () => <div data-testid="per-item-tab">Per-item content</div>,
}));

vi.mock('@/components/provenance/pipeline-health-tab', () => ({
  default: () => (
    <div data-testid="pipeline-health-tab">Pipeline Health content</div>
  ),
}));

vi.mock('@/components/provenance/audit-tab', () => ({
  default: () => <div data-testid="audit-tab">Audit content</div>,
}));

vi.mock('@/components/provenance/cost-tab-stub', () => ({
  default: () => <div data-testid="cost-tab-stub">Cost stub content</div>,
}));

vi.mock('@/components/provenance/disputes-tab-stub', () => ({
  default: () => (
    <div data-testid="disputes-tab-stub">Disputes stub content</div>
  ),
}));

import { ProvenanceContent } from '@/app/provenance/provenance-content';
import { PROVENANCE_TABS } from '@/components/provenance/tab-ids';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setSearchParams(params: string) {
  mockSearchParams.value = new URLSearchParams(params);
}

function resetMocks() {
  vi.clearAllMocks();
  mockUserRole.role = 'admin';
  mockUserRole.loading = false;
  mockUserRole.canEdit = true;
  mockUserRole.canAdmin = true;
  setSearchParams('tab=per-item');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvenanceContent', () => {
  beforeEach(() => {
    resetMocks();
  });

  // -------------------------------------------------------------------------
  // Role gating
  // -------------------------------------------------------------------------

  describe('role gating', () => {
    it('shows spinner while loading', () => {
      mockUserRole.loading = true;
      render(<ProvenanceContent />);
      // Loader2 renders as an SVG with animate-spin class
      const spinner = document.querySelector('.animate-spin');
      expect(spinner).toBeInTheDocument();
    });

    it('shows AccessDenied for viewer role', () => {
      mockUserRole.role = 'viewer';
      mockUserRole.canAdmin = false;
      mockUserRole.canEdit = false;
      render(<ProvenanceContent />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Admin access required')).toBeInTheDocument();
    });

    it('shows AccessDenied for editor role', () => {
      mockUserRole.role = 'editor';
      mockUserRole.canAdmin = false;
      mockUserRole.canEdit = true;
      render(<ProvenanceContent />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Admin access required')).toBeInTheDocument();
    });

    it('shows tabs for admin role', () => {
      render(<ProvenanceContent />);
      expect(screen.getByText('Provenance')).toBeInTheDocument();
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Default tab
  // -------------------------------------------------------------------------

  describe('default tab', () => {
    it('redirects to per-item when no tab param is present', () => {
      setSearchParams('');
      render(<ProvenanceContent />);
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/provenance?tab=per-item',
        { scroll: false },
      );
    });
  });

  // -------------------------------------------------------------------------
  // URL sync
  // -------------------------------------------------------------------------

  describe('URL sync', () => {
    it('calls router.replace when switching tabs', async () => {
      const user = userEvent.setup();
      render(<ProvenanceContent />);

      const tabList = screen.getByRole('tablist');
      const auditTrigger = within(tabList).getByText('Audit');
      await user.click(auditTrigger);

      expect(mockRouter.replace).toHaveBeenCalledWith('/provenance?tab=audit', {
        scroll: false,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Invalid tab
  // -------------------------------------------------------------------------

  describe('invalid tab handling', () => {
    it('redirects to per-item when tab param is invalid', () => {
      setSearchParams('tab=foo');
      render(<ProvenanceContent />);
      expect(mockRouter.replace).toHaveBeenCalledWith(
        '/provenance?tab=per-item',
        { scroll: false },
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tab ordering
  // -------------------------------------------------------------------------

  describe('tab ordering', () => {
    it('renders tabs in PROVENANCE_TABS order', () => {
      render(<ProvenanceContent />);
      const tabList = screen.getByRole('tablist');
      const triggers = within(tabList).getAllByRole('tab');
      const labels = triggers.map((t) => t.textContent);
      const expectedLabels = PROVENANCE_TABS.map((t) => t.label);
      expect(labels).toEqual(expectedLabels);
    });
  });
});
