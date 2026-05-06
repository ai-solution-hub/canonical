/**
 * Coverage tabs — ConceptHelp a11y integration test.
 *
 * Verifies that the real `ConceptHelp` helper (NOT the stubbed
 * `<span data-testid=… />` variant used elsewhere) renders a keyboard-
 * focusable `<button>` with the expected `aria-label` inside an actual
 * coverage tab surface. This ensures the 8 ConceptHelp placements
 * shipped in P1-31 retain proper a11y semantics when the tab mounts,
 * not only in the dedicated `concept-help.test.tsx`.
 *
 * Scope: renders `PriorityGapsTab` in its empty-state branch so we don't
 * have to mock a full `UnifiedGapSummary`. The tab renders the persistent
 * `<ConceptHelp concept="priority-gaps" />` header outside the
 * conditional body, so the real helper mounts even on empty data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// vi.hoisted() — mocks referenced in vi.mock() factories
// ---------------------------------------------------------------------------

const { mockFetch } = vi.hoisted(() => ({
  mockFetch: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Module mocks — only the non-ConceptHelp collaborators are stubbed. The
// deliberate omission is `@/components/ui/concept-help` so the real helper
// mounts and its real `<button>` (with real `aria-label`) reaches the DOM.
// ---------------------------------------------------------------------------

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock('@/contexts/taxonomy-context', () => ({
  useTaxonomy: () => ({
    getDomainNames: () => [],
    formatDomainName: (name: string) => name,
    domains: [],
    subtopics: [],
    loading: false,
    error: null,
    getSubtopics: () => [],
    getDomainColourKey: () => 'corporate',
    formatSubtopic: (s: string) => s,
    refresh: () => {},
  }),
}));

vi.mock('@/lib/supabase/telemetry', () => ({
  logBestEffortWarn: vi.fn(),
}));

// Import AFTER mocks
import { PriorityGapsTab } from '@/components/coverage/priority-gaps-tab';
import { TooltipProvider } from '@/components/ui/tooltip';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Coverage tabs — ConceptHelp a11y integration', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch);
    // Empty-state response: no gaps. The persistent tab header (with the
    // real ConceptHelp) still renders in this branch.
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        total_gaps: 0,
        taxonomy_gaps: 0,
        template_gaps: 0,
        guide_gaps: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        gaps: [],
      }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('renders the real ConceptHelp <button> with the expected aria-label', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <PriorityGapsTab />
      </TooltipProvider>,
    );

    // Wait for the empty state to finish loading so the persistent header
    // has definitely rendered.
    await waitFor(() => {
      expect(
        screen.getByText('No content gaps detected'),
      ).toBeInTheDocument();
    });

    const helper = screen.getByRole('button', {
      name: /what does priority gaps mean\?/i,
    });
    expect(helper).toBeInTheDocument();
    expect(helper).not.toHaveAttribute('disabled');
  });

  it('opens the tooltip when the ConceptHelp trigger is focused via keyboard', async () => {
    const user = userEvent.setup();

    render(
      <TooltipProvider delayDuration={0}>
        <PriorityGapsTab />
      </TooltipProvider>,
    );

    await waitFor(() => {
      expect(
        screen.getByText('No content gaps detected'),
      ).toBeInTheDocument();
    });

    const helper = screen.getByRole('button', {
      name: /what does priority gaps mean\?/i,
    });

    // Wrap focus in act() so Radix Tooltip's open setState lands inside an
    // act boundary, not after teardown ("wrapped into act(...)" warning).
    await act(async () => {
      helper.focus();
      // Yield twice so Radix's internal setTimeouts (delayed open) settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(helper).toHaveFocus();

    await waitFor(() => {
      // Tooltip body copy (see CONCEPT_COPY['priority-gaps']).
      const matches = screen.getAllByText(
        /Missing content flagged as important/i,
      );
      expect(matches.length).toBeGreaterThan(0);
    });

    // Also verify it is reachable by keyboard tabbing (not just direct focus).
    await act(async () => {
      helper.blur();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await user.tab();
    // The helper should be in the tab order (it is the first focusable
    // element in the rendered tree).
    expect(document.activeElement).toBe(helper);
    // Final drain so any Radix close-transition setStates settle inside act.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  });
});
