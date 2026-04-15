/**
 * UnifiedAttentionSection Component Tests
 *
 * Tests severity grouping, role filtering, empty state,
 * ClaudePromptButton wiring, and the contextual prompt strip.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UnifiedAttentionSection } from '@/components/dashboard/unified-attention-section';
import type { AttentionItem } from '@/lib/attention';

// ---------------------------------------------------------------------------
// Mock clipboard, toast, and window.open for ClaudePromptButton
// ---------------------------------------------------------------------------

Object.assign(navigator, {
  clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<AttentionItem> = {}): AttentionItem {
  return {
    id: 'test-item',
    type: 'governance_review',
    severity: 'critical',
    entity_type: 'aggregate',
    entity_id: 'test-entity',
    title: 'Test attention item',
    detail: 'This is a test detail',
    action_url: '/test',
    action_label: 'Test action',
    role_visibility: ['admin', 'editor', 'viewer'],
    claude_prompt: 'Help me with this test item.',
    count: 1,
    ...overrides,
  };
}

function makeTestItems(): AttentionItem[] {
  return [
    makeItem({
      id: 'critical-1',
      severity: 'critical',
      type: 'governance_review',
      title: '3 governance reviews pending',
      role_visibility: ['admin', 'editor'],
    }),
    makeItem({
      id: 'high-1',
      severity: 'high',
      type: 'expired_content',
      title: '5 expired content items',
      role_visibility: ['admin', 'editor', 'viewer'],
    }),
    makeItem({
      id: 'high-2',
      severity: 'high',
      type: 'quality_flag',
      title: '2 quality flags unresolved',
      role_visibility: ['admin', 'editor'],
    }),
    makeItem({
      id: 'medium-1',
      severity: 'medium',
      type: 'unverified_content',
      title: '10 unverified items',
      role_visibility: ['admin', 'editor'],
    }),
    makeItem({
      id: 'info-1',
      severity: 'info',
      type: 'coverage_gap',
      title: '3 coverage gaps identified',
      role_visibility: ['admin', 'editor'],
    }),
  ];
}

// ---------------------------------------------------------------------------
// Severity grouping tests
// ---------------------------------------------------------------------------

describe('UnifiedAttentionSection', () => {
  describe('severity grouping', () => {
    it('groups items into correct tier sections', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      expect(screen.getByText(/Critical \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/High Priority \(2\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Medium \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Informational \(1\)/i)).toBeInTheDocument();
    });

    it('renders items within their severity groups', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      expect(
        screen.getByText('3 governance reviews pending'),
      ).toBeInTheDocument();
      expect(screen.getByText('5 expired content items')).toBeInTheDocument();
      expect(
        screen.getByText('2 quality flags unresolved'),
      ).toBeInTheDocument();
      expect(screen.getByText('10 unverified items')).toBeInTheDocument();
      expect(
        screen.getByText('3 coverage gaps identified'),
      ).toBeInTheDocument();
    });

    it('omits tier headers for empty tiers', () => {
      const items = [
        makeItem({ id: 'c1', severity: 'critical', title: 'Critical item' }),
        makeItem({ id: 'i1', severity: 'info', title: 'Info item' }),
      ];

      render(<UnifiedAttentionSection items={items} userRole="admin" />);

      expect(screen.getByText(/Critical \(1\)/i)).toBeInTheDocument();
      expect(screen.getByText(/Informational \(1\)/i)).toBeInTheDocument();
      expect(screen.queryByText(/High Priority/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/Medium/i)).not.toBeInTheDocument();
    });

    it('shows total count in section header', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      expect(screen.getByText(/Needs Attention \(5\)/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Role filtering tests
  // ---------------------------------------------------------------------------

  describe('role filtering', () => {
    it('shows all items for admin role', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      expect(
        screen.getByText('3 governance reviews pending'),
      ).toBeInTheDocument();
      expect(screen.getByText('5 expired content items')).toBeInTheDocument();
      expect(
        screen.getByText('2 quality flags unresolved'),
      ).toBeInTheDocument();
      expect(screen.getByText('10 unverified items')).toBeInTheDocument();
      expect(
        screen.getByText('3 coverage gaps identified'),
      ).toBeInTheDocument();
    });

    it('filters out editor/admin-only items for viewer role', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="viewer" />,
      );

      // Viewer should see expired content (visible to all)
      expect(screen.getByText('5 expired content items')).toBeInTheDocument();

      // Viewer should NOT see governance reviews, quality flags, unverified, or coverage gaps
      expect(
        screen.queryByText('3 governance reviews pending'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('2 quality flags unresolved'),
      ).not.toBeInTheDocument();
      expect(screen.queryByText('10 unverified items')).not.toBeInTheDocument();
      expect(
        screen.queryByText('3 coverage gaps identified'),
      ).not.toBeInTheDocument();
    });

    it('shows reduced count in header for viewer', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="viewer" />,
      );

      // Only 1 item (expired content) visible to viewer
      expect(screen.getByText(/Needs Attention \(1\)/i)).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Empty state tests
  // ---------------------------------------------------------------------------

  describe('empty state', () => {
    it('shows "All clear" message when no items', () => {
      render(<UnifiedAttentionSection items={[]} userRole="admin" />);

      expect(
        screen.getByText('All clear — your knowledge base is in good shape.'),
      ).toBeInTheDocument();
    });

    it('shows check icon in empty state', () => {
      const { container } = render(
        <UnifiedAttentionSection items={[]} userRole="admin" />,
      );

      // CheckCircle2 renders as an SVG
      const section = container.querySelector(
        '[aria-label="Items needing attention"]',
      );
      expect(section).toBeInTheDocument();
      expect(section!.querySelector('svg')).toBeInTheDocument();
    });

    it('shows empty state when all items are filtered out by role', () => {
      const adminOnlyItems = [
        makeItem({
          id: 'admin-only',
          role_visibility: ['admin'],
          title: 'Admin only item',
        }),
      ];

      render(
        <UnifiedAttentionSection items={adminOnlyItems} userRole="viewer" />,
      );

      expect(
        screen.getByText('All clear — your knowledge base is in good shape.'),
      ).toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // ClaudePromptButton wiring tests
  // ---------------------------------------------------------------------------

  describe('ClaudePromptButton wiring', () => {
    it('renders "Ask Claude" button for items with claude_prompt', () => {
      const items = [
        makeItem({
          id: 'with-prompt',
          claude_prompt: 'Help me review governance items.',
          title: 'Review needed',
        }),
      ];

      render(<UnifiedAttentionSection items={items} userRole="admin" />);

      // Per ClaudePromptButton copy principle (P0-20), per-item action uses
      // the action verb "Ask Claude".
      expect(screen.getByText('Ask Claude')).toBeInTheDocument();
    });

    it('does not render prompt button for items without claude_prompt', () => {
      const items = [
        makeItem({
          id: 'no-prompt',
          claude_prompt: undefined,
          title: 'No prompt item',
        }),
      ];

      render(<UnifiedAttentionSection items={items} userRole="admin" />);

      // Should not have "Ask Claude" button (only action link present)
      expect(screen.queryByText('Ask Claude')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Prompt strip tests
  // ---------------------------------------------------------------------------

  describe('prompt strip', () => {
    it('shows severity breakdown when items exist', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      // Should contain severity breakdown text
      expect(screen.getByText(/1 critical/i)).toBeInTheDocument();
      expect(screen.getByText(/2 high priority/i)).toBeInTheDocument();
    });

    it('shows "Plan with Claude" button in prompt strip', () => {
      render(
        <UnifiedAttentionSection items={makeTestItems()} userRole="admin" />,
      );

      expect(screen.getByText('Plan with Claude')).toBeInTheDocument();
    });

    it('hides prompt strip when no items', () => {
      render(<UnifiedAttentionSection items={[]} userRole="admin" />);

      expect(screen.queryByText('Plan with Claude')).not.toBeInTheDocument();
    });

    it('hides prompt strip when all items filtered out by role', () => {
      const adminOnlyItems = [
        makeItem({
          id: 'admin-only',
          role_visibility: ['admin'],
        }),
      ];

      render(
        <UnifiedAttentionSection items={adminOnlyItems} userRole="viewer" />,
      );

      expect(screen.queryByText('Plan with Claude')).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // Action link tests
  // ---------------------------------------------------------------------------

  describe('action links', () => {
    it('renders action links with correct URLs', () => {
      const items = [
        makeItem({
          id: 'link-test',
          action_url: '/review',
          action_label: 'Review items',
          title: 'Link test item',
        }),
      ];

      render(<UnifiedAttentionSection items={items} userRole="admin" />);

      const link = screen.getByRole('link', {
        name: /Link test item — Review items/i,
      });
      expect(link).toHaveAttribute('href', '/review');
    });
  });

  // ---------------------------------------------------------------------------
  // Detail text tests
  // ---------------------------------------------------------------------------

  describe('detail text', () => {
    it('renders detail text for each item', () => {
      const items = [
        makeItem({
          id: 'detail-test',
          detail: 'Detailed explanation of what to do',
          title: 'Detail test',
        }),
      ];

      render(<UnifiedAttentionSection items={items} userRole="admin" />);

      expect(
        screen.getByText('Detailed explanation of what to do'),
      ).toBeInTheDocument();
    });
  });
});
