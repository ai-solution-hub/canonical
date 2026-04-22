/**
 * Coverage tabs deep-link tests (P1-28)
 *
 * Verifies that the ?tab= query param selects the correct tab on mount,
 * and that invalid values fall back to the default (priority-gaps).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocked hooks & collaborators
// ---------------------------------------------------------------------------

const mockReplace = vi.fn();
const mockSearchParamsStore = vi.hoisted(() => {
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

vi.mock('next/navigation', () => ({
  useSearchParams: () => mockSearchParamsStore,
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/coverage',
}));

vi.mock('@/components/ui/concept-help', () => ({
  ConceptHelp: () => null,
}));

// Stub out the child tab components so we only test the routing logic.
// CoverageContent is imported via relative path in coverage-tabs.tsx, so
// mock the absolute module path that Vitest resolves.
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

describe('CoveragePageTabs deep-link', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsStore.clear();
  });

  it('defaults to priority-gaps tab when no ?tab param', () => {
    render(<CoveragePageTabs />);
    expect(screen.getByTestId('tab-priority-gaps')).toBeInTheDocument();
  });

  it('selects guides tab when ?tab=guides', () => {
    mockSearchParamsStore.set('tab', 'guides');
    render(<CoveragePageTabs />);
    expect(screen.getByTestId('tab-guides')).toBeInTheDocument();
  });

  it('selects taxonomy tab when ?tab=taxonomy', () => {
    mockSearchParamsStore.set('tab', 'taxonomy');
    render(<CoveragePageTabs />);
    expect(screen.getByTestId('tab-taxonomy')).toBeInTheDocument();
  });

  it('selects templates tab when ?tab=templates', () => {
    mockSearchParamsStore.set('tab', 'templates');
    render(<CoveragePageTabs />);
    expect(screen.getByTestId('tab-templates')).toBeInTheDocument();
  });

  it('falls back to priority-gaps when ?tab has invalid value', () => {
    mockSearchParamsStore.set('tab', 'nonexistent');
    render(<CoveragePageTabs />);
    expect(screen.getByTestId('tab-priority-gaps')).toBeInTheDocument();
  });

  it('renders Coverage Dashboard heading', () => {
    render(<CoveragePageTabs />);
    expect(
      screen.getByRole('heading', { name: /coverage dashboard/i }),
    ).toBeInTheDocument();
  });
});
