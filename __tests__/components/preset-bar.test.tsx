import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PresetBar } from '@/components/browse/preset-bar';
import type { FilterPreset } from '@/types/filter-preset';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const systemPresets: FilterPreset[] = [
  {
    id: 'system-stale',
    name: 'Stale content',
    params: 'freshness=stale%2Cexpired',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'system-unreviewed',
    name: 'Unreviewed items',
    params: 'review_status=unverified',
    isSystem: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
];

const userPreset: FilterPreset = {
  id: 'u_abc123',
  name: 'My custom preset',
  params: 'domain=Corporate',
  isSystem: false,
  createdAt: '2026-03-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PresetBar', () => {
  const defaultProps = {
    presets: [...systemPresets, userPreset],
    activePresetId: null as string | null,
    onApplyPreset: vi.fn(),
    onClearFilters: vi.fn(),
    onSavePreset: vi.fn(),
    onManagePresets: vi.fn(),
    canSave: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders all preset chips
  it('renders all preset chips', () => {
    render(<PresetBar {...defaultProps} />);
    expect(screen.getByText('Stale content')).toBeInTheDocument();
    expect(screen.getByText('Unreviewed items')).toBeInTheDocument();
    expect(screen.getByText('My custom preset')).toBeInTheDocument();
  });

  // 2. Active preset chip has active styling
  it('active preset chip has active styling', () => {
    render(<PresetBar {...defaultProps} activePresetId="system-stale" />);
    const activeButton = screen.getByText('Stale content');
    expect(activeButton).toHaveAttribute('aria-pressed', 'true');
    expect(activeButton.className).toContain('border-primary');
  });

  // 3. Clicking inactive preset calls onApplyPreset
  it('clicking inactive preset calls onApplyPreset', async () => {
    const user = userEvent.setup();
    render(<PresetBar {...defaultProps} />);
    await user.click(screen.getByText('Stale content'));
    expect(defaultProps.onApplyPreset).toHaveBeenCalledWith('system-stale');
  });

  // 4. Clicking active preset calls onClearFilters
  it('clicking active preset calls onClearFilters', async () => {
    const user = userEvent.setup();
    render(<PresetBar {...defaultProps} activePresetId="system-stale" />);
    await user.click(screen.getByText('Stale content'));
    expect(defaultProps.onClearFilters).toHaveBeenCalled();
    expect(defaultProps.onApplyPreset).not.toHaveBeenCalled();
  });

  // 5. Save button visible when canSave is true
  it('save button visible when canSave is true', () => {
    render(<PresetBar {...defaultProps} canSave={true} />);
    expect(screen.getByLabelText('Save current filters as preset')).toBeInTheDocument();
  });

  // 6. Save button hidden when canSave is false
  it('save button hidden when canSave is false', () => {
    render(<PresetBar {...defaultProps} canSave={false} />);
    expect(screen.queryByLabelText('Save current filters as preset')).not.toBeInTheDocument();
  });

  // 7. Manage button visible when user presets exist
  it('manage button visible when user presets exist', () => {
    render(<PresetBar {...defaultProps} />);
    expect(screen.getByLabelText('Manage filter presets')).toBeInTheDocument();
  });

  // 8. Manage button hidden when only system presets
  it('manage button hidden when only system presets', () => {
    render(<PresetBar {...defaultProps} presets={systemPresets} />);
    expect(screen.queryByLabelText('Manage filter presets')).not.toBeInTheDocument();
  });

  // 9. Save button click calls onSavePreset
  it('save button click calls onSavePreset', async () => {
    const user = userEvent.setup();
    render(<PresetBar {...defaultProps} canSave={true} />);
    await user.click(screen.getByLabelText('Save current filters as preset'));
    expect(defaultProps.onSavePreset).toHaveBeenCalled();
  });

  // 10. Chips have correct aria-pressed attribute
  it('chips have correct aria-pressed attribute', () => {
    render(<PresetBar {...defaultProps} activePresetId="system-stale" />);
    const staleButton = screen.getByText('Stale content');
    const unreviewedButton = screen.getByText('Unreviewed items');
    expect(staleButton).toHaveAttribute('aria-pressed', 'true');
    expect(unreviewedButton).toHaveAttribute('aria-pressed', 'false');
  });
});
