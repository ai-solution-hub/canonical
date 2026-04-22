/**
 * ConnectionsSection Component Tests
 *
 * Covers:
 * - Admin-only "For developers" accordion visibility
 * - MCP URL copy button presence
 * - Plugin download instructions present for admins
 * - No regression on connected-apps rendering
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionsSection } from '@/components/settings/connections-section';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('@/lib/client-config', () => ({
  BRANDING: { productName: 'Knowledge Hub' },
}));

vi.mock('@/components/settings/mcp-url', () => ({
  getMcpUrl: () => 'https://example.com/api/mcp/mcp',
}));

// Mock ConnectedAppsSection to avoid fetch side-effects
vi.mock('@/components/settings/connected-apps-section', () => ({
  ConnectedAppsSection: () => (
    <div data-testid="connected-apps">Connected Apps</div>
  ),
}));

// Mock useUserRole — controlled per-test via mockReturnValue
const mockUseUserRole = vi.fn();
vi.mock('@/hooks/use-user-role', () => ({
  useUserRole: () => mockUseUserRole(),
}));

// ---------------------------------------------------------------------------
// Admin-only "For developers" accordion
// ---------------------------------------------------------------------------

describe('ConnectionsSection — admin-only developer accordion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the "For developers" accordion when user is admin', () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
    render(<ConnectionsSection />);
    expect(screen.getByText('For developers')).toBeInTheDocument();
  });

  it('does not render the "For developers" accordion for non-admin users', () => {
    mockUseUserRole.mockReturnValue({
      role: 'editor',
      loading: false,
      canEdit: true,
      canAdmin: false,
    });
    render(<ConnectionsSection />);
    expect(screen.queryByText('For developers')).not.toBeInTheDocument();
  });

  it('does not render the "For developers" accordion for viewers', () => {
    mockUseUserRole.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });
    render(<ConnectionsSection />);
    expect(screen.queryByText('For developers')).not.toBeInTheDocument();
  });

  it('shows plugin download inside the developer accordion for admins', async () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
    render(<ConnectionsSection />);
    const trigger = screen.getByText('For developers');
    await userEvent.click(trigger);
    expect(screen.getByText('Download Plugin')).toBeInTheDocument();
  });

  it('shows .mcp.json configuration inside the developer accordion for admins', async () => {
    mockUseUserRole.mockReturnValue({
      role: 'admin',
      loading: false,
      canEdit: true,
      canAdmin: true,
    });
    render(<ConnectionsSection />);
    const trigger = screen.getByText('For developers');
    await userEvent.click(trigger);
    expect(screen.getByLabelText('Copy MCP configuration')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MCP URL copy — primary user action
// ---------------------------------------------------------------------------

describe('ConnectionsSection — MCP URL copy', () => {
  beforeEach(() => {
    mockUseUserRole.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });
  });

  it('renders the MCP server endpoint copy button for all roles', () => {
    render(<ConnectionsSection />);
    expect(
      screen.getByLabelText('Copy MCP server endpoint URL'),
    ).toBeInTheDocument();
  });

  it('renders the MCP server endpoint input with the correct URL', () => {
    render(<ConnectionsSection />);
    const input = screen.getByLabelText('MCP server endpoint');
    expect(input).toHaveValue('https://example.com/api/mcp/mcp');
  });
});

// ---------------------------------------------------------------------------
// Connected apps — no regression
// ---------------------------------------------------------------------------

describe('ConnectionsSection — connected apps', () => {
  beforeEach(() => {
    mockUseUserRole.mockReturnValue({
      role: 'viewer',
      loading: false,
      canEdit: false,
      canAdmin: false,
    });
  });

  it('renders the ConnectedAppsSection component', () => {
    render(<ConnectionsSection />);
    expect(screen.getByTestId('connected-apps')).toBeInTheDocument();
  });
});
