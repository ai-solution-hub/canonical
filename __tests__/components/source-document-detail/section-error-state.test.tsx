/**
 * SectionErrorState — the single shared BI-30 per-section error/retry chrome
 * (id-135 {135.18} convergence pass, session steer). Previously
 * `DocumentVersionList` / `DocumentCitationsPanel` / `DerivedPairsList` each
 * hand-rolled a near-identical (or, for `DerivedPairsList`, a visually
 * divergent) localised error state. This component is the ONE markup
 * implementation all three now render, parameterised by caller-supplied
 * copy so each section keeps its own wording.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { SectionErrorState } from '@/components/source-document-detail/section-error-state';

describe('SectionErrorState', () => {
  it('renders as an alert region carrying the caller-supplied heading and message', () => {
    render(
      <SectionErrorState
        heading="Couldn't load version history"
        message="Something went wrong while loading version history. This is usually temporary."
        onRetry={() => {}}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(
      screen.getByText("Couldn't load version history"),
    ).toBeInTheDocument();
    expect(screen.getByText(/this is usually temporary/i)).toBeInTheDocument();
  });

  it('carries a decorative icon marked aria-hidden (never the only failure signal)', () => {
    render(
      <SectionErrorState
        heading="Couldn't load citations"
        message="Something went wrong while loading citations."
        onRetry={() => {}}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert.querySelector('svg[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('defaults the retry button label to "Try again"', () => {
    render(
      <SectionErrorState
        heading="Couldn't load citations"
        message="Something went wrong while loading citations."
        onRetry={() => {}}
      />,
    );

    expect(
      screen.getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('renders a caller-supplied retry label instead of the default, when given one', () => {
    render(
      <SectionErrorState
        heading="Couldn't load the derived answers"
        message="Something went wrong."
        retryLabel="Retry"
        onRetry={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Try again' }),
    ).not.toBeInTheDocument();
  });

  it('invokes the caller-supplied onRetry exactly once per click', () => {
    const onRetry = vi.fn();
    render(
      <SectionErrorState
        heading="Couldn't load version history"
        message="Something went wrong."
        onRetry={onRetry}
      />,
    );

    screen.getByRole('button', { name: 'Try again' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
