/**
 * WorkspaceCreateDialog Component Tests
 *
 * Tests type-aware behaviour: kb_section shows form, bid delegates to wizard.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockOnOpenChange, mockOnCreated, mockOnBidCreate } = vi.hoisted(() => ({
  mockOnOpenChange: vi.fn(),
  mockOnCreated: vi.fn(),
  mockOnBidCreate: vi.fn(),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }),
}));

vi.mock('@/components/workspace-colour-picker', () => ({
  WorkspaceColourPicker: () => <div data-testid="colour-picker" />,
}));

vi.mock('@/components/workspace-icon-picker', () => ({
  WorkspaceIconPicker: () => <div data-testid="icon-picker" />,
}));

import { WorkspaceCreateDialog } from '@/components/workspace-create-dialog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('kb_section type (default)', () => {
    it('shows "New KB Section" title when type is kb_section', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="kb_section"
        />,
      );

      expect(screen.getByText('New KB Section')).toBeInTheDocument();
      expect(
        screen.getByText('Create a content section to organise related items.'),
      ).toBeInTheDocument();
    });

    it('defaults to kb_section when no type is provided', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
        />,
      );

      expect(screen.getByText('New KB Section')).toBeInTheDocument();
    });

    it('shows the form with name input when type is kb_section', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="kb_section"
        />,
      );

      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByText('Colour')).toBeInTheDocument();
      expect(screen.getByText('Icon')).toBeInTheDocument();
    });
  });

  describe('bid type', () => {
    it('closes dialog and calls onBidCreate when type is bid', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="bid"
          onBidCreate={mockOnBidCreate}
        />,
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
        expect(mockOnBidCreate).toHaveBeenCalledTimes(1);
      });
    });

    it('closes dialog without error when type is bid and no onBidCreate provided', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="bid"
        />,
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
