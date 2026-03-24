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

// Mock auth — getAuthenticatedClient returns { supabase }
const mockSelect = vi.fn();
vi.mock('@/lib/auth', () => ({
  getAuthenticatedClient: vi.fn().mockResolvedValue({
    supabase: {
      from: () => ({
        select: () => ({
          eq: () =>
            Promise.resolve({
              data: [{ type: 'bid' }, { type: 'bid' }, { type: 'bid' }],
              error: null,
            }),
        }),
      }),
    },
  }),
}));

// Mock next/navigation redirect
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

// WorkspacesContent is a complex client component — mock to isolate page tests
vi.mock('@/app/workspaces/workspaces-content', () => ({
  WorkspacesContent: ({ counts }: { counts: Record<string, number> }) => (
    <div data-testid="workspaces-content" data-counts={JSON.stringify(counts)}>
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
    expect(counts).toEqual({ bid: 3 });
  });
});
