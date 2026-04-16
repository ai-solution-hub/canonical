/**
 * Component tests for McpSetupNudge — the one-shot dashboard nudge that
 * points users at Settings → Connections to configure an MCP connector.
 *
 * Asserts:
 *   1. Visible on first render when hasContent=true and no dismissal flag.
 *   2. Hidden after the dismiss button is clicked.
 *   3. Hidden on remount when localStorage already has the dismissal flag.
 *   4. Hidden when hasContent=false (KB is empty), regardless of dismiss state.
 *   5. Still hidden when dismissed even if hasContent=true.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock next/link to render a plain anchor so tests don't need a router.
vi.mock('next/link', () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Stub localStorage with a shared Map so the test can pre-seed the dismissal
// flag to simulate a returning user.
const localStorageMap = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => localStorageMap.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) =>
    localStorageMap.set(key, value),
  ),
  removeItem: vi.fn((key: string) => localStorageMap.delete(key)),
  clear: vi.fn(() => localStorageMap.clear()),
  get length() {
    return localStorageMap.size;
  },
  key: vi.fn(() => null),
};

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
});

import { McpSetupNudge } from '@/components/shell/mcp-setup-nudge';

beforeEach(() => {
  localStorageMap.clear();
  vi.clearAllMocks();
});

describe('McpSetupNudge', () => {
  it('renders when hasContent=true and points at /settings/connections', () => {
    render(<McpSetupNudge hasContent={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /set up a connection/i });
    expect(link).toHaveAttribute('href', '/settings/connections');
  });

  it('hides after the dismiss button is clicked and persists the flag', async () => {
    const user = userEvent.setup();
    render(<McpSetupNudge hasContent={true} />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    await user.click(
      screen.getByRole('button', { name: /dismiss mcp setup nudge/i }),
    );
    expect(screen.queryByRole('status')).toBeNull();
    expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
      'mcp-setup-nudge-dismissed',
      '1',
    );
  });

  it('stays hidden on remount when localStorage already has the dismissal flag', () => {
    localStorageMap.set('mcp-setup-nudge-dismissed', '1');
    render(<McpSetupNudge hasContent={true} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('is hidden when hasContent=false (KB is empty)', () => {
    render(<McpSetupNudge hasContent={false} />);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('remains hidden when dismissed even if hasContent=true', () => {
    localStorageMap.set('mcp-setup-nudge-dismissed', '1');
    render(<McpSetupNudge hasContent={true} />);
    expect(screen.queryByRole('status')).toBeNull();
  });
});
