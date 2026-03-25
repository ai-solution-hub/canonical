/**
 * Date Extraction UI Tests — Phase 3
 *
 * Tests the UI components for the date extraction feature:
 * - CertificationSummaryCard: Renew button visibility and behaviour
 * - ExpiryDateDisplay: date formatting, urgency styling, lifecycle display
 * - TemporalReferencesSection: collapsible display of extracted dates
 * - Accessibility: aria attributes, colour not sole indicator
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

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

vi.mock('@/components/claude-prompt-button', () => ({
  ClaudePromptButton: ({ label }: { label: string }) => (
    <button>{label}</button>
  ),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { CertificationSummaryCard } from '@/components/certification-summary-card';
import type {
  CertificationEntry,
  RegistrationEntry,
} from '@/components/certification-summary-card';
import { ExpiryDateDisplay } from '@/components/expiry-date-display';
import { TemporalReferencesSection } from '@/components/temporal-references-section';

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
      name: /upload renewed ISO 27001 document/i,
    });
    expect(renewLink).toBeInTheDocument();
    expect(renewLink).toHaveAttribute(
      'href',
      expect.stringContaining('/item/item-1'),
    );
    expect(renewLink).toHaveAttribute(
      'href',
      expect.stringContaining('renewal_entity=ISO%2027001'),
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
        name: /upload renewed ISO 27001 document/i,
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
        name: /upload renewed.*document/i,
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
        name: /upload renewed.*document/i,
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
      name: /upload renewed ICO Registration document/i,
    });
    expect(renewLink).toBeInTheDocument();
    expect(renewLink).toHaveAttribute(
      'href',
      expect.stringContaining('/item/item-3'),
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
        name: /upload renewed ICO Registration document/i,
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
        name: /upload renewed.*document/i,
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
        name: 'Upload renewed Cyber Essentials Plus document',
      }),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExpiryDateDisplay — date formatting and urgency styling
// ---------------------------------------------------------------------------

describe('ExpiryDateDisplay', () => {
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

  it('uses freshness semantic token classes for expired dates', () => {
    render(
      <dl>
        <ExpiryDateDisplay expiryDate="2020-01-01" lifecycleType={null} />
      </dl>,
    );

    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-expired');
  });

  it('uses freshness semantic token classes for imminent dates', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 5);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );

    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-stale');
  });

  it('uses freshness semantic token classes for approaching dates', () => {
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 20);
    const isoDate = futureDate.toISOString().split('T')[0];

    render(
      <dl>
        <ExpiryDateDisplay expiryDate={isoDate} lifecycleType={null} />
      </dl>,
    );

    const badge = screen.getByRole('status');
    expect(badge.className).toContain('freshness-aging');
  });

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

// ---------------------------------------------------------------------------
// TemporalReferencesSection — extracted dates display
// ---------------------------------------------------------------------------

describe('TemporalReferencesSection', () => {
  const sampleRefs = [
    {
      date: '2026-06-15',
      type: 'expiry' as const,
      confidence: 'high' as const,
      context: '...ISO 27001 certificate expires 15/06/2026...',
    },
    {
      date: '2024-01-10',
      type: 'effective' as const,
      confidence: 'medium' as const,
      context: '...date of registration 10/01/2024...',
    },
    {
      date: '2015-03-01',
      type: 'historical' as const,
      confidence: 'low' as const,
      context: '...established in 2015...',
    },
  ];

  it('renders nothing when temporalReferences is empty', () => {
    const { container } = render(
      <TemporalReferencesSection temporalReferences={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when temporalReferences is null-like', () => {
    const { container } = render(
      // @ts-expect-error — testing null input gracefully
      <TemporalReferencesSection temporalReferences={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows collapsed toggle with count', () => {
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    const toggle = screen.getByRole('button', {
      name: /extracted dates/i,
    });
    expect(toggle).toBeInTheDocument();
    expect(toggle).toHaveTextContent('3');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('expands to show date entries when clicked', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    const toggle = screen.getByRole('button', {
      name: /extracted dates/i,
    });
    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    // Check the list appears
    const list = screen.getByRole('list', {
      name: /temporal references/i,
    });
    expect(list).toBeInTheDocument();

    // Check dates are formatted as DD/MM/YYYY
    expect(screen.getByText('15/06/2026')).toBeInTheDocument();
    expect(screen.getByText('10/01/2024')).toBeInTheDocument();
    expect(screen.getByText('01/03/2015')).toBeInTheDocument();
  });

  it('shows context type badges', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    await user.click(
      screen.getByRole('button', { name: /extracted dates/i }),
    );

    expect(screen.getByText('Expiry')).toBeInTheDocument();
    expect(screen.getByText('Effective')).toBeInTheDocument();
    expect(screen.getByText('Historical')).toBeInTheDocument();
  });

  it('shows confidence levels', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    await user.click(
      screen.getByRole('button', { name: /extracted dates/i }),
    );

    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();
  });

  it('shows context snippets', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    await user.click(
      screen.getByRole('button', { name: /extracted dates/i }),
    );

    expect(
      screen.getByText(/ISO 27001 certificate expires/),
    ).toBeInTheDocument();
  });

  it('collapses when toggle is clicked again', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    const toggle = screen.getByRole('button', { name: /extracted dates/i });
    await user.click(toggle); // expand
    await user.click(toggle); // collapse

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(
      screen.queryByRole('list', { name: /temporal references/i }),
    ).not.toBeInTheDocument();
  });

  it('has proper aria-controls linking toggle to list', async () => {
    const user = userEvent.setup();
    render(<TemporalReferencesSection temporalReferences={sampleRefs} />);

    const toggle = screen.getByRole('button', { name: /extracted dates/i });
    expect(toggle).toHaveAttribute('aria-controls', 'temporal-references-list');

    await user.click(toggle);
    expect(document.getElementById('temporal-references-list')).toBeInTheDocument();
  });

  it('uses semantic tokens for context type styling (no raw Tailwind)', async () => {
    const user = userEvent.setup();
    render(
      <TemporalReferencesSection
        temporalReferences={[sampleRefs[0]]}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: /extracted dates/i }),
    );

    const expiryBadge = screen.getByText('Expiry');
    // Should use freshness-stale tokens for expiry type, not raw colours
    expect(expiryBadge.className).toContain('freshness-stale');
    expect(expiryBadge.className).not.toMatch(
      /text-(red|orange|amber|green|blue)-\d/,
    );
  });
});
