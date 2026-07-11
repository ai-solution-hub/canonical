/**
 * Date Extraction UI Tests — Phase 3
 *
 * Tests the UI components for the date extraction feature:
 * - CertificationSummaryCard: Renew button visibility and behaviour
 * - ExpiryDateDisplay: date formatting, urgency styling, lifecycle display
 * - Accessibility: aria attributes, colour not sole indicator
 *
 * ID-131.17: the TemporalReferencesSection suite was removed here — that
 * component lived at the deleted `components/item-detail/` IMS surface with
 * no other consumer (see __tests__/components/item-detail/ deletions in the
 * same commit).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

vi.mock('@/lib/utils', () => ({
  cn: (...args: unknown[]) => args.filter(Boolean).join(' '),
}));

vi.mock('@/lib/claude-prompts', () => ({
  generateCertificationReviewPrompt: vi.fn().mockReturnValue({
    prompt: 'mock prompt',
  }),
}));

vi.mock('@/components/content/claude-prompt-button', () => ({
  ClaudePromptButton: ({ label }: { label: string }) => (
    <button>{label}</button>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { CertificationSummaryCard } from '@/components/dashboard/certification-summary-card';
import type {
  CertificationEntry,
  RegistrationEntry,
} from '@/components/dashboard/certification-summary-card';
import { ExpiryDateDisplay } from '@/components/shared/expiry-date-display';

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function createCertification(
  overrides: Partial<CertificationEntry> = {},
): CertificationEntry {
  return {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    mention_count: 3,
    content_item_count: 2,
    content_items: [
      { id: 'item-1', title: 'ISO 27001 Certificate' },
      { id: 'item-2', title: 'Security Policy' },
    ],
    holder: 'self',
    metadata: {
      issuing_body: 'BSI',
      expiry_date: '2026-06-15',
    },
    expiry_status: 'valid',
    ...overrides,
  };
}

function createRegistration(
  overrides: Partial<RegistrationEntry> = {},
): RegistrationEntry {
  return {
    canonical_name: 'ICO Registration',
    entity_type: 'regulation',
    mention_count: 2,
    content_item_count: 1,
    content_items: [{ id: 'item-3', title: 'Data Protection Registration' }],
    metadata: {
      registration_number: 'ZA123456',
      registering_body: 'ICO',
      expiry_date: '2026-04-01',
    },
    expiry_status: 'valid',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// CertificationSummaryCard — Renew button tests
// ---------------------------------------------------------------------------

describe('CertificationSummaryCard — Renew button', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders Renew button for expiring_soon certification', () => {
    const cert = createCertification({ expiry_status: 'expiring_soon' });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    const renewLink = screen.getByRole('link', {
      name: /Review ISO 27001/i,
    });
    expect(renewLink).toBeInTheDocument();
    expect(renewLink).toHaveAttribute(
      'href',
      expect.stringContaining('/documents/item-1'),
    );
  });

  it('renders Renew button for expired certification', () => {
    const cert = createCertification({ expiry_status: 'expired' });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: /Review ISO 27001/i,
      }),
    ).toBeInTheDocument();
  });

  it('does not render Renew button for valid certification', () => {
    const cert = createCertification({ expiry_status: 'valid' });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.queryByRole('link', {
        name: /Review .*/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('does not render Renew button for unknown expiry status', () => {
    const cert = createCertification({ expiry_status: 'unknown' });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.queryByRole('link', {
        name: /Review .*/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('renders Renew button for expiring_soon registration', () => {
    const reg = createRegistration({ expiry_status: 'expiring_soon' });
    render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[]}
        registrations={[reg]}
      />,
    );

    const renewLink = screen.getByRole('link', {
      name: /Review ICO Registration/i,
    });
    expect(renewLink).toBeInTheDocument();
    expect(renewLink).toHaveAttribute(
      'href',
      expect.stringContaining('/documents/item-3'),
    );
  });

  it('renders Renew button for expired registration', () => {
    const reg = createRegistration({ expiry_status: 'expired' });
    render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[]}
        registrations={[reg]}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: /Review ICO Registration/i,
      }),
    ).toBeInTheDocument();
  });

  it('does not render Renew button when no content items linked', () => {
    const cert = createCertification({
      expiry_status: 'expiring_soon',
      content_items: [],
    });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.queryByRole('link', {
        name: /Review .*/i,
      }),
    ).not.toBeInTheDocument();
  });

  it('Renew button has accessible label with entity name', () => {
    const cert = createCertification({
      expiry_status: 'expired',
      canonical_name: 'Cyber Essentials Plus',
    });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.getByRole('link', {
        name: 'Review Cyber Essentials Plus',
      }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExpiryDateDisplay — date formatting and urgency styling
// ---------------------------------------------------------------------------

describe('ExpiryDateDisplay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-29T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('displays expiry date in DD/MM/YYYY format', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2026-06-15" lifecycleType={null} />
      </dl>,
    );

    // DD/MM/YYYY format for 2026-06-15 should be 15/06/2026
    expect(screen.getByText('15/06/2026')).toBeInTheDocument();
  });

  it('shows "Expired" urgency for past dates', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2020-01-01" lifecycleType={null} />
      </dl>,
    );

    const statusBadge = screen.getByRole('status');
    expect(statusBadge).toHaveTextContent('Expired');
    expect(statusBadge).toHaveAttribute(
      'aria-label',
      expect.stringContaining('Expired'),
    );
  });

  it('shows days remaining for future dates within 7 days', () => {
    // Create a date 3 days from now
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 3);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );

    const statusBadge = screen.getByRole('status');
    expect(statusBadge).toHaveTextContent(/3 days remaining/);
  });

  it('shows days remaining for future dates within 30 days', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );

    const statusBadge = screen.getByRole('status');
    expect(statusBadge).toHaveTextContent(/(?:19|20) days remaining/);
  });

  it('displays "Date-bound" lifecycle label when lifecycle_type is date_bound', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2028-01-01" lifecycleType="date_bound" />
      </dl>,
    );

    expect(screen.getByText('Date-bound')).toBeInTheDocument();
  });

  it('does not display lifecycle label for non-date_bound types', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2028-01-01" lifecycleType="evergreen" />
      </dl>,
    );

    expect(screen.queryByText('Date-bound')).not.toBeInTheDocument();
  });

  it('does not display lifecycle label when lifecycle_type is null', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2028-01-01" lifecycleType={null} />
      </dl>,
    );

    expect(screen.queryByText('Date-bound')).not.toBeInTheDocument();
  });

  it('has aria-label on urgency badge for screen readers', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2020-01-01" lifecycleType={null} />
      </dl>,
    );

    const badge = screen.getByRole('status');
    expect(badge).toHaveAttribute('aria-label', 'Expiry status: Expired');
  });

  // Urgency-tier -> freshness-token colour mapping is pinned once in
  // date-extraction-ui.contract.test.tsx (the sanctioned coupling point).
  // The behaviour tests above assert the user-observable label / day-count,
  // which is the WCAG-required non-colour cue for the same urgency tiers.

  it('singular "day" for exactly 1 day remaining', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isoDate = tomorrow.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );

    const badge = screen.getByRole('status');
    expect(badge).toHaveTextContent('1 day remaining');
  });
});
