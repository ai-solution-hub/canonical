/**
 * ItemTitleSection Component Tests
 *
 * Tests the title display, inline editing, verification badge (with trust data),
 * source document, and editing banner with save/cancel buttons.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <button onClick={onClick as () => void} {...props}>
      {children as React.ReactNode}
    </button>
  ),
}));

vi.mock('@/components/ui/input', () => ({
  Input: (props: Record<string, unknown>) => <input {...props} />,
}));

vi.mock('@/hooks/use-display-names', () => ({
  useDisplayNames: mockUseDisplayNames,
}));

import { ItemTitleSection } from '@/components/item-detail/item-title-section';
import type { ItemTitleSectionProps } from '@/components/item-detail/item-title-section';
import type { ItemData } from '@/app/item/[id]/item-detail-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockItem(overrides: Partial<ItemData> = {}): ItemData {
  return {
    id: 'item-1',
    title: 'Test Title',
    suggested_title: null,
    content: null,
    summary: null,
    ai_keywords: null,
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    content_type: 'article',
    platform: null,
    author_name: null,
    source_url: null,
    file_path: null,
    source_domain: null,
    thumbnail_url: null,
    captured_date: null,
    classification_confidence: null,
    classification_reasoning: null,
    classified_at: null,
    summary_data: null,
    priority: null,
    user_tags: null,
    freshness: null,
    governance_review_status: null,
    metadata: null,
    ...overrides,
  };
}

function createDefaultProps(
  overrides: Partial<ItemTitleSectionProps> = {},
): ItemTitleSectionProps {
  return {
    item: createMockItem(),
    title: 'Test Title',
    isEditing: false,
    editDirty: false,
    editTitle: 'Test Title',
    setEditTitle: vi.fn(),
    setEditDirty: vi.fn(),
    handleSaveAll: vi.fn(),
    cancelEditMode: vi.fn(),
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

  it('renders title as h1 when not editing', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    const heading = screen.getByRole('heading', { level: 1 });
    expect(heading).toHaveTextContent('Test Title');
  });

  it('renders Input when isEditing is true', () => {
    render(<ItemTitleSection {...createDefaultProps({ isEditing: true })} />);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
    const input = screen.getByDisplayValue('Test Title');
    expect(input).toBeInTheDocument();
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
      source_document: 'Annual Report 2025',
    });
    render(<ItemTitleSection {...createDefaultProps({ item })} />);
    expect(screen.getByText('Annual Report 2025')).toBeInTheDocument();
    expect(screen.getByText('Source:')).toBeInTheDocument();
  });

  it('metadata strip has appropriate ARIA label', () => {
    render(<ItemTitleSection {...createDefaultProps()} />);
    expect(screen.getByLabelText('Content metadata')).toBeInTheDocument();
  });

  it('shows editing banner with "unsaved changes" when editDirty is true', () => {
    render(
      <ItemTitleSection
        {...createDefaultProps({ isEditing: true, editDirty: true })}
      />,
    );
    expect(screen.getByText(/unsaved changes/i)).toBeInTheDocument();
  });

  it('save button calls handleSaveAll', async () => {
    const handleSaveAll = vi.fn();
    const user = userEvent.setup();
    render(
      <ItemTitleSection
        {...createDefaultProps({ isEditing: true, handleSaveAll })}
      />,
    );
    await user.click(screen.getByText('Save'));
    expect(handleSaveAll).toHaveBeenCalledOnce();
  });

  it('cancel button calls cancelEditMode', async () => {
    const cancelEditMode = vi.fn();
    const user = userEvent.setup();
    render(
      <ItemTitleSection
        {...createDefaultProps({ isEditing: true, cancelEditMode })}
      />,
    );
    await user.click(screen.getByText('Cancel'));
    expect(cancelEditMode).toHaveBeenCalledOnce();
  });
});
