/**
 * NearDuplicatesFilterBar Component Tests (AC2 + AC3)
 *
 * Verifies:
 *  - Slider drag debounces 300ms before committing.
 *  - Domain Select fires onDomainChange immediately (no debounce).
 *  - aria-live region surfaces the candidate-pair count.
 *  - Slider exposes ARIA value attrs for screen readers.
 *
 * Per CLAUDE.md gotcha (`feedback_radix_select_jsdom_shims`),
 * `installRadixPointerShims()` is called in `beforeEach` for the Radix
 * Select interactions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { installRadixPointerShims } from '@/__tests__/helpers/radix-pointer-shims';
import {
  NearDuplicatesFilterBar,
  THRESHOLD_DEBOUNCE_MS,
} from '@/components/admin/content-dedup/near-duplicates/near-duplicates-filter-bar';

describe('NearDuplicatesFilterBar', () => {
  beforeEach(() => {
    installRadixPointerShims();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders threshold slider with ARIA value attrs and current numeric label', () => {
    render(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain={undefined}
        totalCount={4}
        onThresholdCommit={() => {}}
        onDomainChange={() => {}}
      />,
    );

    const slider = screen.getByTestId('near-dup-threshold-slider');
    expect(slider).toHaveAttribute('aria-valuemin', '0.85');
    expect(slider).toHaveAttribute('aria-valuemax', '0.99');
    expect(slider).toHaveAttribute('aria-valuenow', '0.95');
    expect(slider).toHaveAttribute(
      'aria-valuetext',
      '0.95 similarity threshold',
    );

    expect(screen.getByTestId('near-dup-threshold-value')).toHaveTextContent(
      '0.95',
    );
  });

  it('debounces threshold commits 300ms (AC2)', () => {
    const onThresholdCommit = vi.fn();
    render(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain={undefined}
        totalCount={0}
        onThresholdCommit={onThresholdCommit}
        onDomainChange={() => {}}
      />,
    );

    const slider = screen.getByTestId(
      'near-dup-threshold-slider',
    ) as HTMLInputElement;

    // RTL fireEvent.change works through React's synthetic event system,
    // unlike a raw element.dispatchEvent(new Event('change')) which
    // bypasses it on jsdom. Three rapid drags exercise the debounce.
    act(() => {
      fireEvent.change(slider, { target: { value: '0.92' } });
    });
    act(() => {
      fireEvent.change(slider, { target: { value: '0.90' } });
    });
    act(() => {
      fireEvent.change(slider, { target: { value: '0.88' } });
    });

    // Mid-debounce: pending value updates in the UI, but no commit yet.
    expect(screen.getByTestId('near-dup-threshold-value')).toHaveTextContent(
      '0.88',
    );
    expect(onThresholdCommit).not.toHaveBeenCalled();

    // Advance to just before debounce fires — still no commit.
    act(() => {
      vi.advanceTimersByTime(THRESHOLD_DEBOUNCE_MS - 10);
    });
    expect(onThresholdCommit).not.toHaveBeenCalled();

    // Cross the boundary — commit fires once with the final value.
    act(() => {
      vi.advanceTimersByTime(20);
    });
    expect(onThresholdCommit).toHaveBeenCalledTimes(1);
    expect(onThresholdCommit).toHaveBeenCalledWith(0.88);
  });

  it('emits onDomainChange immediately when a domain is selected (AC3)', async () => {
    vi.useRealTimers(); // userEvent v14 needs real timers
    const user = userEvent.setup();
    const onDomainChange = vi.fn();

    render(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain={undefined}
        totalCount={0}
        availableDomains={['access-control', 'tech-it']}
        onThresholdCommit={() => {}}
        onDomainChange={onDomainChange}
      />,
    );

    await user.click(
      screen.getByRole('combobox', { name: /filter by domain/i }),
    );
    await user.click(
      await screen.findByRole('option', { name: 'access-control' }),
    );

    expect(onDomainChange).toHaveBeenCalledWith('access-control');
  });

  it('emits onDomainChange(undefined) when "All domains" is selected (AC3 clear path)', async () => {
    vi.useRealTimers();
    const user = userEvent.setup();
    const onDomainChange = vi.fn();

    render(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain="access-control"
        totalCount={0}
        availableDomains={['access-control']}
        onThresholdCommit={() => {}}
        onDomainChange={onDomainChange}
      />,
    );

    await user.click(
      screen.getByRole('combobox', { name: /filter by domain/i }),
    );
    await user.click(
      await screen.findByRole('option', { name: /all domains/i }),
    );

    expect(onDomainChange).toHaveBeenCalledWith(undefined);
  });

  it('renders an aria-live count region with pluralisation', () => {
    const { rerender } = render(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain={undefined}
        totalCount={1}
        onThresholdCommit={() => {}}
        onDomainChange={() => {}}
      />,
    );

    const countNode = screen.getByTestId('near-dup-pair-count');
    expect(countNode).toHaveAttribute('aria-live', 'polite');
    expect(countNode).toHaveTextContent(/1 candidate pair/);
    expect(countNode).not.toHaveTextContent(/pairs/);

    rerender(
      <NearDuplicatesFilterBar
        threshold={0.95}
        domain={undefined}
        totalCount={4}
        onThresholdCommit={() => {}}
        onDomainChange={() => {}}
      />,
    );
    expect(screen.getByTestId('near-dup-pair-count')).toHaveTextContent(
      /4 candidate pairs/,
    );
  });
});
