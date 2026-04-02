import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { DraftRecoveryDialog } from '@/components/bid/draft-recovery-dialog';

describe('DraftRecoveryDialog', () => {
  const onRestore = vi.fn();
  const onDiscard = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function renderDialog(
    overrides: Partial<Parameters<typeof DraftRecoveryDialog>[0]> = {},
  ) {
    const props = {
      hasDraft: true,
      lastSavedAt: new Date('2026-03-26T10:30:00.000Z'),
      onRestore,
      onDiscard,
      ...overrides,
    };
    return render(<DraftRecoveryDialog {...props} />);
  }

  // ----------------------------------------------------------
  // Visibility
  // ----------------------------------------------------------

  it('renders the banner when hasDraft is true', () => {
    renderDialog();

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Recovered unsaved draft/)).toBeInTheDocument();
  });

  it('does not render when hasDraft is false', () => {
    renderDialog({ hasDraft: false });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Timestamp display
  // ----------------------------------------------------------

  it('displays the last saved timestamp', () => {
    renderDialog({
      lastSavedAt: new Date('2026-03-26T10:30:00.000Z'),
    });

    // Should contain a formatted time reference
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('10:30');
  });

  it('renders gracefully when lastSavedAt is null', () => {
    renderDialog({ lastSavedAt: null });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Recovered unsaved draft/)).toBeInTheDocument();
  });

  // ----------------------------------------------------------
  // Restore action
  // ----------------------------------------------------------

  it('calls onRestore when Restore button is clicked', () => {
    renderDialog();

    const restoreButton = screen.getByRole('button', { name: /Restore/ });
    fireEvent.click(restoreButton);

    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------
  // Discard action
  // ----------------------------------------------------------

  it('calls onDiscard when Discard button is clicked', () => {
    renderDialog();

    const discardButton = screen.getByRole('button', { name: /Discard/i });
    fireEvent.click(discardButton);

    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------
  // Auto-dismiss
  // ----------------------------------------------------------

  it('auto-dismisses after 30 seconds by calling onDiscard', () => {
    renderDialog();

    // Before 30 seconds
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(onDiscard).not.toHaveBeenCalled();

    // After 30 seconds
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  it('does not auto-dismiss when hasDraft is false', () => {
    renderDialog({ hasDraft: false });

    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    expect(onDiscard).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------
  // Clears auto-dismiss on manual action
  // ----------------------------------------------------------

  it('clears auto-dismiss timer when Restore is clicked', () => {
    renderDialog();

    // Click restore before the auto-dismiss fires
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }));

    // Advance past auto-dismiss time
    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    // onDiscard should not have been called by auto-dismiss
    expect(onDiscard).not.toHaveBeenCalled();
    expect(onRestore).toHaveBeenCalledTimes(1);
  });

  it('clears auto-dismiss timer when Discard is clicked', () => {
    renderDialog();

    fireEvent.click(screen.getByRole('button', { name: /Discard/i }));

    // Advance past auto-dismiss time
    act(() => {
      vi.advanceTimersByTime(35_000);
    });

    // Only the manual discard, not the auto-dismiss
    expect(onDiscard).toHaveBeenCalledTimes(1);
  });

  // ----------------------------------------------------------
  // Accessibility
  // ----------------------------------------------------------

  it('has role="alert" for screen reader announcement', () => {
    renderDialog();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('has aria-live="polite" for non-intrusive announcement', () => {
    renderDialog();
    const alert = screen.getByRole('alert');
    expect(alert).toHaveAttribute('aria-live', 'polite');
  });
});
