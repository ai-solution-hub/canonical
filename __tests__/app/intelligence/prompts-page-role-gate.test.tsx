/**
 * /intelligence/[workspaceId]/prompts — role-gate behaviour (S157 WP2, C6).
 *
 * Asserts that a viewer role sees the forbidden state (not the empty state
 * and not the editor), while admins/editors pass through to the normal page
 * content.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

const {
  mockUseUserRole,
  mockUseParams,
  mockUseFeedPrompts,
  mockUseCreatePromptVersion,
  mockUseRollbackPrompt,
} = vi.hoisted(() => ({
  mockUseUserRole: vi.fn(),
  mockUseParams: vi.fn(),
  mockUseFeedPrompts: vi.fn(),
  mockUseCreatePromptVersion: vi.fn(),
  mockUseRollbackPrompt: vi.fn(),
}));

vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
}));

vi.mock('@/hooks/intelligence/use-feed-prompts', () => ({
  useFeedPrompts: (id: string) => mockUseFeedPrompts(id),
  useCreatePromptVersion: (id: string) => mockUseCreatePromptVersion(id),
  useRollbackPrompt: (id: string) => mockUseRollbackPrompt(id),
}));

// Stub the heavier children so we can assert forbidden vs editor cleanly.
vi.mock('@/components/intelligence/prompt-editor', () => ({
  PromptEditor: () => <div data-testid="prompt-editor" />,
}));

vi.mock('@/components/intelligence/prompt-version-sidebar', () => ({
  PromptVersionSidebar: () => <div data-testid="prompt-version-sidebar" />,
}));

// Import AFTER mocks
import PromptsPage from '@/app/intelligence/[workspaceId]/prompts/page';

const WORKSPACE_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const SAMPLE_PROMPTS = [
  {
    id: 'p1',
    prompt_text: 'Active prompt text',
    version: 1,
    is_active: true,
    created_at: '2026-01-01T00:00:00Z',
  },
];

function configureRole(role: 'admin' | 'editor' | 'viewer' | null) {
  mockUseUserRole.mockReturnValue({
    role,
    canEdit: role === 'admin' || role === 'editor',
    canAdmin: role === 'admin',
    loading: role === null,
  });
}

describe('PromptsPage — role gate (S157 WP2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ workspaceId: WORKSPACE_ID });
    mockUseCreatePromptVersion.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseRollbackPrompt.mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
    });
    mockUseFeedPrompts.mockReturnValue({
      data: SAMPLE_PROMPTS,
      isLoading: false,
    });
  });

  it('shows the forbidden state to viewers and does NOT render the editor', () => {
    configureRole('viewer');
    render(<PromptsPage />);

    expect(
      screen.getByText(/don't have access to this section/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('prompt-editor')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('prompt-version-sidebar'),
    ).not.toBeInTheDocument();
    // And the empty-state copy is NOT rendered to viewers — the spec warns
    // against leaking "prompts" mechanism language to non-admins.
    expect(
      screen.queryByText(/No filter rules configured/i),
    ).not.toBeInTheDocument();
  });

  it('renders the editor for admins', () => {
    configureRole('admin');
    render(<PromptsPage />);

    expect(
      screen.queryByText(/don't have access to this section/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-editor')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-sidebar')).toBeInTheDocument();
  });

  it('renders the editor for editors (API layer allows editor writes)', () => {
    configureRole('editor');
    render(<PromptsPage />);

    expect(
      screen.queryByText(/don't have access to this section/i),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('prompt-editor')).toBeInTheDocument();
  });

  it('does not flash the forbidden state while the role is loading', () => {
    configureRole(null);
    render(<PromptsPage />);

    expect(
      screen.queryByText(/don't have access to this section/i),
    ).not.toBeInTheDocument();
  });
});
