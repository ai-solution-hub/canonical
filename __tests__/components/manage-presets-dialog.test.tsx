import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ManagePresetsDialog } from '@/components/browse/manage-presets-dialog';
import type { FilterPreset } from '@/types/filter-preset';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const systemPreset: FilterPreset = {
  id: 'system-stale',
  name: 'Stale content',
  params: 'freshness=stale%2Cexpired',
  isSystem: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

const userPreset1: FilterPreset = {
  id: 'u_abc123',
  name: 'Corporate content',
  params: 'domain=Corporate',
  isSystem: false,
  createdAt: '2026-03-01T00:00:00.000Z',
};

const userPreset2: FilterPreset = {
  id: 'u_def456',
  name: 'Stale articles',
  params: 'freshness=stale&type=article',
  isSystem: false,
  createdAt: '2026-03-02T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ManagePresetsDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    presets: [systemPreset, userPreset1, userPreset2],
    onRename: vi.fn(),
    onDelete: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders list of user presets
  it('renders list of user presets', () => {
    render(<ManagePresetsDialog {...defaultProps} />);
    expect(screen.getByText('Corporate content')).toBeInTheDocument();
    expect(screen.getByText('Stale articles')).toBeInTheDocument();
  });

  // 2. Does not show system presets
  it('does not show system presets', () => {
    render(<ManagePresetsDialog {...defaultProps} />);
    // System preset name should not appear in the management list
    expect(screen.queryByText('Stale content')).not.toBeInTheDocument();
  });

  // 3. Shows empty state when no user presets exist
  it('shows empty state when no user presets exist', () => {
    render(<ManagePresetsDialog {...defaultProps} presets={[systemPreset]} />);
    expect(
      screen.getByText(
        'No custom presets yet. Save your current filters from the browse page.',
      ),
    ).toBeInTheDocument();
  });

  // 4. Clicking edit icon enables inline editing
  it('clicking edit icon enables inline editing', async () => {
    const user = userEvent.setup();
    render(<ManagePresetsDialog {...defaultProps} />);
    const editButton = screen.getByLabelText(
      'Rename preset: Corporate content',
    );
    await user.click(editButton);
    const input = screen.getByDisplayValue('Corporate content');
    expect(input).toBeInTheDocument();
  });

  // 5. Pressing Enter confirms rename
  it('pressing Enter confirms rename', async () => {
    const user = userEvent.setup();
    render(<ManagePresetsDialog {...defaultProps} />);
    const editButton = screen.getByLabelText(
      'Rename preset: Corporate content',
    );
    await user.click(editButton);
    const input = screen.getByDisplayValue('Corporate content');
    await user.clear(input);
    await user.type(input, 'Renamed preset{Enter}');
    expect(defaultProps.onRename).toHaveBeenCalledWith(
      'u_abc123',
      'Renamed preset',
    );
  });

  // 6. Pressing Escape cancels rename
  it('pressing Escape cancels rename', async () => {
    const user = userEvent.setup();
    render(<ManagePresetsDialog {...defaultProps} />);
    const editButton = screen.getByLabelText(
      'Rename preset: Corporate content',
    );
    await user.click(editButton);
    const input = screen.getByDisplayValue('Corporate content');
    await user.clear(input);
    await user.type(input, 'Something else{Escape}');
    expect(defaultProps.onRename).not.toHaveBeenCalled();
    // Should revert to showing the original name as text
    expect(screen.getByText('Corporate content')).toBeInTheDocument();
  });

  // 7. Clicking delete button calls onDelete with preset ID
  it('clicking delete button calls onDelete with preset ID', async () => {
    const user = userEvent.setup();
    render(<ManagePresetsDialog {...defaultProps} />);
    const deleteButton = screen.getByLabelText(
      'Delete preset: Corporate content',
    );
    await user.click(deleteButton);
    expect(defaultProps.onDelete).toHaveBeenCalledWith('u_abc123');
  });

  // 8. Done button closes dialog
  it('done button closes dialog', async () => {
    const user = userEvent.setup();
    render(<ManagePresetsDialog {...defaultProps} />);
    const doneButton = screen.getByRole('button', { name: 'Done' });
    await user.click(doneButton);
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });
});
