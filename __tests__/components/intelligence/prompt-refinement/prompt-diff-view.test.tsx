/**
 * PromptDiffView — component tests.
 *
 * Verifies the LCS-based unified diff handles all edge cases and that
 * every colour-coded row carries a non-colour text marker so
 * accessibility is not dependent on hue alone.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { PromptDiffView } from '@/components/intelligence/prompt-refinement/prompt-diff-view';

describe('PromptDiffView', () => {
  it('renders "no differences" message when current equals proposed', () => {
    const text = 'Line A\nLine B\nLine C';
    render(<PromptDiffView currentText={text} proposedText={text} />);
    expect(
      screen.getByText(/No differences between the active prompt/i),
    ).toBeInTheDocument();
  });

  it('renders all proposed lines as additions when current is empty', () => {
    render(
      <PromptDiffView
        currentText=""
        proposedText={'New line one\nNew line two'}
      />,
    );
    expect(screen.getByText(/\[Added\] New line one/)).toBeInTheDocument();
    expect(screen.getByText(/\[Added\] New line two/)).toBeInTheDocument();
  });

  it('renders all current lines as removals when proposed is empty', () => {
    render(
      <PromptDiffView
        currentText={'Old line one\nOld line two'}
        proposedText=""
      />,
    );
    expect(screen.getByText(/\[Removed\] Old line one/)).toBeInTheDocument();
    expect(screen.getByText(/\[Removed\] Old line two/)).toBeInTheDocument();
  });

  it('mixes context, removals and additions for a partial rewrite', () => {
    const current = 'Line A\nLine B\nLine C';
    const proposed = 'Line A\nLine B modified\nLine C';
    render(<PromptDiffView currentText={current} proposedText={proposed} />);
    // Line A + Line C are context (unchanged).
    expect(screen.getAllByText('Line A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Line C').length).toBeGreaterThan(0);
    // Line B is removed, Line B modified is added.
    expect(screen.getByText(/\[Removed\] Line B/)).toBeInTheDocument();
    expect(screen.getByText(/\[Added\] Line B modified/)).toBeInTheDocument();
  });

  it('exposes the diff block as an accessible log region', () => {
    render(<PromptDiffView currentText={'Foo'} proposedText={'Bar'} />);
    const region = screen.getByRole('log', { name: /prompt text diff/i });
    expect(region).toBeInTheDocument();
  });

  it('prefixes added and removed lines with [+] and [-] markers', () => {
    render(<PromptDiffView currentText={'Old'} proposedText={'New'} />);
    // The prefix is rendered aria-hidden but must still be in the DOM.
    const region = screen.getByRole('log');
    expect(region.textContent).toContain('[+]');
    expect(region.textContent).toContain('[-]');
  });
});
