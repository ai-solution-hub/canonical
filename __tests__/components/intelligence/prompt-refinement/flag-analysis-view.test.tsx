/**
 * FlagAnalysisView — component tests.
 *
 * Display-only component — tests verify the visible structure:
 * summary, optional truncation banner, pattern clusters, ordered
 * recommendations, and the non-colour text markers on each change
 * type.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';

import { FlagAnalysisView } from '@/components/intelligence/prompt-refinement/flag-analysis-view';
import { makeFlagAnalysisResult } from './fixtures';

describe('FlagAnalysisView', () => {
  it('renders the summary card with the analysed flag count', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    expect(screen.getByText(result.summary)).toBeInTheDocument();
    expect(screen.getByText(/Analysed 5 flags\./)).toBeInTheDocument();
  });

  it('does not render a truncation banner when truncated is false', () => {
    const result = makeFlagAnalysisResult({ truncated: false });
    render(<FlagAnalysisView result={result} />);
    expect(
      screen.queryByText(/Only the most recent/i),
    ).not.toBeInTheDocument();
  });

  it('renders a truncation banner when truncated is true', () => {
    const result = makeFlagAnalysisResult({
      truncated: true,
      analysedFlagCount: 50,
    });
    render(<FlagAnalysisView result={result} />);
    expect(
      screen.getByText(/Only the most recent 50 flags were analysed/i),
    ).toBeInTheDocument();
  });

  it('renders false positive and false negative cluster headings', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    expect(screen.getByText('False positive patterns')).toBeInTheDocument();
    expect(screen.getByText('False negative patterns')).toBeInTheDocument();
    // Pattern names render inside <summary>.
    expect(screen.getByText(/Generic DfE policy updates/)).toBeInTheDocument();
    expect(
      screen.getByText(/MAT merger and finance stories/),
    ).toBeInTheDocument();
  });

  it('renders every recommendation change-type badge with a text marker', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    expect(screen.getByText('[+ Add]')).toBeInTheDocument();
    expect(screen.getByText('[- Remove]')).toBeInTheDocument();
    expect(screen.getByText(/\[↻ Reword\]/)).toBeInTheDocument();
  });

  it('orders recommendations by affectedFlags descending', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    // Fixture: remove=3, add=2, reword=1 — so order of ranks is #1 #2 #3.
    const rank1 = screen.getByText('#1').closest('li');
    expect(rank1).not.toBeNull();
    expect(rank1!.textContent).toContain('[- Remove]');
    const rank2 = screen.getByText('#2').closest('li');
    expect(rank2).not.toBeNull();
    expect(rank2!.textContent).toContain('[+ Add]');
    const rank3 = screen.getByText('#3').closest('li');
    expect(rank3).not.toBeNull();
    expect(rank3!.textContent).toContain('[↻ Reword]');
  });

  it('renders an empty-state message when no recommendations are returned', () => {
    const result = makeFlagAnalysisResult({ recommendations: [] });
    render(<FlagAnalysisView result={result} />);
    expect(
      screen.getByText(/No recommended changes/i),
    ).toBeInTheDocument();
  });

  it('renders confidence notes at the bottom', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    expect(screen.getByText(/High confidence on the false positive/i))
      .toBeInTheDocument();
  });

  it('labels the summary region for accessibility', () => {
    const result = makeFlagAnalysisResult();
    render(<FlagAnalysisView result={result} />);
    expect(
      screen.getByRole('region', { name: /analysis summary/i }),
    ).toBeInTheDocument();
  });
});
