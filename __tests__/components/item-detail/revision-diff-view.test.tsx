/**
 * RevisionDiffView — component tests (ID-59 {59.12}).
 *
 * v1 MINIMAL user-edit Diff-UI over content_history / q_a_pair_history.
 * Verifies (PC-14/15/16/17, INV-14..INV-17):
 *  - old↔new text diff is rendered for two arbitrary revision blobs;
 *  - additions/removals are distinguished by MORE than colour (+/- gutters,
 *    [Added]/[Removed] labels) per WCAG 2.1 AA;
 *  - each revision's metadata is surfaced — version, change type,
 *    change summary, created date (DD/MM/YYYY), author, AND edit_intent;
 *  - identical revisions render an explicit "no changes" state, never blank.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import {
  RevisionDiffView,
  type RevisionBlob,
} from '@/components/item-detail/revision-diff-view';

const OLD_REVISION: RevisionBlob = {
  version: 2,
  text: 'Line A\nLine B\nLine C',
  changeType: 'edit',
  changeSummary: 'First pass',
  createdAt: '2026-04-08T10:00:00Z',
  createdByLabel: 'Alice',
  editIntent: 'tighten wording',
};

const NEW_REVISION: RevisionBlob = {
  version: 3,
  text: 'Line A\nLine B modified\nLine C',
  changeType: 'edit',
  changeSummary: 'Second pass',
  createdAt: '2026-04-09T11:30:00Z',
  createdByLabel: 'Bob',
  editIntent: 'correct a fact',
};

describe('RevisionDiffView', () => {
  it('renders the changed text as a removal followed by an addition', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText(/\[Removed\] Line B/)).toBeInTheDocument();
    expect(screen.getByText(/\[Added\] Line B modified/)).toBeInTheDocument();
  });

  it('keeps unchanged lines as context', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getAllByText('Line A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Line C').length).toBeGreaterThan(0);
  });

  it('marks additions and removals with non-colour +/- gutters', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    const region = screen.getByRole('log', { name: /revision text diff/i });
    expect(region.textContent).toContain('[+]');
    expect(region.textContent).toContain('[-]');
  });

  it('exposes the diff block as an accessible log region', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(
      screen.getByRole('log', { name: /revision text diff/i }),
    ).toBeInTheDocument();
  });

  it('surfaces both versions in metadata (v2 and v3)', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });

  it('surfaces the change summary for each revision', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText('First pass')).toBeInTheDocument();
    expect(screen.getByText('Second pass')).toBeInTheDocument();
  });

  it('surfaces the author label for each revision', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
    expect(screen.getByText(/Bob/)).toBeInTheDocument();
  });

  it('surfaces the new edit_intent field for each revision', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText(/tighten wording/)).toBeInTheDocument();
    expect(screen.getByText(/correct a fact/)).toBeInTheDocument();
  });

  it('formats created dates as DD/MM/YYYY (UK English)', () => {
    render(<RevisionDiffView older={OLD_REVISION} newer={NEW_REVISION} />);
    expect(screen.getByText(/08\/04\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/09\/04\/2026/)).toBeInTheDocument();
  });

  it('omits the edit-intent row when edit_intent is null', () => {
    const older = { ...OLD_REVISION, editIntent: null };
    const newer = { ...NEW_REVISION, editIntent: null };
    render(<RevisionDiffView older={older} newer={newer} />);
    expect(screen.queryByText(/tighten wording/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Edit intent/i)).not.toBeInTheDocument();
  });

  it('shows an explicit no-changes state when both revisions are identical', () => {
    const identical: RevisionBlob = {
      ...NEW_REVISION,
      text: OLD_REVISION.text,
    };
    render(<RevisionDiffView older={OLD_REVISION} newer={identical} />);
    expect(
      screen.getByText(/no changes between these versions/i),
    ).toBeInTheDocument();
    // Metadata panels still render so the state is never blank.
    expect(screen.getByText('v2')).toBeInTheDocument();
    expect(screen.getByText('v3')).toBeInTheDocument();
  });
});
