/**
 * Certification formatter + helper tests.
 *
 * Tests the certification status FORMATTER, report data assembly, expiry
 * derivation, and the Claude prompt generator — the helpers KEPT after
 * ID-71.8 (M29/M4, B-INV-4/29) retired the `get_certification_status` MCP
 * tool into the consolidated `where_are_we_exposed` five-layer entry. The
 * tool-handler holder-coverage tests retired with the tool; certification /
 * expiry status is now exercised through the exposure tool's "how you could
 * use it today" layer (see __tests__/mcp/where-are-we-exposed-tool.test.ts).
 *
 * Pattern follows __tests__/mcp/get-document-versions.test.ts — tests the
 * formatter output rather than the live MCP server.
 */
import { describe, it, expect } from 'vitest';
import {
  formatCertificationReport,
  type CertificationReportData,
  type CertificationReportEntry,
} from '@/lib/mcp/formatters/entities';
import { deriveExpiryStatus } from '@/lib/certification-status';
import { generateCertificationReviewPrompt } from '@/lib/claude-prompts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleCertification: CertificationReportEntry = {
  canonical_name: 'ISO 27001',
  entity_type: 'certification',
  metadata: {
    version: '2022',
    issuing_body: 'BSI',
    date_obtained: '2024-06-15',
    expiry_date: '2027-06-14',
    scope: 'SaaS development and hosting',
  },
  expiry_status: 'valid',
  mention_count: 5,
  content_item_count: 3,
  holder: 'self',
};

const expiringCertification: CertificationReportEntry = {
  canonical_name: 'Cyber Essentials Plus',
  entity_type: 'certification',
  metadata: {
    issuing_body: 'IASME',
    date_obtained: '2025-03-01',
    expiry_date: '2026-03-30',
  },
  expiry_status: 'expiring_soon',
  mention_count: 3,
  content_item_count: 2,
  holder: 'self',
};

const supplierCertification: CertificationReportEntry = {
  canonical_name: 'ISO 9001',
  entity_type: 'certification',
  metadata: {
    version: '2015',
    issuing_body: 'UKAS',
    expiry_date: '2027-12-31',
    supplier_name: 'Acme Hosting Ltd',
  },
  expiry_status: 'valid',
  mention_count: 1,
  content_item_count: 1,
  holder: 'supplier',
  supplier_name: 'Acme Hosting Ltd',
};

const sampleFramework: CertificationReportEntry = {
  canonical_name: 'G-Cloud 14',
  entity_type: 'framework',
  metadata: {
    round: '14',
    status: 'active',
    date_joined: '2024-01-15',
    expiry_date: '2025-07-14',
  },
  expiry_status: 'valid',
  mention_count: 4,
  content_item_count: 2,
};

const sampleRegistration: CertificationReportEntry = {
  canonical_name: 'ICO Registration',
  entity_type: 'regulation',
  metadata: {
    registration_number: 'ZA123456',
    expiry_date: '2026-11-30',
  },
  expiry_status: 'valid',
  mention_count: 2,
  content_item_count: 1,
};

function buildReportData(
  overrides?: Partial<CertificationReportData>,
): CertificationReportData {
  return {
    certifications: [sampleCertification, expiringCertification],
    frameworks: [sampleFramework],
    registrations: [sampleRegistration],
    summary: {
      total_certifications: 4,
      valid: 3,
      expiring_soon: 1,
      expired: 0,
      unknown: 0,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Formatter tests
// ---------------------------------------------------------------------------

describe('formatCertificationReport', () => {
  it('produces a markdown report with the correct heading', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('# Certification Status Report');
  });

  it('includes the summary line with counts', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('**Total:** 4');
    expect(result).toContain('Valid: 3');
    expect(result).toContain('Expiring soon: 1');
    expect(result).toContain('Expired: 0');
  });

  it('includes certification table with columns', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('## Certifications (2 held)');
    expect(result).toContain(
      '| Certification | Version | Issuer | Obtained | Expires | Status |',
    );
    expect(result).toContain('| ISO 27001 | 2022 | BSI |');
    expect(result).toContain('| Cyber Essentials Plus |');
  });

  it('includes framework table', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('## Frameworks (1 active)');
    expect(result).toContain(
      '| Framework | Round | Status | Joined | Expires |',
    );
    expect(result).toContain('| G-Cloud 14 | 14 | active |');
  });

  it('includes registration table', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('## Registrations (1)');
    expect(result).toContain('| Registration | Number | Expires |');
    expect(result).toContain('| ICO Registration | ZA123456 |');
  });

  it('includes evidence section for items with content', () => {
    const result = formatCertificationReport(buildReportData());
    expect(result).toContain('### Evidence');
    expect(result).toContain('ISO 27001: referenced in 3 content items');
    expect(result).toContain('G-Cloud 14: referenced in 2 content items');
    expect(result).toContain('ICO Registration: referenced in 1 content item');
  });

  it('formats dates in DD/MM/YYYY UK format', () => {
    const result = formatCertificationReport(buildReportData());
    // 2024-06-15 should be 15/06/2024
    expect(result).toContain('15/06/2024');
    // 2027-06-14 should be 14/06/2027
    expect(result).toContain('14/06/2027');
  });

  it('excludes supplier certifications by default', () => {
    const data = buildReportData({
      certifications: [sampleCertification, supplierCertification],
    });
    const result = formatCertificationReport(data, false);
    expect(result).not.toContain('## Supplier Certifications');
    // Self-held should still appear
    expect(result).toContain('ISO 27001');
  });

  it('includes supplier certifications when includeSuppliers is true', () => {
    const data = buildReportData({
      certifications: [sampleCertification, supplierCertification],
    });
    const result = formatCertificationReport(data, true);
    expect(result).toContain('## Supplier Certifications (1)');
    expect(result).toContain('| ISO 9001 | Acme Hosting Ltd | 2015 |');
  });

  it('handles empty data with no sections', () => {
    const data = buildReportData({
      certifications: [],
      frameworks: [],
      registrations: [],
      summary: {
        total_certifications: 0,
        valid: 0,
        expiring_soon: 0,
        expired: 0,
        unknown: 0,
      },
    });
    const result = formatCertificationReport(data);
    expect(result).toContain('# Certification Status Report');
    expect(result).toContain('**Total:** 0');
    expect(result).not.toContain('## Certifications');
    expect(result).not.toContain('## Frameworks');
    expect(result).not.toContain('## Registrations');
    expect(result).not.toContain('### Evidence');
  });

  it('handles missing metadata fields gracefully', () => {
    const minimal: CertificationReportEntry = {
      canonical_name: 'Some Cert',
      entity_type: 'certification',
      metadata: {},
      expiry_status: 'unknown',
      mention_count: 1,
      content_item_count: 0,
      holder: 'self',
    };
    const data = buildReportData({
      certifications: [minimal],
      frameworks: [],
      registrations: [],
      summary: {
        total_certifications: 1,
        valid: 0,
        expiring_soon: 0,
        expired: 0,
        unknown: 1,
      },
    });
    const result = formatCertificationReport(data);
    expect(result).toContain('| Some Cert |');
    // Should not crash on missing metadata
    expect(result).toContain('## Certifications (1 held)');
  });

  it('uses singular form for 1 content item in evidence', () => {
    const singleEvidence: CertificationReportEntry = {
      ...sampleCertification,
      content_item_count: 1,
    };
    const data = buildReportData({
      certifications: [singleEvidence],
      frameworks: [],
      registrations: [],
      summary: {
        total_certifications: 1,
        valid: 1,
        expiring_soon: 0,
        expired: 0,
        unknown: 0,
      },
    });
    const result = formatCertificationReport(data);
    expect(result).toContain('referenced in 1 content item');
    expect(result).not.toContain('referenced in 1 content items');
  });
});

// ---------------------------------------------------------------------------
// deriveExpiryStatus tests (imported from certification-status.ts)
// ---------------------------------------------------------------------------

describe('deriveExpiryStatus', () => {
  it('returns "unknown" for undefined expiry date', () => {
    expect(deriveExpiryStatus(undefined)).toBe('unknown');
  });

  it('returns "expired" for past dates', () => {
    expect(deriveExpiryStatus('2020-01-01')).toBe('expired');
  });

  it('returns "valid" for far future dates', () => {
    expect(deriveExpiryStatus('2099-12-31')).toBe('valid');
  });

  it('returns "expiring_soon" for dates within 30 days', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 15);
    expect(deriveExpiryStatus(soon.toISOString())).toBe('expiring_soon');
  });
});

// ---------------------------------------------------------------------------
// Prompt generator tests
// ---------------------------------------------------------------------------

describe('generateCertificationReviewPrompt', () => {
  it('generates a prompt with correct certification count', () => {
    const result = generateCertificationReviewPrompt(5, 0);
    expect(result.prompt).toContain('5 certifications on record');
    expect(result.label).toBe('Review certification status');
    expect(result.category).toBe('compliance');
  });

  it('uses singular form for 1 certification', () => {
    const result = generateCertificationReviewPrompt(1, 0);
    expect(result.prompt).toContain('1 certification on record');
    expect(result.prompt).not.toContain('certifications');
  });

  it('includes expiring count when > 0', () => {
    const result = generateCertificationReviewPrompt(5, 2);
    expect(result.prompt).toContain('2 are expiring soon');
  });

  it('uses singular form for 1 expiring', () => {
    const result = generateCertificationReviewPrompt(5, 1);
    expect(result.prompt).toContain('1 is expiring soon');
  });

  it('omits expiring text when count is 0', () => {
    const result = generateCertificationReviewPrompt(3, 0);
    expect(result.prompt).not.toContain('expiring');
  });

  it('includes correct description', () => {
    const result = generateCertificationReviewPrompt(3, 1);
    expect(result.description).toBe('3 certifications, 1 expiring');
  });

  it('uses singular in description for 1 cert', () => {
    const result = generateCertificationReviewPrompt(1, 0);
    expect(result.description).toBe('1 certification, 0 expiring');
  });
});
