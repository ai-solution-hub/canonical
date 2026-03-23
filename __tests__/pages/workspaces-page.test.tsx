/**
 * Workspaces Page Tests
 *
 * Tests the server-rendered workspaces page wrapper:
 * ARIA label on the outer section element.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// Mock the server-side createClient — WorkspacesPage calls getWorkspaces() and
// getWorkspaceItemCounts() which both use createClient from lib/supabase/server.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    from: () => ({
      select: () => ({
        order: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc: () => Promise.resolve({ data: [], error: null }),
  }),
}));

// WorkspacesContent is a complex client component — mock it to isolate page tests
vi.mock('@/app/workspaces/workspaces-content', () => ({
  WorkspacesContent: ({ initialWorkspaces }: { initialWorkspaces: unknown[] }) => (
    <div data-testid="workspaces-content">
      {Array.isArray(initialWorkspaces) ? initialWorkspaces.length : 0} workspaces
    </div>
  ),
}));

import WorkspacesPage from '@/app/workspaces/page';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkspacesPage', () => {
  it('renders a section with aria-label "Workspaces page"', async () => {
    const page = await WorkspacesPage();
    render(page);
    expect(screen.getByLabelText('Workspaces page')).toBeInTheDocument();
  });

  it('renders the WorkspacesContent component', async () => {
    const page = await WorkspacesPage();
    render(page);
    expect(screen.getByTestId('workspaces-content')).toBeInTheDocument();
  });
});
