/**
 * GuidesSection Component Tests
 *
 * Tests the guide management section — loading, empty state,
 * guide row rendering, create dialog, and delete confirmation.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockTaxonomyContext } from '../helpers/mock-contexts';

// ---------------------------------------------------------------------------
// vi.hoisted() — mock values referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch, mockToast, mockTaxonomy } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
  mockTaxonomy: {
    value: null as ReturnType<
      typeof import('../helpers/mock-contexts').mockTaxonomyContext
    > | null,
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('sonner', () => ({
  toast: mockToast,
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => mockTaxonomy.value,
}));

vi.mock('@/lib/client-config', () => ({
  CLIENT_CONFIG: { features: {} },
}));

vi.mock('@/contexts/layer-vocabulary-context', () => ({
  useLayerVocabulary: () => ({
    layers: [
      { key: 'bid_detail', label: 'Bid Detail', description: '', order: 2 },
      {
        key: 'company_reference',
        label: 'Company Reference',
        description: '',
        order: 3,
      },
    ],
    loading: false,
    error: null,
    getLayerKeys: () => ['bid_detail', 'company_reference'],
    getLayerLabel: (key: string) => {
      const map: Record<string, string> = {
        bid_detail: 'Bid Detail',
        company_reference: 'Company Reference',
      };
      return map[key] ?? key;
    },
    getLayerDescription: () => '',
    refresh: vi.fn(),
  }),
}));

vi.mock('@/lib/validation/guide-schemas', () => ({
  VALID_GUIDE_TYPES: ['sector', 'product', 'company', 'research', 'custom'],
}));

// Mock the Select components to simplify testing (avoids Radix portal rendering)
vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    value,
  }: {
    children: React.ReactNode;
    value?: string;
    onValueChange?: (v: string) => void;
  }) => (
    <div data-testid="mock-select" data-value={value}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children, ...props }: Record<string, unknown>) => (
    <button {...props}>{children as React.ReactNode}</button>
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

import { GuidesSection } from '@/components/settings/guides-section';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createGuide(overrides: Record<string, unknown> = {}) {
  return {
    id: 'guide-1',
    slug: 'test-guide',
    name: 'Test Guide',
    description: 'A test guide',
    guide_type: 'sector',
    domain_filter: null,
    icon: null,
    color: null,
    display_order: 1,
    is_published: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuidesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTaxonomy.value = mockTaxonomyContext();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows loading spinner while fetching guides', () => {
    mockFetch.mockReturnValue(new Promise(() => {}));

    render(<GuidesSection />);

    const spinners = document.querySelectorAll('.animate-spin');
    expect(spinners.length).toBeGreaterThan(0);
  });

  it('shows empty state when no guides exist', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(<GuidesSection />);

    await waitFor(() => {
      expect(screen.getByText(/no guides created yet/i)).toBeInTheDocument();
    });
  });

  it('renders guide rows with name, type badge, and publish status', async () => {
    const guides = [
      createGuide({
        id: 'g1',
        name: 'Sector Overview',
        slug: 'sector-overview',
        guide_type: 'sector',
        is_published: true,
      }),
      createGuide({
        id: 'g2',
        name: 'Product Guide',
        slug: 'product-guide',
        guide_type: 'product',
        is_published: false,
      }),
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(guides),
    });

    render(<GuidesSection />);

    await waitFor(() => {
      expect(screen.getByText('Sector Overview')).toBeInTheDocument();
    });

    expect(screen.getByText('Product Guide')).toBeInTheDocument();
    // Type badges
    expect(screen.getByText('Sector')).toBeInTheDocument();
    expect(screen.getByText('Product')).toBeInTheDocument();
    // Published status
    expect(screen.getByText('Published')).toBeInTheDocument();
    expect(screen.getByText('Draft')).toBeInTheDocument();
  });

  it('opens create guide dialog when Create Guide is clicked', async () => {
    const user = userEvent.setup();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    render(<GuidesSection />);

    await waitFor(() => {
      expect(screen.getByText(/no guides created yet/i)).toBeInTheDocument();
    });

    // The "Create Guide" button in the header (not inside the dialog)
    const createButtons = screen.getAllByRole('button', {
      name: /create guide/i,
    });
    await user.click(createButtons[0]);

    await waitFor(() => {
      // Dialog title and description text
      expect(
        screen.getByText('Define a new curated guide for your knowledge base.'),
      ).toBeInTheDocument();
    });

    // Dialog should contain form fields
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByLabelText('Slug')).toBeInTheDocument();
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
  });

  it('calls delete API when guide delete is confirmed', async () => {
    const user = userEvent.setup();
    const guide = createGuide();

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([guide]),
    });

    // Mock window.confirm
    vi.stubGlobal(
      'confirm',
      vi.fn(() => true),
    );

    render(<GuidesSection />);

    await waitFor(() => {
      expect(screen.getByText('Test Guide')).toBeInTheDocument();
    });

    // Click delete button (has title "Delete guide")
    const deleteButton = screen.getByTitle('Delete guide');

    // Prepare the delete response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });
    // Prepare the re-fetch response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve([]),
    });

    await user.click(deleteButton);

    await waitFor(() => {
      // Confirm was called
      expect(globalThis.confirm).toHaveBeenCalled();
    });

    // Delete API should have been called
    await waitFor(() => {
      const deleteCalls = mockFetch.mock.calls.filter(
        (call) =>
          typeof call[0] === 'string' &&
          (call[0] as string).includes('/api/guides/') &&
          (call[1] as RequestInit | undefined)?.method === 'DELETE',
      );
      expect(deleteCalls.length).toBe(1);
    });

    expect(mockToast.success).toHaveBeenCalledWith('Guide deleted');
  });
});
