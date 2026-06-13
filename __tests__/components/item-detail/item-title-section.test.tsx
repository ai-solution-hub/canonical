/**
 * ItemTitleSection Component Tests
 *
 * Tests the read-only title display, verification badge (with trust data),
 * freshness indicator, source document, and metadata strip.
 *
 * Editing is no longer handled by this component — it was removed as part
 * of P0-1 F-5 (dead props cleanup). Per-field editing goes through
 * `useInlineFieldEdit` via the metadata sidebar or keyboard shortcut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const { mockUseDisplayNames } = vi.hoisted(() => ({
  mockUseDisplayNames: vi.fn(() => new Map<string, string>()),
}));

vi.mock('@/components/shared/verification-badge', () => ({
  VerificationBadge: ({
    verified,
    verifiedByName,
  }: {
    verified: boolean;
    verifiedByName?: string | null;
  }) => (
    <span
      data-testid="verification-badge"
      data-verified={verified}
      data-verified-by-name={verifiedByName ?? ''}
    >
      {verified
        ? verifiedByName
          ? `Verified by ${verifiedByName}`
          : 'Verified'
        : 'Unverified'}
    </span>
  ),
}));

vi.mock('@/components/shared/freshness-badge', () => ({
  FreshnessBadge: ({ freshness }: { freshness: string }) => (
    <span data-testid="freshness-badge">{freshness}</span>
  ),
}));

vi.mock('@/lib/format', () => ({
  formatSmartDate: (date: string) => (date ? 'Recently' : ''),
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: mockUseDisplayNames,
}));

import { ItemTitleSection } from '@/components/item-detail/item-title-section';
import type { ItemTitleSectionProps } from '@/components/item-detail/item-title-section';
import { createMockItem } from '@/__tests__/helpers/factories/components/item';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(
  overrides: Partial<ItemTitleSectionProps> = {},
): ItemTitleSectionProps {
  return {
    item: createMockItem({ title: 'Test Title' }),
    title: 'Test Title',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ItemTitleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseDisplayNames.mockReturnValue(new Map<string, string>());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders title as h1', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Title');
  });

  it('always shows metadata strip with verification badge', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    const badge = screen.getByTestId('verification-badge');
    expect(badge).toHaveAttribute('data-verified', 'false');
  });

  it('shows VerificationBadge as verified when verified_at is set', () => {
    const item = createMockItem({ verified_at: '2026-01-01T00:00:00Z' });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    const badge = screen.getByTestId('verification-badge');
    expect(badge).toHaveAttribute('data-verified', 'true');
  });

  it('passes verifiedByName to VerificationBadge when name is resolved', () => {
    const nameMap = new Map([['user-123', 'Jane Doe']]);
    mockUseDisplayNames.mockReturnValue(nameMap);
    const item = createMockItem({
      verified_at: '2026-01-01T00:00:00Z',
      verified_by: 'user-123',
    });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    const badge = screen.getByTestId('verification-badge');
    expect(badge).toHaveAttribute('data-verified-by-name', 'Jane Doe');
    expect(badge).toHaveTextContent('Verified by Jane Doe');
  });

  it('calls useDisplayNames with verified_by user ID', () => {
    const item = createMockItem({ verified_by: 'user-456' });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    expect(mockUseDisplayNames).toHaveBeenCalledWith(['user-456']);
  });

  it('renders verification badge as binary Verified when verified_at is set', () => {
    const item = createMockItem({ verified_at: '2026-01-01T00:00:00Z' });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    const badge = screen.getByTestId('verification-badge');
    expect(badge).toHaveAttribute('data-verified', 'true');
    // Curated tier retired in S157 WP4 — binary only
    expect(badge).not.toHaveAttribute('data-show-detailed-trust');
  });

  it('shows freshness badge when freshness is set', () => {
    const item = createMockItem({ freshness: 'fresh' });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    const badge = screen.getByTestId('freshness-badge');
    expect(badge).toHaveTextContent('fresh');
  });

  it('shows updated date when updated_at is set', () => {
    const item = createMockItem({ updated_at: '2026-03-20T10:00:00Z' });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('shows source document text', () => {
    const item = createMockItem({
      source_file: 'Annual Report 2025',
    });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    expect(screen.getByText('Annual Report 2025')).toBeInTheDocument();
    expect(screen.getByText('Source:')).toBeInTheDocument();
  });

  it('metadata strip has appropriate ARIA label', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    expect(screen.getByLabelText('Content metadata')).toBeInTheDocument();
  });

  it('does not render editing banner or inline input (read-only component)', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    // No input fields should be rendered
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    // No Save/Cancel buttons
    expect(screen.queryByText('Save')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});
