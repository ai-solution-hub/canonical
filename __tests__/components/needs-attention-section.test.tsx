import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NeedsAttentionSection } from '@/components/dashboard/needs-attention-section';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const baseProps = {
  governance_review_count: 0,
  unverified_count: 0,
  quality_flag_count: 0,
  stale_content_count: 0,
  expired_content_count: 0,
  userRole: 'admin',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('NeedsAttentionSection', () => {
  it('renders "All clear" when all counts are zero', () => {
    render(<NeedsAttentionSection {...baseProps} />);
    expect(
      screen.getByText('All clear — your knowledge base is in good shape.'),
    ).toBeDefined();
  });

  it('includes governance reviews in the total for editors', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        governance_review_count={3}
        userRole="editor"
      />,
    );
    expect(screen.getByText('Needs Attention (3)')).toBeDefined();
  });

  it('hides governance/unverified/quality cards for viewers', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        governance_review_count={5}
        unverified_count={3}
        quality_flag_count={2}
        stale_content_count={1}
        userRole="viewer"
      />,
    );
    // Viewer should only see stale content, not governance/unverified/quality
    expect(screen.getByText('Needs Attention (1)')).toBeDefined();
    expect(screen.queryByText(/governance/i)).toBeNull();
    expect(screen.queryByText(/unverified/i)).toBeNull();
    expect(screen.queryByText(/quality issues/i)).toBeNull();
  });

  it('includes expiringCertCount in the total attention count', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        expiringCertCount={2}
        userRole="admin"
      />,
    );
    expect(screen.getByText('Needs Attention (2)')).toBeDefined();
    expect(screen.getByText('2 certifications expiring soon')).toBeDefined();
  });

  it('includes expiringContentCount in the total attention count', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        expiringContentCount={4}
        userRole="admin"
      />,
    );
    expect(screen.getByText('Needs Attention (4)')).toBeDefined();
    expect(
      screen.getByText('4 content items have expiry dates approaching'),
    ).toBeDefined();
  });

  it('includes both cert and content expiring counts in the total', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        expiringCertCount={2}
        expiringContentCount={3}
        stale_content_count={1}
        userRole="admin"
      />,
    );
    // 2 certs + 3 content + 1 stale = 6
    expect(screen.getByText('Needs Attention (6)')).toBeDefined();
  });

  it('includes expiringContentCount for viewers', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        expiringContentCount={2}
        userRole="viewer"
      />,
    );
    expect(screen.getByText('Needs Attention (2)')).toBeDefined();
  });

  it('renders singular labels for count of 1', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        expiringCertCount={1}
        expiringContentCount={1}
        userRole="admin"
      />,
    );
    expect(screen.getByText('1 certification expiring soon')).toBeDefined();
    expect(
      screen.getByText('1 content item has expiry dates approaching'),
    ).toBeDefined();
  });

  it('renders zero counts without showing the card when count is null', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        stale_content_count={1}
        userRole="admin"
      />,
    );
    // expiringContentCount defaults to undefined, should render a card
    // with null count (AttentionCard hides when count is null/0)
    expect(screen.getByText('Needs Attention (1)')).toBeDefined();
  });

  it('renders stale content card with combined stale+expired count', () => {
    render(
      <NeedsAttentionSection
        {...baseProps}
        stale_content_count={3}
        expired_content_count={2}
        userRole="admin"
      />,
    );
    expect(screen.getByText('Needs Attention (5)')).toBeDefined();
    expect(screen.getByText('5 content items need refreshing')).toBeDefined();
  });
});
