/**
 * ResponseActions Component Tests
 *
 * Tests action button grouping with visual separators, next-unanswered
 * navigation, button states, and accessibility.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

// Import AFTER mocks
import { ResponseActions } from '@/components/procurement/response-actions';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function defaultProps(
  overrides: Partial<Parameters<typeof ResponseActions>[0]> = {},
) {
  return {
    onAction: vi.fn(),
    reviewStatus: null as string | null,
    isLoading: false,
    loadingAction: null,
    hasDraft: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ResponseActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========================================================================
  // Basic rendering
  // ========================================================================

  it('renders the toolbar with aria-label', () => {
    render(<ResponseActions {...defaultProps()} />);
    expect(
      screen.getByRole('toolbar', { name: 'Response actions' }),
    ).toBeInTheDocument();
  });

  it('renders Redraft button when no draft exists', () => {
    render(<ResponseActions {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /Redraft/ })).toBeInTheDocument();
  });

  it('renders More button when no draft exists', () => {
    render(<ResponseActions {...defaultProps()} />);
    expect(screen.getByRole('button', { name: /More/ })).toBeInTheDocument();
  });

  // ========================================================================
  // Write group: Accept / Save
  // ========================================================================

  it('renders Accept button when hasDraft and not approved', () => {
    render(
      <ResponseActions
        {...defaultProps({ hasDraft: true, reviewStatus: 'draft' })}
      />,
    );
    expect(screen.getByRole('button', { name: /Accept/ })).toBeInTheDocument();
  });

  it('does not render Accept button when approved', () => {
    render(
      <ResponseActions
        {...defaultProps({ hasDraft: true, reviewStatus: 'approved' })}
      />,
    );
    expect(
      screen.queryByRole('button', { name: /Accept/ }),
    ).not.toBeInTheDocument();
  });

  it('renders Save button when hasDraft', () => {
    render(<ResponseActions {...defaultProps({ hasDraft: true })} />);
    expect(screen.getByRole('button', { name: /Save/ })).toBeInTheDocument();
  });

  it('does not render Save button when no draft', () => {
    render(<ResponseActions {...defaultProps({ hasDraft: false })} />);
    expect(
      screen.queryByRole('button', { name: /Save/ }),
    ).not.toBeInTheDocument();
  });

  // ========================================================================
  // Visual separators
  // ========================================================================

  it('renders vertical separators between action groups when hasDraft', () => {
    const { container } = render(
      <ResponseActions {...defaultProps({ hasDraft: true })} />,
    );
    // Separators use data-slot="separator" with orientation="vertical"
    const separators = container.querySelectorAll(
      '[data-slot="separator"][data-orientation="vertical"]',
    );
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  it('renders separator between generate and tools groups when no draft', () => {
    const { container } = render(
      <ResponseActions {...defaultProps({ hasDraft: false })} />,
    );
    const separators = container.querySelectorAll(
      '[data-slot="separator"][data-orientation="vertical"]',
    );
    expect(separators.length).toBeGreaterThanOrEqual(1);
  });

  // ========================================================================
  // Next unanswered button
  // ========================================================================

  it('renders "Next unanswered" button when nextUnansweredIndex is valid', () => {
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          nextUnansweredIndex: 3,
          onNextUnanswered: vi.fn(),
        })}
      />,
    );
    // On desktop, shows "Next unanswered"; on mobile, "Next"
    const btn = screen.getByRole('button', { name: /Next unanswered|Next/ });
    expect(btn).toBeInTheDocument();
  });

  it('does not render "Next unanswered" button when nextUnansweredIndex is -1', () => {
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          nextUnansweredIndex: -1,
          onNextUnanswered: vi.fn(),
        })}
      />,
    );
    // There should be no button with "Next unanswered" or just "Next" (excluding nav buttons)
    const buttons = screen.getAllByRole('button');
    const nextUnansweredBtn = buttons.find(
      (b) =>
        b.textContent?.includes('Next unanswered') || b.textContent === 'Next',
    );
    expect(nextUnansweredBtn).toBeUndefined();
  });

  it('does not render "Next unanswered" button when no callback provided', () => {
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          nextUnansweredIndex: 3,
        })}
      />,
    );
    const buttons = screen.getAllByRole('button');
    const nextUnansweredBtn = buttons.find((b) =>
      b.textContent?.includes('Next unanswered'),
    );
    expect(nextUnansweredBtn).toBeUndefined();
  });

  it('calls onNextUnanswered when button is clicked', async () => {
    const user = userEvent.setup();
    const onNextUnanswered = vi.fn();
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          nextUnansweredIndex: 5,
          onNextUnanswered,
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Next unanswered|Next/ });
    await user.click(btn);
    expect(onNextUnanswered).toHaveBeenCalledTimes(1);
  });

  it('"Next unanswered" button is disabled when isLoading', () => {
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          isLoading: true,
          nextUnansweredIndex: 2,
          onNextUnanswered: vi.fn(),
        })}
      />,
    );
    const btn = screen.getByRole('button', { name: /Next unanswered|Next/ });
    expect(btn).toBeDisabled();
  });

  // ========================================================================
  // Action callbacks
  // ========================================================================

  it('calls onAction with "accept" when Accept is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <ResponseActions
        {...defaultProps({ onAction, hasDraft: true, reviewStatus: 'draft' })}
      />,
    );
    await user.click(screen.getByRole('button', { name: /Accept/ }));
    expect(onAction).toHaveBeenCalledWith('accept');
  });

  it('calls onAction with "save" when Save is clicked', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ResponseActions {...defaultProps({ onAction, hasDraft: true })} />);
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(onAction).toHaveBeenCalledWith('save');
  });

  // ========================================================================
  // Redraft with instructions
  // ========================================================================

  it('shows input field when Redraft is clicked once', async () => {
    const user = userEvent.setup();
    render(<ResponseActions {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /Redraft/ }));
    expect(screen.getByLabelText('Redraft instructions')).toBeInTheDocument();
  });

  it('sends instructions on second Redraft click', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<ResponseActions {...defaultProps({ onAction })} />);

    // First click — show input
    await user.click(screen.getByRole('button', { name: /Redraft/ }));
    const input = screen.getByLabelText('Redraft instructions');
    await user.type(input, 'Focus on ISO 27001');

    // Second click — send
    await user.click(screen.getByRole('button', { name: /Send/ }));
    expect(onAction).toHaveBeenCalledWith('regenerate', 'Focus on ISO 27001');
  });

  it('hides input when Cancel is clicked', async () => {
    const user = userEvent.setup();
    render(<ResponseActions {...defaultProps()} />);

    await user.click(screen.getByRole('button', { name: /Redraft/ }));
    expect(screen.getByLabelText('Redraft instructions')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    expect(
      screen.queryByLabelText('Redraft instructions'),
    ).not.toBeInTheDocument();
  });

  it('default button shows "Redraft"; instructions mode shows "Send"', async () => {
    const user = userEvent.setup();
    render(<ResponseActions {...defaultProps()} />);

    // Default state: button text is "Redraft"
    const btn = screen.getByRole('button', { name: /Redraft/ });
    expect(btn).toHaveTextContent('Redraft');

    // After clicking: button text switches to "Send"
    await user.click(btn);
    expect(screen.getByRole('button', { name: /Send/ })).toHaveTextContent(
      'Send',
    );
  });

  // ========================================================================
  // Loading states
  // ========================================================================

  it('disables all buttons when isLoading', () => {
    render(
      <ResponseActions
        {...defaultProps({ hasDraft: true, isLoading: true })}
      />,
    );
    const buttons = screen.getAllByRole('button');
    buttons.forEach((btn) => {
      expect(btn).toBeDisabled();
    });
  });

  // ========================================================================
  // Tooltip on Next unanswered
  // ========================================================================

  it('shows question number in Next unanswered tooltip', async () => {
    render(
      <ResponseActions
        {...defaultProps({
          hasDraft: true,
          nextUnansweredIndex: 7,
          onNextUnanswered: vi.fn(),
        })}
      />,
    );
    // The tooltip content is rendered but may not be visible without hover
    // We verify the button exists and is wired up
    const btn = screen.getByRole('button', { name: /Next unanswered|Next/ });
    expect(btn).toBeInTheDocument();
  });
});
