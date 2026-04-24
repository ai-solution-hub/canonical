/**
 * EntityDetailPanel — CertificationMetadataForm holder tests (OPS-25)
 *
 * Exercises the holder Select placeholder behaviour after the S193 fix
 * that replaced the silent default of 'self' with an explicit
 * "Choose holder..." placeholder.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Radix Select jsdom shims (per feedback_radix_select_jsdom_shims)
// ---------------------------------------------------------------------------

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';

beforeEach(() => {
  installRadixPointerShims();
});

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const { mockUseEntityDetail } = vi.hoisted(() => ({
  mockUseEntityDetail: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  usePathname: () => '/settings',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('next/link', () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

vi.mock('@/hooks/use-entity-detail', () => ({
  useEntityDetail: mockUseEntityDetail,
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { EntityDetailPanel } from '@/components/entity-management/entity-detail-panel';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a mock `useEntityDetail` result for a certification entity
 * with the given metadata. Defaults match a cert with no holder set.
 */
function makeEntityDetail(
  metadataOverrides: Record<string, unknown> = {},
  typeOverrides: Record<string, unknown> = {},
) {
  return {
    detail: {
      canonical_name: 'iso 27001',
      entity_type: 'certification',
      effective_type: 'certification',
      has_type_override: false,
      mention_count: 3,
      variant_names: ['ISO 27001', 'ISO27001'],
      variant_count: 2,
      types_seen: ['certification'],
      has_type_conflict: false,
      content_items: [],
      content_item_count: 0,
      relationships: [],
      relationship_count: 0,
      metadata: { ...metadataOverrides },
      ...typeOverrides,
    },
    isLoading: false,
    error: null,
    saveMetadata: vi.fn().mockResolvedValue(undefined),
    isSaving: false,
    saveError: null,
    saveSuccess: false,
    resetSaveState: vi.fn(),
    changeType: vi.fn(),
    isChangingType: false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('EntityDetailPanel — holder placeholder (OPS-25)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows "Choose holder..." placeholder when metadata.holder is unset', () => {
    mockUseEntityDetail.mockReturnValue(makeEntityDetail({}));

    render(
      <EntityDetailPanel
        canonicalName="iso 27001"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // The SelectValue should render the placeholder text, not "Self-held"
    const holderTrigger = screen.getByRole('combobox', {
      name: /holder/i,
    });
    // With value='', Radix Select shows the placeholder
    expect(holderTrigger).toHaveTextContent('Choose holder');
    expect(holderTrigger).not.toHaveTextContent('Self-held');
  });

  it('shows "Self-held" when metadata.holder is "self"', () => {
    mockUseEntityDetail.mockReturnValue(
      makeEntityDetail({ holder: 'self' }),
    );

    render(
      <EntityDetailPanel
        canonicalName="iso 27001"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    const holderTrigger = screen.getByRole('combobox', {
      name: /holder/i,
    });
    expect(holderTrigger).toHaveTextContent('Self-held');
  });

  it('reveals supplier-name input when user picks Supplier-held (proves holder transitions to "supplier")', async () => {
    const mockSaveMetadata = vi.fn().mockResolvedValue(undefined);
    const entityDetail = makeEntityDetail({});
    entityDetail.saveMetadata = mockSaveMetadata;
    mockUseEntityDetail.mockReturnValue(entityDetail);

    const user = userEvent.setup();

    render(
      <EntityDetailPanel
        canonicalName="iso 27001"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );

    // Open the holder select dropdown
    const holderTrigger = screen.getByRole('combobox', {
      name: /holder/i,
    });
    await user.click(holderTrigger);

    // Wait for the dropdown to open and select "Supplier-held"
    await waitFor(() => {
      expect(
        screen.getByRole('option', { name: /supplier-held/i }),
      ).toBeVisible();
    });

    await user.click(
      screen.getByRole('option', { name: /supplier-held/i }),
    );

    // After selection, the supplier name input should appear
    await waitFor(() => {
      expect(screen.getByLabelText(/supplier name/i)).toBeInTheDocument();
    });
  });
});
