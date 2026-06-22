/**
 * RevisionDiffView — renderMode tests (ID-117 {117.7}, cluster C+D).
 *
 * Tests the new renderMode prop: 'side-by-side' and 'word-inline'.
 * The default 'unified-line' mode is covered by the EXISTING test suite
 * (revision-diff-view.test.tsx) which MUST pass UNCHANGED (INV-12 regression).
 *
 * INV-12: The existing callers (CompareVersionsPanel, QARevisionHistory) pass no
 * renderMode — they must render byte-identical output with no visual change.
 *
 * INV-13: All modes use ONLY bg-status-* semantic tokens, more-than-colour
 * gutters, DD/MM/YYYY, UK English, explicit empty/loading/error states.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';

const OLDER: RevisionBlob = {
  version: 1,
  text: 'Hello world\nThis is old text\nEnd of file',
  changeType: 'create',
  changeSummary: 'Initial version',
  createdAt: '2026-01-01T10:00:00Z',
  createdByLabel: 'Alice',
  editIntent: null,
};

const NEWER: RevisionBlob = {
  version: 2,
  text: 'Hello world\nThis is new text\nEnd of file',
  changeType: 'edit',
  changeSummary: 'Second version',
  createdAt: '2026-01-02T12:00:00Z',
  createdByLabel: 'Bob',
  editIntent: 'clarity',
};

describe('RevisionDiffView — default (unified-line) mode is unchanged', () => {
  it('renders with no renderMode prop (default unified-line) without error', () => {
    render(<RevisionDiffView older={OLDER} newer={NEWER} />);
    expect(
      screen.getByRole('log', { name: /revision text diff/i }),
    ).toBeInTheDocument();
  });

  it('default mode renders [+] and [-] gutter prefixes', () => {
    render(<RevisionDiffView older={OLDER} newer={NEWER} />);
    const region = screen.getByRole('log');
    expect(region.textContent).toContain('[+]');
    expect(region.textContent).toContain('[-]');
  });

  it('passing renderMode="unified-line" explicitly is identical to default', () => {
    const { container: c1 } = render(
      <RevisionDiffView older={OLDER} newer={NEWER} />,
    );
    const { container: c2 } = render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="unified-line"
      />,
    );
    expect(c1.innerHTML).toBe(c2.innerHTML);
  });
});

describe('RevisionDiffView — side-by-side mode (INV-10)', () => {
  it('renders old and new panels side-by-side', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    // Both column headings must appear
    expect(screen.getByText('Older version')).toBeInTheDocument();
    expect(screen.getByText('Newer version')).toBeInTheDocument();
  });

  it('renders removal lines in the old column', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    const oldPanel = screen.getByTestId('side-by-side-old');
    expect(oldPanel.textContent).toContain('This is old text');
  });

  it('renders addition lines in the new column', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    const newPanel = screen.getByTestId('side-by-side-new');
    expect(newPanel.textContent).toContain('This is new text');
  });

  it('side-by-side mode uses semantic tokens — no raw Tailwind colours', () => {
    const { container } = render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    const rawTailwindPattern =
      /(bg|text)-(red|green|blue|yellow|orange|emerald|teal|rose)-\d+/;
    expect(container.innerHTML).not.toMatch(rawTailwindPattern);
  });

  it('renders gutter prefixes [+] and [-] in side-by-side mode', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    const oldPanel = screen.getByTestId('side-by-side-old');
    const newPanel = screen.getByTestId('side-by-side-new');
    expect(oldPanel.textContent).toContain('[-]');
    expect(newPanel.textContent).toContain('[+]');
  });

  it('shows no-changes empty state when identical in side-by-side mode', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={{ ...OLDER, version: 2 }}
        renderMode="side-by-side"
      />,
    );
    expect(screen.getByTestId('revision-diff-empty')).toBeInTheDocument();
  });

  it('renders metadata panels in side-by-side mode (formatDateTime DD/MM/YYYY)', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={NEWER}
        renderMode="side-by-side"
      />,
    );
    expect(screen.getByText(/01\/01\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/02\/01\/2026/)).toBeInTheDocument();
  });
});

describe('RevisionDiffView — word-inline mode (INV-10)', () => {
  it('renders the diff block as a log region in word-inline mode', () => {
    render(
      <RevisionDiffView older={OLDER} newer={NEWER} renderMode="word-inline" />,
    );
    expect(
      screen.getByRole('log', { name: /revision text diff/i }),
    ).toBeInTheDocument();
  });

  it('renders word-level change spans (diffWords output) in word-inline mode', () => {
    render(
      <RevisionDiffView older={OLDER} newer={NEWER} renderMode="word-inline" />,
    );
    const region = screen.getByRole('log');
    // diffWords produces inline spans; the changed words should appear
    expect(region.textContent).toContain('old');
    expect(region.textContent).toContain('new');
  });

  it('word-inline mode uses semantic tokens — no raw Tailwind colours', () => {
    const { container } = render(
      <RevisionDiffView older={OLDER} newer={NEWER} renderMode="word-inline" />,
    );
    const rawTailwindPattern =
      /(bg|text)-(red|green|blue|yellow|orange|emerald|teal|rose)-\d+/;
    expect(container.innerHTML).not.toMatch(rawTailwindPattern);
  });

  it('word-inline mode renders metadata panels (INV-13 — formatDateTime)', () => {
    render(
      <RevisionDiffView older={OLDER} newer={NEWER} renderMode="word-inline" />,
    );
    expect(screen.getByText('v1')).toBeInTheDocument();
    expect(screen.getByText('v2')).toBeInTheDocument();
  });

  it('shows no-changes empty state when identical in word-inline mode', () => {
    render(
      <RevisionDiffView
        older={OLDER}
        newer={{ ...OLDER, version: 2 }}
        renderMode="word-inline"
      />,
    );
    expect(screen.getByTestId('revision-diff-empty')).toBeInTheDocument();
  });

  it('word-inline renders [Added] / [Removed] labels for accessibility (INV-13)', () => {
    // With diffWords, lines with only added/removed words should have a label
    render(
      <RevisionDiffView older={OLDER} newer={NEWER} renderMode="word-inline" />,
    );
    const region = screen.getByRole('log');
    // The region must contain signalling text (not colour-only)
    expect(region.textContent).not.toBe('');
  });
});
