/**
 * WorkspaceCreateDialog Component Tests
 *
 * Tests type-aware behaviour. Post-T2:
 * - `kb_section` was retired (no rows in either env). The registry's
 *   non-custom-creation type is now `proposal` (label "Sales Proposal").
 * - `bid` was renamed to `procurement` (label "Bid", hasCustomCreation: true).
 * Default prop is `procurement`, which delegates to the bid wizard.
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
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('@/components/workspace/workspace-colour-picker', () => ({
  WorkspaceColourPicker: () => <div data-testid="colour-picker" />,
}));

vi.mock('@/components/workspace/workspace-icon-picker', () => ({
  WorkspaceIconPicker: () => <div data-testid="icon-picker" />,
}));

import { WorkspaceCreateDialog } from '@/components/workspace/workspace-create-dialog';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('proposal type (no custom creation — shows form)', () => {
    it('shows registry-driven title when type is proposal', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="proposal"
        />,
      );

      expect(screen.getByText('New Sales Proposal')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Draft and manage sales proposals drawing on your knowledge base',
        ),
      ).toBeInTheDocument();
    });

    it('shows the form with name input when type is proposal', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="proposal"
        />,
      );

      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByText('Colour')).toBeInTheDocument();
      expect(screen.getByText('Icon')).toBeInTheDocument();
    });

    it('shows Create button with registry label', () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="proposal"
        />,
      );

      expect(screen.getByText('Create Sales Proposal')).toBeInTheDocument();
    });
  });

  describe('procurement type (custom creation — default)', () => {
    it('defaults to procurement when no type is provided (delegates to wizard)', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          onBidCreate={mockOnBidCreate}
        />,
      );

      // procurement has hasCustomCreation: true — dialog closes and delegates.
      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
        expect(mockOnBidCreate).toHaveBeenCalledTimes(1);
      });
    });

    it('closes dialog and calls onBidCreate when type has custom creation', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="procurement"
          onBidCreate={mockOnBidCreate}
        />,
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
        expect(mockOnBidCreate).toHaveBeenCalledTimes(1);
      });
    });

    it('closes dialog without error when type is procurement and no onBidCreate provided', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="procurement"
        />,
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
