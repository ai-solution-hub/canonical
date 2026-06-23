/**
 * RssFeedPanel Component Tests
 *
 * Verifies that the filtered (near-miss) RSS feed row carries a clear
 * competitive-intelligence warning, while the passed feed row does not.
 *
 * SI-M7: The filtered feed at /api/feeds/[workspaceId]/rss/filtered is
 * fully public (no auth) and exposes relevance reasoning. Users must be
 * warned that sharing the URL leaks evaluation criteria to competitors.
 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { RssFeedPanel } from '@/components/intelligence/rss-feed-panel';

const WORKSPACE_ID = 'a3f1c2d4-1234-4abc-8def-0123456789ab';
const WORKSPACE_NAME = 'Acme Intelligence';

describe('RssFeedPanel', () => {
  it('renders both passed and filtered feed rows', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    expect(screen.getByText('Passed Articles')).toBeInTheDocument();
    expect(
      screen.getByText('Filtered Articles (Near Misses)'),
    ).toBeInTheDocument();
  });

  it('shows the competitive-intelligence warning text on the filtered row', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    // Warning copy should explicitly flag the borderline-articles risk + competitor risk
    expect(
      screen.getByText(
        /This feed shows borderline articles and the criteria they were judged against — share only with internal stakeholders\. A competitor subscribing to this URL could learn what you monitor\./,
      ),
    ).toBeInTheDocument();
  });

  it('attaches the warning role="note" to the filtered row only', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    const notes = screen.getAllByRole('note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toHaveTextContent(/This feed shows borderline articles/);
  });

  it('renders the AlertTriangle warning icon on the filtered row', () => {
    const { container } = render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    // lucide-react renames AlertTriangle to "triangle-alert" internally and
    // renders SVGs with class "lucide-triangle-alert".
    // There should be at least one warning icon present (header + caption).
    const warningIcons = container.querySelectorAll(
      'svg.lucide-triangle-alert',
    );
    expect(warningIcons.length).toBeGreaterThanOrEqual(1);
  });

  it('flags the filtered row container as sensitive', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    const filteredHeading = screen.getByText('Filtered Articles (Near Misses)');
    // Walk up to the row container carrying the sensitive-state hook.
    // Assert the stable data-* attribute rather than the design-system
    // colour token (the token may be renamed under bl-349; the colour is
    // owned by the design system, the warning STATE is owned here).
    const filteredRow = filteredHeading.closest('div.flex.flex-col.gap-2');
    expect(filteredRow).not.toBeNull();
    expect(filteredRow).toHaveAttribute('data-sensitive', 'true');
  });

  it('marks the filtered feed badge with an "internal use only" qualifier', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    expect(screen.getByText('Public — internal use only')).toBeInTheDocument();
  });

  it('does NOT add a warning to the passed feed row', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    // Locate the passed row container by walking up from its label
    const passedHeading = screen.getByText('Passed Articles');
    const passedRow = passedHeading.closest('div.flex.flex-col.gap-2');
    expect(passedRow).not.toBeNull();

    // No warning text should appear within the passed row
    expect(
      within(passedRow as HTMLElement).queryByText(
        /This feed shows borderline articles/,
      ),
    ).toBeNull();
    // No warning icon should appear within the passed row
    expect(
      (passedRow as HTMLElement).querySelectorAll('svg.lucide-triangle-alert')
        .length,
    ).toBe(0);
    // The passed row must NOT carry the sensitive-state hook
    expect(passedRow).not.toHaveAttribute('data-sensitive');
    // The plain "Public" badge (not the qualified one) belongs to the passed row
    expect(
      within(passedRow as HTMLElement).getByText('Public'),
    ).toBeInTheDocument();
  });

  it('keeps a "Public" badge on both rows (filtered with qualifier)', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    // Passed: bare "Public"
    expect(screen.getByText('Public')).toBeInTheDocument();
    // Filtered: qualified "Public — internal use only"
    expect(screen.getByText('Public — internal use only')).toBeInTheDocument();
  });

  it('updates the trailing caption to flag the filtered feed as confidential', () => {
    render(
      <RssFeedPanel
        workspaceId={WORKSPACE_ID}
        workspaceName={WORKSPACE_NAME}
      />,
    );

    expect(
      screen.getByText(
        /No\s+authentication is required, so treat the filtered feed URL as\s+confidential\./,
      ),
    ).toBeInTheDocument();
  });
});
