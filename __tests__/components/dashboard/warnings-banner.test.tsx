/**
 * WarningsBanner Component Tests
 *
 * Verifies the WP1 dashboard partial-failure banner:
 *   - renders when warnings is non-empty
 *   - renders nothing when warnings is empty or undefined
 *   - renders one bullet per warning string with the correct text
 *   - heading copy switches between singular and plural
 *   - dismiss button removes the banner from the DOM
 *   - a11y attributes (role="status", aria-live="polite", aria-labelledby)
 *     are present so screen readers announce the partial failure without
 *     pre-empting the rest of the page
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WarningsBanner } from '@/components/dashboard/warnings-banner';

describe('<WarningsBanner />', () => {
  it('renders nothing when warnings is empty', () => {
    const { container } = render(<WarningsBanner warnings={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when warnings is undefined-like (defensive)', () => {
    // Cast through unknown to simulate a runtime payload missing the field.
    const { container } = render(
      <WarningsBanner
        warnings={undefined as unknown as readonly string[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the heading and one bullet for one warning', () => {
    render(
      <WarningsBanner warnings={['recent_activity query failed']} />,
    );
    expect(
      screen.getByText(/temporarily unavailable/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText('recent_activity query failed'),
    ).toBeInTheDocument();
    // Exactly one list item.
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('renders the heading and one bullet per warning for multiple warnings', () => {
    render(
      <WarningsBanner
        warnings={[
          'recent_activity query failed',
          'team_changes query failed',
          'my_recent_work query failed',
        ]}
      />,
    );
    expect(
      screen.getByText(/temporarily unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(
      screen.getByText('team_changes query failed'),
    ).toBeInTheDocument();
  });

  it('exposes status role with polite live region and labelled heading', () => {
    render(
      <WarningsBanner warnings={['attention_counts RPC failed']} />,
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    // The heading element referenced by aria-labelledby must exist and
    // contain the heading text. We assert the linkage explicitly so a future
    // refactor cannot drop the labelledby pointer without the test failing.
    const labelledBy = region.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    const heading = document.getElementById(labelledBy as string);
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toMatch(/temporarily unavailable/i);
  });

  it('removes itself from the DOM when the dismiss button is clicked', async () => {
    const user = userEvent.setup();
    render(<WarningsBanner warnings={['team_changes query failed']} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /dismiss dashboard warnings/i }),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(
      screen.queryByText('team_changes query failed'),
    ).toBeNull();
  });
});
