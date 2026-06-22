/**
 * Workspaces Page Tests
 *
 * Tests the server-rendered workspaces page wrapper:
 * - ARIA label on the outer section element
 * - Passes counts to WorkspacesContent
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// Mock auth — getAuthenticatedClient returns discriminated union { success, supabase, user }
// Post-T2: workspace type discriminator is `application_types.key` via JOIN, not
// the dropped `workspaces.type` text column. The mock returns the nested
// `application_types!inner(key)` shape the page consumes.
//
// Post-ID-29.7 SSR-hydration fix: the page now ALSO pre-fetches the
// `application_types` rows server-side (`.select(...).order('label')`) to seed
// useLauncherTypes() as initialData. The mock therefore branches on the table
// name: `workspaces` resolves the count rows via `.eq()`, `application_types`
// resolves the seed rows via `.order()`.
vi.mock('@/lib/auth/client', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({
    success: true,
    user: { id: 'user-1' },
    supabase: {
      from: (table: string) => {
        if (table === 'application_types') {
          return {
            select: () => ({
              order: () =>
                Promise.resolve({
                  data: [
                    {
                      key: 'sales_proposal',
                      label: 'Sales Proposal',
                      label_plural: 'Sales Proposals',
                      description: 'Draft and manage sales proposals',
                      default_icon: 'file-signature',
                      default_colour: '#0d9488',
                    },
                  ],
                  error: null,
                }),
            }),
          };
        }
        // workspaces (count query)
        return {
          select: () => ({
            eq: () =>
              Promise.resolve({
                data: [
                  { application_types: { key: 'procurement' } },
                  { application_types: { key: 'procurement' } },
                  { application_types: { key: 'procurement' } },
                ],
                error: null,
              }),
          }),
        };
      },
    },
  }),
}));

// Mock next/navigation redirect
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// WorkspacesContent is a complex client component — mock to isolate page tests.
// Surface both props so the page's wiring (counts + the SSR application_types
// seed) is observable from the rendered output.
vi.mock('@/app/workspaces/workspaces-content', () => ({
  WorkspacesContent: ({
    counts,
    initialApplicationTypes,
  }: {
    counts: Record<string, number>;
    initialApplicationTypes: ReadonlyArray<{ key: string }>;
  }) => (
    <div
      data-testid="workspaces-content"
      data-counts={JSON.stringify(counts)}
      data-seed-keys={JSON.stringify(initialApplicationTypes.map((r) => r.key))}
    >
      Launcher
    </div>
  ),
}));

import WorkspacesPage from '@/app/workspaces/page';

describe('WorkspacesPage', () => {
  it('renders a section with aria-label "Workspaces"', async () => {
    const page = await WorkspacesPage();
    render(page);
    expect(screen.getByLabelText('Workspaces')).toBeInTheDocument();
  });

  it('renders the WorkspacesContent component', async () => {
    const page = await WorkspacesPage();
    render(page);
    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
  });

  it('passes workspace type counts to WorkspacesContent', async () => {
    const page = await WorkspacesPage();
    render(page);
    const el = screen.getByTestId('workspaces-content');
    const counts = JSON.parse(el.getAttribute('data-counts') ?? '{}');
    expect(counts).toEqual({ procurement: 3 });
  });

  it('passes the server-fetched application_types seed to WorkspacesContent', async () => {
    // The SSR seed (initialData for useLauncherTypes) is what eliminates the
    // empty-grid → populated-grid hydration mismatch (ID-29.7 fallout).
    const page = await WorkspacesPage();
    render(page);
    const el = screen.getByTestId('workspaces-content');
    const seedKeys = JSON.parse(el.getAttribute('data-seed-keys') ?? '[]');
    expect(seedKeys).toEqual(['sales_proposal']);
  });
});
