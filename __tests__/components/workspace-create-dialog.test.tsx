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
 * in a `QueryClientProvider` and stub `fetch` to return the 6 application_types
 * seed rows. Assertions about `typeConfig`-derived UI use `waitFor` because the
 * hook resolves asynchronously (~50ms in jsdom).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
// Hook fixture — 6 seed rows verbatim from GET /api/application-types
// ---------------------------------------------------------------------------

const SEED_ROWS_SNAKE = [
  {
    key: 'procurement',
    label: 'Procurement',
    label_plural: 'Procurements',
    description:
      'Manage bid responses and tender submissions using your knowledge base',
    default_icon: 'briefcase',
    default_colour: '#d4880f',
  },
  {
    key: 'intelligence',
    label: 'Intelligence Stream',
    label_plural: 'Intelligence Streams',
    description:
      'Sector and competitor news feeds tailored to your company profile.',
    default_icon: 'newspaper',
    default_colour: '#059669',
  },
  {
    key: 'sales_proposal',
    label: 'Sales Proposal',
    label_plural: 'Sales Proposals',
    description:
      'Draft and manage sales proposals drawing on your knowledge base',
    default_icon: 'file-signature',
    default_colour: '#0d9488',
  },
  {
    key: 'product_guide',
    label: 'Product Guide',
    label_plural: 'Product Guides',
    description: 'Product Guide',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'competitor_research',
    label: 'Competitor Research',
    label_plural: 'Competitor Researchs',
    description: 'Competitor Research',
    default_icon: null,
    default_colour: null,
  },
  {
    key: 'training_onboarding',
    label: 'Training Onboarding',
    label_plural: 'Training Onboardings',
    description: 'Training Onboarding',
    default_icon: null,
    default_colour: null,
  },
];

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return React.createElement(
      QueryClientProvider,
      { client: queryClient },
      children,
    );
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspaceCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        url,
        json: async () => SEED_ROWS_SNAKE,
      })),
    );
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
        { wrapper: createWrapper() },
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
        { wrapper: createWrapper() },
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
        { wrapper: createWrapper() },
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
        { wrapper: createWrapper() },
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
        { wrapper: createWrapper() },
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
        { wrapper: createWrapper() },
      );

      await waitFor(() => {
        expect(mockOnOpenChange).toHaveBeenCalledWith(false);
      });
    });
  });
});
