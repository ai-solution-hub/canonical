/**
 * SaveActionsBar Component Tests
 *
 * Tests the bottom bar with AI options (classify, summarise, draft),
 * save button states, split button dropdown, and cancel link.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

import { SaveActionsBar } from '@/components/create-content/save-actions-bar';
import type { SaveActionsBarProps } from '@/components/create-content/save-actions-bar';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createDefaultProps(overrides: Partial<SaveActionsBarProps> = {}): SaveActionsBarProps {
  return {
    autoClassify: true,
    setAutoClassify: vi.fn(),
    autoSummarise: true,
    setAutoSummarise: vi.fn(),
    saveAsDraft: false,
    setSaveAsDraft: vi.fn(),
    canSave: true,
    isSaving: false,
    isSavingAndContinue: false,
    onSaveAndContinue: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SaveActionsBar', () => {
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('renders classify and summarise checkboxes', () => {
    render(<SaveActionsBar {...createDefaultProps()} />);
    expect(screen.getByText('Classify automatically')).toBeInTheDocument();
    expect(screen.getByText('Generate summary')).toBeInTheDocument();
  });

  it('renders save-as-draft checkbox', () => {
    render(<SaveActionsBar {...createDefaultProps()} />);
    expect(screen.getByText(/Save as draft/i)).toBeInTheDocument();
  });

  it('save button is disabled when canSave is false', () => {
    render(<SaveActionsBar {...createDefaultProps({ canSave: false })} />);
    const saveButton = screen.getByRole('button', { name: /^save$/i });
    expect(saveButton).toBeDisabled();
  });

  it('save button shows loading state when isSaving is true', () => {
    render(<SaveActionsBar {...createDefaultProps({ isSaving: true })} />);
    expect(screen.getByText('Saving...')).toBeInTheDocument();
  });

  it('split button dropdown has "More save options" trigger', () => {
    render(<SaveActionsBar {...createDefaultProps()} />);
    expect(screen.getByLabelText('More save options')).toBeInTheDocument();
  });

  it('cancel link points to /browse', () => {
    render(<SaveActionsBar {...createDefaultProps()} />);
    const cancelLink = screen.getByText('Cancel');
    expect(cancelLink.closest('a')).toHaveAttribute('href', '/browse');
  });

  it('buttons are disabled during save', () => {
    render(<SaveActionsBar {...createDefaultProps({ isSaving: true })} />);
    const saveButton = screen.getByRole('button', { name: /saving/i });
    expect(saveButton).toBeDisabled();
    const moreOptions = screen.getByLabelText('More save options');
    expect(moreOptions).toBeDisabled();
  });
});
