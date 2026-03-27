import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SavePresetDialog } from '@/components/browse/save-preset-dialog';

// Mock sonner toast
vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('SavePresetDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    onSave: vi.fn(),
    activeFilterCount: 3,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // 1. Renders dialog with title and input
  it('renders dialog with title and input', () => {
    render(<SavePresetDialog {...defaultProps} />);
    expect(screen.getByText('Save filter preset')).toBeInTheDocument();
    expect(screen.getByLabelText('Preset name')).toBeInTheDocument();
    expect(screen.getByText('3 active filters will be saved.')).toBeInTheDocument();
  });

  // 2. Save button disabled when input is empty
  it('save button disabled when input is empty', () => {
    render(<SavePresetDialog {...defaultProps} />);
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  // 3. Save button disabled when input is whitespace only
  it('save button disabled when input is whitespace only', async () => {
    const user = userEvent.setup();
    render(<SavePresetDialog {...defaultProps} />);
    const input = screen.getByLabelText('Preset name');
    await user.type(input, '   ');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeDisabled();
  });

  // 4. Save button enabled when name is entered
  it('save button enabled when name is entered', async () => {
    const user = userEvent.setup();
    render(<SavePresetDialog {...defaultProps} />);
    const input = screen.getByLabelText('Preset name');
    await user.type(input, 'My preset');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    expect(saveButton).toBeEnabled();
  });

  // 5. Calls onSave with trimmed name on submit
  it('calls onSave with trimmed name on submit', async () => {
    const user = userEvent.setup();
    render(<SavePresetDialog {...defaultProps} />);
    const input = screen.getByLabelText('Preset name');
    await user.type(input, '  My preset  ');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);
    expect(defaultProps.onSave).toHaveBeenCalledWith('My preset');
  });

  // 6. Closes dialog after save
  it('closes dialog after save', async () => {
    const user = userEvent.setup();
    render(<SavePresetDialog {...defaultProps} />);
    const input = screen.getByLabelText('Preset name');
    await user.type(input, 'My preset');
    const saveButton = screen.getByRole('button', { name: 'Save' });
    await user.click(saveButton);
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
  });

  // 7. Cancel button closes dialog without saving
  it('cancel button closes dialog without saving', async () => {
    const user = userEvent.setup();
    render(<SavePresetDialog {...defaultProps} />);
    const cancelButton = screen.getByRole('button', { name: 'Cancel' });
    await user.click(cancelButton);
    expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    expect(defaultProps.onSave).not.toHaveBeenCalled();
  });

  // 8. Input respects maxLength of 50
  it('input respects maxLength of 50', () => {
    render(<SavePresetDialog {...defaultProps} />);
    const input = screen.getByLabelText('Preset name');
    expect(input).toHaveAttribute('maxLength', '50');
  });
});
