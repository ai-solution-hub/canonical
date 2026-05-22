/**
 * WorkspaceCreateDialog Component Tests
 *
 * Tests type-aware behaviour. Post-T2:
 * - `kb_section` was retired (no rows in either env). The DB's non-custom-creation
 *   type for sales proposals is `sales_proposal` (label "Sales Proposal").
 * - `bid` was renamed to `procurement` (label "Procurement", hasCustomCreation: true).
 * Default prop is `procurement`, which delegates to the bid wizard.
 *
 * Post-ID-29.7: dialog consumes `useWorkspaceType()` (TanStack hook). Tests wrap
 * in a `QueryClientProvider` (via `createQueryWrapper()`) and stub `fetch` (via
 * `stubApplicationTypesFetch()`) to return the 6 application_types seed rows.
 * Assertions about `typeConfig`-derived UI use `waitFor` because the hook
 * resolves asynchronously (~50ms in jsdom).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
import { createQueryWrapper } from '@/__tests__/helpers/query-wrapper';
import { stubApplicationTypesFetch } from '@/__tests__/helpers/workspace-type-fixtures';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stubApplicationTypesFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('sales_proposal type (no custom creation — shows form)', () => {
    // Post-ID-29.7: DB seed key is `sales_proposal` (label "Sales Proposal");
    // the static registry's legacy `proposal` key no longer maps to a DB row.
    it('shows registry-driven title when type is sales_proposal', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="sales_proposal"
        />,
        { wrapper: createQueryWrapper().Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText('New Sales Proposal')).toBeInTheDocument();
      });
      expect(
        screen.getByText(
          'Draft and manage sales proposals drawing on your knowledge base',
        ),
      ).toBeInTheDocument();
    });

    it('shows the form with name input when type is sales_proposal', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="sales_proposal"
        />,
        { wrapper: createQueryWrapper().Wrapper },
      );

      // The form is rendered on first paint (no async dependency); the typeConfig
      // resolution only affects header copy and the submit-button label.
      expect(screen.getByLabelText('Name')).toBeInTheDocument();
      expect(screen.getByLabelText('Description')).toBeInTheDocument();
      expect(screen.getByText('Colour')).toBeInTheDocument();
      expect(screen.getByText('Icon')).toBeInTheDocument();
    });

    it('shows Create button with registry label', async () => {
      render(
        <WorkspaceCreateDialog
          open={true}
          onOpenChange={mockOnOpenChange}
          onCreated={mockOnCreated}
          type="sales_proposal"
        />,
        { wrapper: createQueryWrapper().Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText('Create Sales Proposal')).toBeInTheDocument();
      });
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
        { wrapper: createQueryWrapper().Wrapper },
      );

      // procurement has hasCustomCreation: true — dialog closes and delegates
      // once the hook resolves and the effect re-runs with the new typeConfig.
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
        { wrapper: createQueryWrapper().Wrapper },
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
        { wrapper: createQueryWrapper().Wrapper },
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
