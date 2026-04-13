/**
 * /intelligence/[workspaceId]/prompts — role-gate behaviour.
 *
 * Asserts that a viewer role sees the forbidden state (not the empty state
 * and not the refinement panel), while admins pass through to the normal
 * page content. The S158 WP1 refactor made the refinement panel the
 * primary interface and moved the raw PromptEditor behind an "Advanced"
 * disclosure — the admin-path assertion checks for the refinement panel,
 * not the editor (which is collapsed by default).
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
  mockUseWorkspaceFlags,
  mockUseAnalyseFlags,
  mockUseRescoringPreview,
  mockUseResolveFlags,
} = vi.hoisted(() => ({
  mockUseUserRole: vi.fn(),
  mockUseParams: vi.fn(),
  mockUseFeedPrompts: vi.fn(),
  mockUseCreatePromptVersion: vi.fn(),
  mockUseRollbackPrompt: vi.fn(),
  mockUseWorkspaceFlags: vi.fn(),
  mockUseAnalyseFlags: vi.fn(),
  mockUseRescoringPreview: vi.fn(),
  mockUseResolveFlags: vi.fn(),
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

vi.mock('@/hooks/intelligence/use-workspace-flags', () => ({
  useWorkspaceFlags: (id: string) => mockUseWorkspaceFlags(id),
}));

vi.mock('@/hooks/intelligence/use-analyse-flags', () => ({
  useAnalyseFlags: (id: string) => mockUseAnalyseFlags(id),
}));

vi.mock('@/hooks/intelligence/use-rescoring-preview', () => ({
  useRescoringPreview: (id: string) => mockUseRescoringPreview(id),
}));

vi.mock('@/hooks/intelligence/use-resolve-flags', () => ({
  useResolveFlags: (id: string) => mockUseResolveFlags(id),
}));

// Stub the heavier children so we can assert forbidden vs normal content
// cleanly. The refinement panel is the primary interface post-S158 WP1;
// the editor lives behind an "Advanced" toggle and is collapsed by default.
vi.mock('@/components/intelligence/prompt-editor', () => ({
  PromptEditor: () => <div data-testid="prompt-editor" />,
}));

vi.mock('@/components/intelligence/prompt-version-sidebar', () => ({
  PromptVersionSidebar: () => <div data-testid="prompt-version-sidebar" />,
}));

vi.mock('@/components/intelligence/prompt-refinement/refinement-panel', () => ({
  RefinementPanel: () => <div data-testid="refinement-panel" />,
}));

// Import AFTER mocks
import PromptsPage from '@/app/intelligence/[workspaceId]/filter-rules/page';

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

/**
 * Returns a mutation stand-in shaped like TanStack Query's useMutation
 * result. Minimal — tests only check that the refinement panel is or
 * isn't rendered based on role, not any of the mutation behaviour.
 */
function makeMutationStub() {
  return {
    mutate: vi.fn(),
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    data: undefined,
    isPending: false,
    isError: false,
    isSuccess: false,
    isIdle: true,
    status: 'idle',
    error: null,
    variables: undefined,
    context: undefined,
    failureCount: 0,
    failureReason: null,
    submittedAt: 0,
  };
}

describe('PromptsPage — role gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseParams.mockReturnValue({ workspaceId: WORKSPACE_ID });
    mockUseCreatePromptVersion.mockReturnValue(makeMutationStub());
    mockUseRollbackPrompt.mockReturnValue(makeMutationStub());
    mockUseAnalyseFlags.mockReturnValue(makeMutationStub());
    mockUseRescoringPreview.mockReturnValue(makeMutationStub());
    mockUseResolveFlags.mockReturnValue(makeMutationStub());
    mockUseFeedPrompts.mockReturnValue({
      data: SAMPLE_PROMPTS,
      isLoading: false,
    });
    mockUseWorkspaceFlags.mockReturnValue({
      data: [],
      isLoading: false,
    });
  });

  it('shows the forbidden state to viewers and does NOT render the refinement panel', () => {
    configureRole('viewer');
    render(<PromptsPage />);

    expect(
      screen.getByText(/don't have access to this section/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('refinement-panel')).not.toBeInTheDocument();
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

  it('renders the refinement panel + sidebar for admins', () => {
    configureRole('admin');
    render(<PromptsPage />);

    expect(
      screen.queryByText(/don't have access to this section/i),
    ).not.toBeInTheDocument();
    // Post-S158 WP1: the refinement panel is the primary interface.
    // The raw editor lives behind an Advanced disclosure and is
    // collapsed by default — the role-gate assertion should not depend
    // on it being visible.
    expect(screen.getByTestId('refinement-panel')).toBeInTheDocument();
    expect(screen.getByTestId('prompt-version-sidebar')).toBeInTheDocument();
    // Advanced disclosure button is present but the editor itself is
    // collapsed (not in the DOM via the conditional render).
    expect(
      screen.getByRole('button', { name: /advanced: edit prompt directly/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('prompt-editor')).not.toBeInTheDocument();
  });

  it('shows the forbidden state to editors — the prompts surface is admin-only at the UI layer', () => {
    // S157 adversarial verification (verifier 1) caught a gating bug in
    // the initial WP2 guard: the sub-nav hides the `Filter rules` tab from
    // editors (`adminOnly: true`) but the route guard only forbade viewers,
    // so editors could direct-navigate and see the editor. Tightened to
    // admin-only here and in the route guard to match the stated intent.
    configureRole('editor');
    render(<PromptsPage />);

    expect(
      screen.getByText(/don't have access to this section/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('refinement-panel')).not.toBeInTheDocument();
    expect(screen.queryByTestId('prompt-editor')).not.toBeInTheDocument();
  });

  it('does not flash the forbidden state while the role is loading', () => {
    configureRole(null);
    render(<PromptsPage />);

    expect(
      screen.queryByText(/don't have access to this section/i),
    ).not.toBeInTheDocument();
  });
});
