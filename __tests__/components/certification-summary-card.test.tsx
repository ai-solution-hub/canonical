import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  CertificationSummaryCard,
  type CertificationEntry,
  type RegistrationEntry,
} from '@/components/dashboard/certification-summary-card';

// ---------------------------------------------------------------------------
// Mock clipboard and toast
// ---------------------------------------------------------------------------

const mockWriteText = vi.fn().mockResolvedValue(undefined);

Object.assign(navigator, {
  clipboard: { writeText: mockWriteText },
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeCert(
  overrides: Partial<CertificationEntry> = {},
): CertificationEntry {
  return {
    canonical_name: 'ISO 27001',
    entity_type: 'certification',
    mention_count: 3,
    content_item_count: 2,
    content_items: [
      { id: 'ci-1', title: 'Security Policy' },
      { id: 'ci-2', title: 'Compliance Overview' },
    ],
    holder: 'self',
    metadata: {
      version: '2022',
      issuing_body: 'BSI',
      date_obtained: '2024-06-15',
      expiry_date: '2027-06-15',
      scope: 'SaaS development and hosting',
    },
    expiry_status: 'valid',
    ...overrides,
  };
}

function makeSupplierCert(
  overrides: Partial<CertificationEntry> = {},
): CertificationEntry {
  return {
    canonical_name: 'ISO 9001',
    entity_type: 'certification',
    mention_count: 1,
    content_item_count: 1,
    content_items: [{ id: 'ci-5', title: 'Supplier Pack' }],
    holder: 'supplier',
    supplier_name: 'Supplier Co',
    metadata: {
      holder: 'supplier',
      supplier_name: 'Supplier Co',
    },
    expiry_status: 'unknown',
    ...overrides,
  };
}

function makeRegistration(
  overrides: Partial<RegistrationEntry> = {},
): RegistrationEntry {
  return {
    canonical_name: 'ICO Registration',
    entity_type: 'regulation',
    mention_count: 1,
    content_item_count: 1,
    content_items: [{ id: 'ci-6', title: 'ICO Details' }],
    metadata: {
      registration_number: 'ZA123456',
      registering_body: 'ICO',
      date_registered: '2020-01-01',
    },
    expiry_status: 'unknown',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Reset
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockWriteText.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CertificationSummaryCard', () => {
  it('renders nothing when all arrays are empty', () => {
    const { container } = render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the section header', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(screen.getByText('Certifications We Hold')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Certification rendering
  // -------------------------------------------------------------------------

  it('renders certification name and version', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    expect(screen.getByText('v2022')).toBeInTheDocument();
  });

  it('renders issuing body', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(screen.getByText('Issuing body: BSI')).toBeInTheDocument();
  });

  it('renders obtained and expiry dates', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    // UK date format: DD Month YYYY
    expect(screen.getByText(/Obtained:/)).toBeInTheDocument();
    expect(screen.getByText(/Expires:/)).toBeInTheDocument();
  });

  it('renders scope', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(
      screen.getByText('Scope: SaaS development and hosting'),
    ).toBeInTheDocument();
  });

  it('renders linked items count', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    expect(screen.getByText('2 linked items')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Missing optional fields
  // -------------------------------------------------------------------------

  it('renders certification with missing optional fields', () => {
    const cert = makeCert({
      metadata: {},
      expiry_status: 'unknown',
    });
    render(
      <CertificationSummaryCard
        certifications={[cert]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    // Name should still render
    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    // Optional fields should not render
    expect(screen.queryByText(/Issuing body/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scope/)).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Expiry badge statuses
  // -------------------------------------------------------------------------

  it('communicates a Valid expiry status with a labelled badge', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert({ expiry_status: 'valid' })]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    const badge = screen.getByLabelText('Expiry status: Valid');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Valid');
  });

  it('communicates an Expiring Soon status with a labelled badge', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert({ expiry_status: 'expiring_soon' })]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    const badge = screen.getByLabelText('Expiry status: Expiring Soon');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Expiring Soon');
  });

  it('communicates an Expired status with a labelled badge', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert({ expiry_status: 'expired' })]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    const badge = screen.getByLabelText('Expiry status: Expired');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('Expired');
  });

  it('communicates an unknown expiry status as "No expiry date"', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert({ expiry_status: 'unknown' })]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );
    const badge = screen.getByLabelText('Expiry status: No expiry date');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toBe('No expiry date');
  });

  // -------------------------------------------------------------------------
  // Design-token contract
  //
  // Each expiry-status badge is colour-coded via the freshness/muted semantic
  // tokens. The badge text + aria-label (asserted above) are the primary
  // user-observable signal; this single contract test pins the status -> token
  // mapping so a refactor that drops or mis-wires the colour coding is caught,
  // without coupling each behaviour test to a class string.
  // -------------------------------------------------------------------------

  it('colour-codes each expiry-status badge with its freshness token (design-token contract)', () => {
    const cases: Array<{
      status: CertificationEntry['expiry_status'];
      label: string;
      token: string;
    }> = [
      { status: 'valid', label: 'Valid', token: 'text-freshness-fresh' },
      {
        status: 'expiring_soon',
        label: 'Expiring Soon',
        token: 'text-freshness-aging',
      },
      { status: 'expired', label: 'Expired', token: 'text-freshness-expired' },
      {
        status: 'unknown',
        label: 'No expiry date',
        token: 'text-muted-foreground',
      },
    ];

    for (const { status, label, token } of cases) {
      const { unmount } = render(
        <CertificationSummaryCard
          certifications={[makeCert({ expiry_status: status })]}
          supplierCertifications={[]}
          registrations={[]}
        />,
      );
      const badge = screen.getByLabelText(`Expiry status: ${label}`);
      expect(badge.className).toContain(token);
      unmount();
    }
  });

  // -------------------------------------------------------------------------
  // WCAG: badges have text labels
  // -------------------------------------------------------------------------

  it('badges always have text labels alongside colour (WCAG)', () => {
    render(
      <CertificationSummaryCard
        certifications={[
          makeCert({ expiry_status: 'valid' }),
          makeCert({
            canonical_name: 'Cyber Essentials',
            expiry_status: 'expiring_soon',
          }),
        ]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    // All badges should have visible text content
    const validBadge = screen.getByLabelText('Expiry status: Valid');
    expect(validBadge.textContent).toBeTruthy();
    expect(validBadge.textContent).not.toBe('');

    const expiringBadge = screen.getByLabelText('Expiry status: Expiring Soon');
    expect(expiringBadge.textContent).toBeTruthy();
    expect(expiringBadge.textContent).not.toBe('');
  });

  // -------------------------------------------------------------------------
  // Copy button
  // -------------------------------------------------------------------------

  it('copies formatted text to clipboard on copy button click', async () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    const copyButton = screen.getByLabelText(
      'Copy certification summary to clipboard',
    );
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledTimes(1);
    });

    const copiedText = mockWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain('We hold');
    expect(copiedText).toContain('ISO 27001');
    expect(copiedText).toContain('BSI');
  });

  it('copy includes registration information', async () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[makeRegistration()]}
      />,
    );

    const copyButton = screen.getByLabelText(
      'Copy certification summary to clipboard',
    );
    fireEvent.click(copyButton);

    await waitFor(() => {
      expect(mockWriteText).toHaveBeenCalledTimes(1);
    });

    const copiedText = mockWriteText.mock.calls[0][0] as string;
    expect(copiedText).toContain('registered with');
    expect(copiedText).toContain('ICO Registration');
  });

  // -------------------------------------------------------------------------
  // Registrations section
  // -------------------------------------------------------------------------

  it('renders registrations section', () => {
    render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[]}
        registrations={[makeRegistration()]}
      />,
    );
    expect(screen.getByText('Registrations')).toBeInTheDocument();
    expect(screen.getByText('ICO Registration')).toBeInTheDocument();
    expect(screen.getByText('Registration: ZA123456')).toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Supplier section (collapsible)
  // -------------------------------------------------------------------------

  it('shows supplier section collapsed by default', () => {
    render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[makeSupplierCert()]}
        registrations={[]}
      />,
    );

    expect(screen.getByText('Supplier Certifications (1)')).toBeInTheDocument();
    // Supplier cert details should not be visible
    expect(screen.queryByText('Supplier Co')).not.toBeInTheDocument();
  });

  it('expands supplier section on click', async () => {
    render(
      <CertificationSummaryCard
        certifications={[]}
        supplierCertifications={[makeSupplierCert()]}
        registrations={[]}
      />,
    );

    const expandButton = screen.getByText('Supplier Certifications (1)');
    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.getByText('Supplier Co')).toBeInTheDocument();
      expect(screen.getByText('ISO 9001')).toBeInTheDocument();
    });
  });

  it('hides supplier section when no supplier certs', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(
      screen.queryByText(/Supplier Certifications/),
    ).not.toBeInTheDocument();
  });

  // -------------------------------------------------------------------------
  // Edit callback
  // -------------------------------------------------------------------------

  it('renders certification card as clickable link when content items exist', () => {
    render(
      <CertificationSummaryCard
        certifications={[makeCert()]}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    // When content_items exist, the entire card is a link to the first item.
    // ID-135.26: content_item ids are source_documents ids (re-pointed post-
    // {131.19}) — the card links to /documents/[id], not the deleted
    // /item/[id].
    const cardLinks = screen.getAllByRole('listitem');
    const certCard = cardLinks[0];
    expect(certCard.tagName).toBe('A');
    expect(certCard).toHaveAttribute('href', '/documents/ci-1');
  });

  it('calls onEditEntity when certification has no content items', () => {
    const onEdit = vi.fn();
    render(
      <CertificationSummaryCard
        certifications={[
          makeCert({ content_items: [], content_item_count: 0 }),
        ]}
        supplierCertifications={[]}
        registrations={[]}
        onEditEntity={onEdit}
      />,
    );

    const certButton = screen.getByLabelText('Edit ISO 27001');
    fireEvent.click(certButton);
    expect(onEdit).toHaveBeenCalledWith('ISO 27001');
  });

  // -------------------------------------------------------------------------
  // Multiple certifications
  // -------------------------------------------------------------------------

  it('renders multiple certifications', () => {
    const certs = [
      makeCert(),
      makeCert({
        canonical_name: 'Cyber Essentials Plus',
        metadata: { date_obtained: '2026-01-15', expiry_date: '2027-01-15' },
        expiry_status: 'valid',
        content_item_count: 1,
        content_items: [{ id: 'ci-3', title: 'CE Certificate' }],
      }),
    ];

    render(
      <CertificationSummaryCard
        certifications={certs}
        supplierCertifications={[]}
        registrations={[]}
      />,
    );

    expect(screen.getByText('ISO 27001')).toBeInTheDocument();
    expect(screen.getByText('Cyber Essentials Plus')).toBeInTheDocument();
  });
});
