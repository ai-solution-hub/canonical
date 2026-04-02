/**
 * CollapsibleSection Component Tests
 *
 * Tests the collapsible section with chevron trigger — title rendering,
 * default open/closed state, toggle behaviour, and aria-expanded attribute.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { CollapsibleSection } from '@/components/item-detail/collapsible-section';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CollapsibleSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders title text', () => {
    render(
      <CollapsibleSection title="Metadata">
        <p>Child content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Metadata')).toBeInTheDocument();
  });

  it('shows children when defaultOpen is true', () => {
    render(
      <CollapsibleSection title="Details" defaultOpen={true}>
        <p>Visible content</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('Visible content')).toBeInTheDocument();
  });

  it('hides children via hidden attribute when defaultOpen is false', () => {
    render(
      <CollapsibleSection title="Details" defaultOpen={false}>
        <p>Hidden content</p>
      </CollapsibleSection>,
    );
    // Content is in the DOM but hidden (DOM-preserving mode)
    const content = screen.getByText('Hidden content');
    expect(content.closest('[hidden]')).toBeTruthy();
  });

  it('removes children from DOM when lazy and defaultOpen is false', () => {
    render(
      <CollapsibleSection title="Details" defaultOpen={false} lazy>
        <p>Lazy hidden</p>
      </CollapsibleSection>,
    );
    expect(screen.queryByText('Lazy hidden')).not.toBeInTheDocument();
  });

  it('toggles on button click', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Toggle Me" defaultOpen={false}>
        <p>Toggle content</p>
      </CollapsibleSection>,
    );
    // Collapsed: content in DOM but hidden
    expect(screen.getByText('Toggle content').closest('[hidden]')).toBeTruthy();

    await user.click(screen.getByRole('button'));
    // Expanded: content visible (no hidden attribute)
    expect(screen.getByText('Toggle content').closest('[hidden]')).toBeNull();

    await user.click(screen.getByRole('button'));
    // Collapsed again
    expect(screen.getByText('Toggle content').closest('[hidden]')).toBeTruthy();
  });

  it('button has correct aria-expanded attribute', async () => {
    const user = userEvent.setup();
    render(
      <CollapsibleSection title="Expand" defaultOpen={false}>
        <p>Content</p>
      </CollapsibleSection>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');

    await user.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
  });
});
