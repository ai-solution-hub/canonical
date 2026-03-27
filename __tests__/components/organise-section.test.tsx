/**
 * OrganiseSection Component Tests
 *
 * Tests the OrganiseSection component — conditional rendering, expand/collapse,
 * keyword display and editing, and inline "Add" links.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>{children as React.ReactNode}</a>
  ),
}));

vi.mock('@/components/workspace/workspace-selector', () => ({
  WorkspaceSelector: ({ itemId }: { itemId: string }) => (
    <div data-testid="workspace-selector">{itemId}</div>
  ),
}));

vi.mock('@/components/shared/user-tag-input', () => ({
  UserTagInput: ({ itemId }: { itemId: string }) => (
    <div data-testid="user-tag-input">{itemId}</div>
  ),
}));

import { OrganiseSection } from '@/components/item-detail/organise-section';
import type { Workspace } from '@/types/content';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function defaultProps(overrides: Record<string, any> = {}) {
  return {
    itemId: 'item-1',
    keywords: [] as string[],
    tags: [] as string[],
    workspaces: [] as Workspace[],
    canEdit: true,
    onKeywordsChanged: vi.fn(),
    onTagsChanged: vi.fn(),
    onWorkspacesChanged: vi.fn(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrganiseSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('returns null when canEdit is false and all arrays are empty', () => {
    const { container } = render(
      <OrganiseSection {...defaultProps({ canEdit: false })} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('shows collapsed state with "Add" links when all empty and canEdit is true', () => {
    render(<OrganiseSection {...defaultProps()} />);
    expect(screen.getByText('Organise')).toBeInTheDocument();
    expect(screen.getByText('Add keywords')).toBeInTheDocument();
    expect(screen.getByText('Assign to...')).toBeInTheDocument();
    expect(screen.getByText('Add tags')).toBeInTheDocument();
  });

  it('expands on toggle click', async () => {
    const user = userEvent.setup();
    render(<OrganiseSection {...defaultProps()} />);

    // Click the Organise toggle button
    const organiseBtn = screen.getByRole('button', { name: /organise/i });
    await user.click(organiseBtn);

    // After expanding, workspace selector and tag input should appear
    await waitFor(() => {
      expect(screen.getByTestId('workspace-selector')).toBeInTheDocument();
      expect(screen.getByTestId('user-tag-input')).toBeInTheDocument();
    });
  });

  it('shows keywords section when keywords are provided', () => {
    render(
      <OrganiseSection
        {...defaultProps({ keywords: ['security', 'compliance'] })}
      />,
    );
    expect(screen.getByText('Keywords')).toBeInTheDocument();
    expect(screen.getByText('security')).toBeInTheDocument();
    expect(screen.getByText('compliance')).toBeInTheDocument();
  });

  it('shows keyword badges with remove buttons when canEdit is true', () => {
    render(
      <OrganiseSection
        {...defaultProps({ keywords: ['security'] })}
      />,
    );
    expect(screen.getByLabelText('Remove security')).toBeInTheDocument();
  });

  it('hides remove buttons when canEdit is false', () => {
    render(
      <OrganiseSection
        {...defaultProps({ canEdit: false, keywords: ['security'] })}
      />,
    );
    expect(screen.getByText('security')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove security')).not.toBeInTheDocument();
  });

  it('adds keyword via Enter key', async () => {
    const user = userEvent.setup();
    const onKeywordsChanged = vi.fn();
    render(
      <OrganiseSection
        {...defaultProps({ keywords: ['existing'], onKeywordsChanged })}
      />,
    );

    const input = screen.getByPlaceholderText('Add keyword...');
    await user.type(input, 'newkeyword{Enter}');

    expect(onKeywordsChanged).toHaveBeenCalledWith(['existing', 'newkeyword']);
  });

  it('shows inline "Add" links for empty categories', () => {
    // Has keywords but not tags or workspaces
    render(
      <OrganiseSection
        {...defaultProps({ keywords: ['security'] })}
      />,
    );
    expect(screen.getByText('Assign to...')).toBeInTheDocument();
    expect(screen.getByText('Add tags')).toBeInTheDocument();
  });
});
