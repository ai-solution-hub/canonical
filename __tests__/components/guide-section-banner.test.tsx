import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GuideSectionBanner } from '@/components/guide-section-banner';
import type { GuideSectionMatch } from '@/lib/guide-section-mapping';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeMatch(overrides: Partial<GuideSectionMatch> = {}): GuideSectionMatch {
  return {
    guideId: 'guide-1',
    guideName: 'SCP Sector Guide',
    guideSlug: 'scp-sector-guide',
    sectionId: 'section-1',
    sectionName: 'Security',
    sectionOrder: 1,
    isRequired: false,
    matchStrength: 'exact',
    matchReason: 'Matches all filters',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GuideSectionBanner', () => {
  it('renders nothing when guideSections is empty', () => {
    const { container } = render(
      <GuideSectionBanner guideSections={[]} onDismiss={vi.fn()} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders guide name and section list when matches exist', () => {
    render(
      <GuideSectionBanner
        guideSections={[makeMatch()]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('SCP Sector Guide')).toBeInTheDocument();
    expect(screen.getByText('Security')).toBeInTheDocument();
  });

  it('groups sections by guide correctly', () => {
    const sections = [
      makeMatch({ sectionId: 'sec-1', sectionName: 'Security' }),
      makeMatch({ sectionId: 'sec-2', sectionName: 'Compliance' }),
      makeMatch({
        guideId: 'guide-2',
        guideName: 'Data Protection Guide',
        guideSlug: 'data-protection-guide',
        sectionId: 'sec-3',
        sectionName: 'GDPR',
      }),
    ];

    render(
      <GuideSectionBanner guideSections={sections} onDismiss={vi.fn()} />,
    );

    // Both guide names should appear
    expect(screen.getByText('SCP Sector Guide')).toBeInTheDocument();
    expect(screen.getByText('Data Protection Guide')).toBeInTheDocument();

    // All section names should appear
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.getByText('Compliance')).toBeInTheDocument();
    expect(screen.getByText('GDPR')).toBeInTheDocument();
  });

  it('shows match strength badges with correct variants', () => {
    const sections = [
      makeMatch({ sectionId: 'sec-1', sectionName: 'Section A', matchStrength: 'exact' }),
      makeMatch({ sectionId: 'sec-2', sectionName: 'Section B', matchStrength: 'partial' }),
      makeMatch({ sectionId: 'sec-3', sectionName: 'Section C', matchStrength: 'domain_only' }),
    ];

    render(
      <GuideSectionBanner guideSections={sections} onDismiss={vi.fn()} />,
    );

    // Check badge labels
    expect(screen.getByText('Exact match')).toBeInTheDocument();
    expect(screen.getByText('Partial match')).toBeInTheDocument();
    expect(screen.getByText('Domain match')).toBeInTheDocument();

    // Check badge variants via data-variant attribute
    const exactBadge = screen.getByText('Exact match');
    expect(exactBadge).toHaveAttribute('data-variant', 'secondary');

    const partialBadge = screen.getByText('Partial match');
    expect(partialBadge).toHaveAttribute('data-variant', 'default');

    const domainBadge = screen.getByText('Domain match');
    expect(domainBadge).toHaveAttribute('data-variant', 'outline');
  });

  it('shows required indicator for required sections', () => {
    const sections = [
      makeMatch({ sectionId: 'sec-1', sectionName: 'Required Section', isRequired: true }),
      makeMatch({ sectionId: 'sec-2', sectionName: 'Optional Section', isRequired: false }),
    ];

    render(
      <GuideSectionBanner guideSections={sections} onDismiss={vi.fn()} />,
    );

    // "Required" label should appear once (only for the required section)
    const requiredIndicators = screen.getAllByText('Required');
    expect(requiredIndicators).toHaveLength(1);
  });

  it('section links point to correct guide page anchors', () => {
    const sections = [
      makeMatch({
        guideSlug: 'my-guide',
        sectionId: 'abc-123',
        sectionName: 'My Section',
      }),
    ];

    render(
      <GuideSectionBanner guideSections={sections} onDismiss={vi.fn()} />,
    );

    const link = screen.getByRole('link', { name: /View My Section in SCP Sector Guide/i });
    expect(link).toHaveAttribute('href', '/guide/my-guide#abc-123');
  });

  it('dismiss button calls onDismiss', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();

    render(
      <GuideSectionBanner guideSections={[makeMatch()]} onDismiss={onDismiss} />,
    );

    const dismissButton = screen.getByRole('button', { name: /Dismiss guide section suggestions/i });
    await user.click(dismissButton);

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('has role="region" and aria-label for accessibility', () => {
    render(
      <GuideSectionBanner guideSections={[makeMatch()]} onDismiss={vi.fn()} />,
    );

    const region = screen.getByRole('region', { name: 'Guide section suggestions' });
    expect(region).toBeInTheDocument();
  });

  it('renders multiple guides in separate groups', () => {
    const sections = [
      makeMatch({
        guideId: 'guide-alpha',
        guideName: 'Alpha Guide',
        guideSlug: 'alpha',
        sectionId: 'sec-a1',
        sectionName: 'Alpha Section 1',
      }),
      makeMatch({
        guideId: 'guide-alpha',
        guideName: 'Alpha Guide',
        guideSlug: 'alpha',
        sectionId: 'sec-a2',
        sectionName: 'Alpha Section 2',
      }),
      makeMatch({
        guideId: 'guide-beta',
        guideName: 'Beta Guide',
        guideSlug: 'beta',
        sectionId: 'sec-b1',
        sectionName: 'Beta Section 1',
      }),
    ];

    render(
      <GuideSectionBanner guideSections={sections} onDismiss={vi.fn()} />,
    );

    // Both guide names
    expect(screen.getByText('Alpha Guide')).toBeInTheDocument();
    expect(screen.getByText('Beta Guide')).toBeInTheDocument();

    // All section names
    expect(screen.getByText('Alpha Section 1')).toBeInTheDocument();
    expect(screen.getByText('Alpha Section 2')).toBeInTheDocument();
    expect(screen.getByText('Beta Section 1')).toBeInTheDocument();

    // Check that Alpha sections are grouped: find the list items under the Alpha guide
    const alphaGuide = screen.getByText('Alpha Guide').closest('div');
    expect(alphaGuide).toBeTruthy();
    const alphaList = within(alphaGuide!).getByRole('list');
    const alphaItems = within(alphaList).getAllByRole('listitem');
    expect(alphaItems).toHaveLength(2);
  });

  it('uses "populates" heading when exact matches present', () => {
    render(
      <GuideSectionBanner
        guideSections={[makeMatch({ matchStrength: 'exact' })]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('This content populates guide sections')).toBeInTheDocument();
  });

  it('uses "may match" heading when only partial/domain matches present', () => {
    render(
      <GuideSectionBanner
        guideSections={[makeMatch({ matchStrength: 'partial' })]}
        onDismiss={vi.fn()}
      />,
    );

    expect(screen.getByText('This content may match guide sections')).toBeInTheDocument();
  });
});
