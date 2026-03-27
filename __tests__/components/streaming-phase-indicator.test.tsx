/**
 * StreamingPhaseIndicator Component Tests
 *
 * Tests phase-based rendering for the bid drafting pipeline indicator,
 * including idle (null), phase labels, spinner, quality score, cost,
 * cancel button, and error state.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

import { StreamingPhaseIndicator } from '@/components/shared/streaming-phase-indicator';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreamingPhaseIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns null when phase is idle', () => {
    const { container } = render(<StreamingPhaseIndicator phase="idle" />);

    expect(container.innerHTML).toBe('');
  });

  it('shows correct label for each active phase', () => {
    const phases = [
      { phase: 'analysing' as const, label: 'Analysing question...' },
      { phase: 'drafting' as const, label: 'Drafting response...' },
      { phase: 'quality' as const, label: 'Running quality check...' },
      { phase: 'saving' as const, label: 'Saving to database...' },
      { phase: 'done' as const, label: 'Complete' },
      { phase: 'error' as const, label: 'Error' },
    ];

    for (const { phase, label } of phases) {
      const { unmount } = render(<StreamingPhaseIndicator phase={phase} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('shows role="status" for accessible live region', () => {
    render(<StreamingPhaseIndicator phase="drafting" />);

    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('shows quality score when phase is done', () => {
    render(
      <StreamingPhaseIndicator phase="done" qualityScore={0.92} />,
    );

    expect(screen.getByText('Quality: 92%')).toBeInTheDocument();
  });

  it('shows cost when phase is done', () => {
    render(
      <StreamingPhaseIndicator phase="done" totalCost={0.0123} />,
    );

    expect(screen.getByText('Cost: £0.0123')).toBeInTheDocument();
  });

  it('shows cancel button for active phases and calls onCancel', async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();

    render(
      <StreamingPhaseIndicator phase="drafting" onCancel={onCancel} />,
    );

    const cancelBtn = screen.getByRole('button', { name: /cancel/i });
    expect(cancelBtn).toBeInTheDocument();

    await user.click(cancelBtn);
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('shows error message when phase is error', () => {
    render(
      <StreamingPhaseIndicator
        phase="error"
        error="Network timeout occurred"
      />,
    );

    expect(screen.getByText('Network timeout occurred')).toBeInTheDocument();
  });
});
