/**
 * ReviewActionBar Component Tests
 *
 * Tests the ReviewActionBar component — the sticky toolbar for the review page.
 * Covers all action buttons (verify, flag, skip, back, exit), disabled/loading
 * state, and optional edit/help buttons.
 */
import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Import component (no external dependencies that need mocking)
import { ReviewActionBar } from '@/components/review/review-action-bar';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeProps(overrides: Partial<Parameters<typeof ReviewActionBar>[0]> = {}) {
  return {
    onVerify: vi.fn(),
    onFlag: vi.fn(),
    onSkip: vi.fn(),
    onBack: vi.fn(),
    onExit: vi.fn(),
    isActioning: false,
    canGoBack: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ReviewActionBar', () => {
  it('renders all core action buttons', () => {
    render(<ReviewActionBar {...makeProps()} />);

    expect(screen.getByRole('button', { name: /Verify/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Flag/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Next/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Go back/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Exit/i })).toBeInTheDocument();
  });

  it('renders toolbar role with correct label', () => {
    render(<ReviewActionBar {...makeProps()} />);
    expect(screen.getByRole('toolbar', { name: 'Review actions' })).toBeInTheDocument();
  });

  it('calls onVerify when verify button clicked', async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn();
    render(<ReviewActionBar {...makeProps({ onVerify })} />);

    await user.click(screen.getByRole('button', { name: /Verify/i }));
    expect(onVerify).toHaveBeenCalledOnce();
  });

  it('calls onFlag when flag button clicked', async () => {
    const user = userEvent.setup();
    const onFlag = vi.fn();
    render(<ReviewActionBar {...makeProps({ onFlag })} />);

    await user.click(screen.getByRole('button', { name: /Flag/i }));
    expect(onFlag).toHaveBeenCalledOnce();
  });

  it('calls onSkip when next button clicked', async () => {
    const user = userEvent.setup();
    const onSkip = vi.fn();
    render(<ReviewActionBar {...makeProps({ onSkip })} />);

    await user.click(screen.getByRole('button', { name: /Next/i }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('calls onBack when back button clicked', async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ReviewActionBar {...makeProps({ onBack })} />);

    await user.click(screen.getByRole('button', { name: /Go back/i }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('calls onExit when exit button clicked', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<ReviewActionBar {...makeProps({ onExit })} />);

    await user.click(screen.getByRole('button', { name: /Exit/i }));
    expect(onExit).toHaveBeenCalledOnce();
  });

  it('disables verify, flag, skip, and back buttons when isActioning is true', () => {
    render(<ReviewActionBar {...makeProps({ isActioning: true })} />);

    expect(screen.getByRole('button', { name: /Verify/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Flag/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Next/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Go back/i })).toBeDisabled();
  });

  it('does not call action handlers when isActioning is true', async () => {
    const user = userEvent.setup();
    const onVerify = vi.fn();
    const onFlag = vi.fn();
    render(<ReviewActionBar {...makeProps({ onVerify, onFlag, isActioning: true })} />);

    // Buttons are disabled so clicks should not fire
    await user.click(screen.getByRole('button', { name: /Verify/i }));
    await user.click(screen.getByRole('button', { name: /Flag/i }));
    expect(onVerify).not.toHaveBeenCalled();
    expect(onFlag).not.toHaveBeenCalled();
  });

  it('disables back button when canGoBack is false', () => {
    render(<ReviewActionBar {...makeProps({ canGoBack: false })} />);
    expect(screen.getByRole('button', { name: /Go back/i })).toBeDisabled();
  });

  it('exit button remains enabled when isActioning is true', () => {
    render(<ReviewActionBar {...makeProps({ isActioning: true })} />);
    // Exit is never disabled by isActioning — users should always be able to leave
    expect(screen.getByRole('button', { name: /Exit/i })).not.toBeDisabled();
  });

  // ── Optional buttons ──

  it('renders edit button when onEdit is provided', () => {
    render(<ReviewActionBar {...makeProps({ onEdit: vi.fn() })} />);
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument();
  });

  it('does not render edit button when onEdit is not provided', () => {
    render(<ReviewActionBar {...makeProps()} />);
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument();
  });

  it('calls onEdit when edit button clicked', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<ReviewActionBar {...makeProps({ onEdit })} />);

    await user.click(screen.getByRole('button', { name: /Edit/i }));
    expect(onEdit).toHaveBeenCalledOnce();
  });

  it('renders help button when onShowHelp is provided', () => {
    render(<ReviewActionBar {...makeProps({ onShowHelp: vi.fn() })} />);
    expect(screen.getByRole('button', { name: /Show keyboard shortcuts/i })).toBeInTheDocument();
  });

  it('does not render help button when onShowHelp is not provided', () => {
    render(<ReviewActionBar {...makeProps()} />);
    expect(screen.queryByRole('button', { name: /Show keyboard shortcuts/i })).not.toBeInTheDocument();
  });
});
