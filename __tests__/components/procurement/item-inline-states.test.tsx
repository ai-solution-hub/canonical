/**
 * ItemInlineStates — the item-page BI-19 empty/loading/error states
 * (ID-145 {145.43}), distinct from the per-viewer §B6 states.
 *
 * Behaviour-first: every variant renders inline (never a blank pane), and
 * state is conveyed by text/icon, never colour alone (WCAG 2.1 AA).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

import {
  ItemInlineStates,
  type ItemInlineStateVariant,
} from '@/components/procurement/item-inline-states';

const ALL_VARIANTS: ItemInlineStateVariant[] = ['empty', 'loading', 'error'];

describe('ItemInlineStates', () => {
  it('renders every variant without crashing (never a blank pane)', () => {
    for (const variant of ALL_VARIANTS) {
      const { unmount } = render(<ItemInlineStates variant={variant} />);
      expect(document.body.textContent?.trim()).not.toBe('');
      unmount();
    }
  });

  // ---- loading ----

  describe('variant="loading"', () => {
    it('renders an accessible, non-colour-only loading indicator', () => {
      render(<ItemInlineStates variant="loading" />);
      expect(
        screen.getByTestId('item-inline-states-loading'),
      ).toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
      expect(screen.getByText('Loading…')).toBeInTheDocument();
    });
  });

  // ---- empty ----

  describe('variant="empty"', () => {
    it('renders an empty card with a default message', () => {
      render(<ItemInlineStates variant="empty" />);
      const empty = screen.getByTestId('item-inline-states-empty');
      expect(empty).toBeInTheDocument();
      expect(empty).toHaveTextContent('Nothing to show here yet.');
    });

    it('renders a caller-supplied message in place of the default', () => {
      render(
        <ItemInlineStates
          variant="empty"
          message="Workflow state is not available for this item."
        />,
      );
      expect(
        screen.getByText('Workflow state is not available for this item.'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Nothing to show here yet.'),
      ).not.toBeInTheDocument();
    });
  });

  // ---- error (soft-error + retry) ----

  describe('variant="error"', () => {
    let originalLocation: Location;

    beforeEach(() => {
      originalLocation = window.location;
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: { ...originalLocation, reload: vi.fn() },
      });
    });

    afterEach(() => {
      Object.defineProperty(window, 'location', {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    });

    it('renders a non-technical, non-blank error surface', () => {
      render(<ItemInlineStates variant="error" />);
      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByText('Procurement not found')).toBeInTheDocument();
      expect(
        screen.getByText(
          'This item could not be loaded. It may have been deleted, or you may not have access.',
        ),
      ).toBeInTheDocument();
    });

    it('renders a caller-supplied message in place of the default', () => {
      render(
        <ItemInlineStates variant="error" message="Custom failure copy." />,
      );
      expect(screen.getByText('Custom failure copy.')).toBeInTheDocument();
    });

    it('links back to the procurement list', () => {
      render(<ItemInlineStates variant="error" />);
      expect(
        screen.getByRole('link', { name: 'Return to Procurement' }),
      ).toHaveAttribute('href', '/procurement');
    });

    it('calls a caller-supplied onRetry when "Try again" is clicked', () => {
      const onRetry = vi.fn();
      render(<ItemInlineStates variant="error" onRetry={onRetry} />);

      screen.getByRole('button', { name: 'Try again' }).click();

      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(window.location.reload).not.toHaveBeenCalled();
    });

    it('falls back to a full reload when no onRetry is supplied', () => {
      render(<ItemInlineStates variant="error" />);

      screen.getByRole('button', { name: 'Try again' }).click();

      expect(window.location.reload).toHaveBeenCalledTimes(1);
    });
  });
});
