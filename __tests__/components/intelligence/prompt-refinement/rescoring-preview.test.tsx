/**
 * RescoringPreview — component tests.
 *
 * Verifies the bucket grouping (newly-filtered / newly-passed / unchanged),
 * the empty-sample edge case, the warnings banner, and the collapsible
 * unchanged section.
 */
import { describe, it, expect } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

import { RescoringPreview } from '@/components/intelligence/prompt-refinement/rescoring-preview';
import {
  makeRescoringPreviewResponse,
  makeRescoringPreviewResult,
} from './fixtures';

describe('RescoringPreview', () => {
  it('renders the empty state when samples is zero', () => {
    const result = makeRescoringPreviewResponse({
      samples: 0,
      results: [],
      mean_delta: 0,
      improved: 0,
      regressed: 0,
    });
    render(<RescoringPreview result={result} />);
    expect(
      screen.getByText(/No articles available for preview/i),
    ).toBeInTheDocument();
  });

  it('renders bucket counts in the aggregate header', () => {
    const result = makeRescoringPreviewResponse();
    render(<RescoringPreview result={result} />);
    // Fixture: 1 newly-filtered (0.82->0.45), 1 newly-passed (0.42->0.71),
    // 3 unchanged (stay on the same side of 0.5).
    expect(
      screen.getByText(/1 newly filtered, 1 newly passed, 3 unchanged/),
    ).toBeInTheDocument();
  });

  it('shows newly filtered articles in the warning-coloured section', () => {
    const result = makeRescoringPreviewResponse();
    render(<RescoringPreview result={result} />);
    expect(screen.getByText(/Newly filtered \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('KCSIE update published')).toBeInTheDocument();
    expect(screen.getByText(/FILTERED/)).toBeInTheDocument();
  });

  it('shows newly passed articles with the PASSED suffix', () => {
    const result = makeRescoringPreviewResponse();
    render(<RescoringPreview result={result} />);
    expect(screen.getByText(/Newly passed \(1\)/)).toBeInTheDocument();
    expect(screen.getByText('Large MAT merger announced')).toBeInTheDocument();
    expect(screen.getByText(/PASSED/)).toBeInTheDocument();
  });

  it('collapses the unchanged section by default and toggles via the button', async () => {
    const user = userEvent.setup();
    const result = makeRescoringPreviewResponse();
    render(<RescoringPreview result={result} />);

    // Unchanged row should not be visible initially.
    expect(
      screen.queryByText('DfE consultation response'),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole('button', { name: /Show unchanged/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await user.click(toggle);

    expect(screen.getByText('DfE consultation response')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders a warnings banner when warnings are present', () => {
    const result = makeRescoringPreviewResponse({
      warnings: ['Article 42 could not be scored: API timeout'],
    });
    render(<RescoringPreview result={result} />);
    expect(
      screen.getByText(
        /Partial preview — some articles could not be re-scored/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Article 42 could not be scored: API timeout/),
    ).toBeInTheDocument();
  });

  it('formats the average delta with a leading sign', () => {
    const positive = makeRescoringPreviewResponse({ mean_delta: 0.04 });
    const { rerender } = render(<RescoringPreview result={positive} />);
    expect(
      screen.getByText(/Average score change: \+0\.04/),
    ).toBeInTheDocument();

    const negative = makeRescoringPreviewResponse({ mean_delta: -0.12 });
    rerender(<RescoringPreview result={negative} />);
    expect(
      screen.getByText(/Average score change: -0\.12/),
    ).toBeInTheDocument();
  });

  it('handles all-unchanged preview without warnings', () => {
    const result = makeRescoringPreviewResponse({
      samples: 2,
      mean_delta: 0,
      improved: 0,
      regressed: 0,
      results: [
        makeRescoringPreviewResult({
          article_id: '550e8400-e29b-41d4-a716-446655440020',
          title: 'A',
          existing_score: 0.2,
          candidate_score: 0.22,
          score_delta: 0.02,
        }),
        makeRescoringPreviewResult({
          article_id: '550e8400-e29b-41d4-a716-446655440021',
          title: 'B',
          existing_score: 0.8,
          candidate_score: 0.81,
          score_delta: 0.01,
        }),
      ],
    });
    render(<RescoringPreview result={result} />);
    expect(
      screen.getByText(/0 newly filtered, 0 newly passed, 2 unchanged/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No articles would lose coverage/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No articles would gain coverage/),
    ).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Safety guard — catastrophic prompt change (spec §8)
  // -------------------------------------------------------------------------
  describe('catastrophic-change warning', () => {
    it('does not render the warning when proposed and current prompts are the same length', () => {
      const result = makeRescoringPreviewResponse();
      const current = 'a'.repeat(200);
      const proposed = 'b'.repeat(200);
      render(
        <RescoringPreview
          result={result}
          currentPromptText={current}
          proposedPromptText={proposed}
        />,
      );
      expect(
        screen.queryByTestId('catastrophic-change-warning'),
      ).not.toBeInTheDocument();
    });

    it('does not render the warning when proposed prompt is 60% of the current length (above threshold)', () => {
      const result = makeRescoringPreviewResponse();
      const current = 'a'.repeat(200);
      const proposed = 'b'.repeat(120);
      render(
        <RescoringPreview
          result={result}
          currentPromptText={current}
          proposedPromptText={proposed}
        />,
      );
      expect(
        screen.queryByTestId('catastrophic-change-warning'),
      ).not.toBeInTheDocument();
    });

    it('renders the warning with character counts when proposed is 40% of current length', () => {
      const result = makeRescoringPreviewResponse();
      const current = 'a'.repeat(200);
      const proposed = 'b'.repeat(80);
      render(
        <RescoringPreview
          result={result}
          currentPromptText={current}
          proposedPromptText={proposed}
        />,
      );
      const warning = screen.getByTestId('catastrophic-change-warning');
      expect(warning).toBeInTheDocument();
      expect(warning).toHaveTextContent(/80 characters vs 200 characters/);
      expect(warning).toHaveTextContent(
        /significantly shorter than the current version/,
      );
      expect(warning).toHaveTextContent(/Review the changes carefully/);
      expect(warning).toHaveAttribute('role', 'status');
    });

    it('does not render the warning when current or proposed prompt text is absent', () => {
      const result = makeRescoringPreviewResponse();
      render(<RescoringPreview result={result} />);
      expect(
        screen.queryByTestId('catastrophic-change-warning'),
      ).not.toBeInTheDocument();
    });
  });

  it('is wrapped in a region with an accessible label', () => {
    const result = makeRescoringPreviewResponse();
    render(<RescoringPreview result={result} />);
    expect(
      screen.getByRole('region', { name: /Re-scoring preview/i }),
    ).toBeInTheDocument();
  });
});
