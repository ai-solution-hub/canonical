/**
 * MCP Tool: get_certification_status
 *
 * Tests the certification status tool formatter, report data assembly,
 * the Claude prompt generator, and holder-coverage paths (OPS-24).
 *
 * Pattern follows __tests__/mcp/get-document-versions.test.ts — tests
 * the formatter output rather than the live MCP server.
 *
 * The OPS-24 holder-coverage section (bottom of file) exercises the
 * tool handler directly via a mock MCP server, testing the holder
 * filtering logic in entities.ts lines 155-318.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import {
  formatCertificationReport,
  type CertificationReportData,
  type CertificationReportEntry,
} from '@/lib/mcp/formatters/entities';
import { createMockMcpServer } from '@/__tests__/helpers/mcp-server';
import { deriveExpiryStatus } from '@/lib/certification-status';
import { generateCertificationReviewPrompt } from '@/lib/claude-prompts';

// ---------------------------------------------------------------------------
// Hoisted mocks for OPS-24 handler tests
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => {
  // Build a chainable mock that mimics the Supabase query builder.
  // Each chainable method returns the chain itself; `.then()` is the
  // terminal awaitable that resolves with `{ data, error }`.
  function buildChain() {
    const chain: Record<string, ReturnType<typeof vi.fn>> = {};
    const chainable = [
      'select',
      'insert',
      'update',
      'upsert',
      'delete',
      'eq',
      'neq',
      'in',
      'is',
      'not',
      'ilike',
      'contains',
      'gte',
      'lte',
      'gt',
      'lt',
      'or',
      'order',
      'limit',
      'range',
    ];
    for (const m of chainable) {
      chain[m] = vi.fn();
    }
    chain.single = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null });
    chain.then = vi.fn((resolve: (v: unknown) => void) =>
      resolve({ data: [], error: null }),
    );
    for (const m of chainable) {
      chain[m].mockReturnValue(chain);
    }
    return chain;
  }

  const chain1 = buildChain();
  const chain2 = buildChain();

  // fromCalls tracks the sequence of .from() calls so we can return
  // a different chain for entity_relationships vs entity_mentions.
  let fromCallIndex = 0;
  const chains = [chain1, chain2];

  const mockFrom = vi.fn((_table: string) => {
    const c = chains[fromCallIndex] ?? chain2;
    fromCallIndex++;
    return c;
  });

  return {
    chain1,
    chain2,
    mockFrom,
    resetFromIndex: () => {
      fromCallIndex = 0;
    },
    createMcpClient: vi.fn().mockReturnValue({ from: mockFrom, rpc: vi.fn() }),
    getMcpUserId: vi.fn().mockReturnValue('user-123'),
    getMcpUserRole: vi.fn().mockResolvedValue('editor'),
    checkMcpRole: vi.fn().mockResolvedValue('editor'),
  };
});

vi.mock('@/lib/mcp/auth', () => ({
  createMcpClient: mocks.createMcpClient,
  getMcpUserId: mocks.getMcpUserId,
  getMcpUserRole: mocks.getMcpUserRole,
  checkMcpRole: mocks.checkMcpRole,
}));

// Mock lazy-loaded modules that entity tools may import
vi.mock('@/lib/ai/embed', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/embed')>();
  return {
    ...actual,
    generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
  };
});
vi.mock('@/lib/ai/classify', () => ({
  classifyContent: vi.fn(),
}));
vi.mock('@/lib/ai/summarise', () => ({
  generateSummary: vi.fn(),
}));
vi.mock('@/lib/ai/errors', () => ({
  AIServiceError: class AIServiceError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
}));
vi.mock('@/lib/dashboard', () => ({
  fetchUnifiedDashboardData: vi.fn(),
  unifiedToDashboardData: vi.fn((d: unknown) => d),
}));
vi.mock('@/lib/bid/bid-queries', () => ({
  getBidDetail: vi.fn(),
  getBidQuestion: vi.fn(),
}));
vi.mock('@/lib/reorient', () => ({
  getReorientData: vi.fn(),
}));

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

// ---------------------------------------------------------------------------
// OPS-24 — Holder coverage tests (tool handler via mock MCP server)
// ---------------------------------------------------------------------------

function makeAuthExtra(authInfo?: Partial<AuthInfo>) {
  return {
    authInfo: {
      token: 'test-token',
      clientId: 'test-client',
      scopes: ['read', 'write'],
      extra: { userId: 'user-123', role: 'editor' },
      ...authInfo,
    },
  };
}

// v4-compliant UUIDs for strict Zod validation
const UUID_CONTENT_1 = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const UUID_CONTENT_2 = 'b2c3d4e5-f6a7-4b8c-9d0e-1f2a3b4c5d6e';

describe('get_certification_status — holder coverage (OPS-24)', () => {
  let mockServer: ReturnType<typeof createMockMcpServer>;
  const extra = makeAuthExtra();

  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.resetFromIndex();
    mockServer = createMockMcpServer();

    const { registerEntityTools } = await import('@/lib/mcp/tools/entities');
    await registerEntityTools(mockServer.server as never);
  });

  /**
   * Helper: configure the two .from() calls that get_certification_status
   * makes — first for entity_relationships, second for entity_mentions.
   *
   * entity_relationships query: .from('entity_relationships').select(...).eq('relationship_type','holds').eq('source_entity', orgNameLower)
   * entity_mentions query: .from('entity_mentions').select(...).in('canonical_name', targetNames)
   */
  function configureChains(
    relationships: Array<{
      source_entity: string;
      target_entity: string;
    }>,
    mentions: Array<{
      canonical_name: string;
      entity_type: string;
      entity_type_override: string | null;
      metadata: Record<string, unknown>;
      content_item_id: string | null;
    }>,
  ) {
    // First .from() call → entity_relationships
    mocks.chain1.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: relationships, error: null }),
    );
    // Second .from() call → entity_mentions
    mocks.chain2.then.mockImplementation((resolve: (v: unknown) => void) =>
      resolve({ data: mentions, error: null }),
    );
  }

  // 1. Self-held: source_entity matches BRANDING + metadata.holder='self'
  it('surfaces self-held cert in certifications[] with holder=self', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 27001',
        },
      ],
      [
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: { holder: 'self', version: '2022' },
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    const result = (await handler({}, extra)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: {
        certifications: Array<{
          canonical_name: string;
          holder?: string;
          supplier_name?: string;
        }>;
      };
    };

    expect(result.content[0].text).toContain('Certification Status Report');
    expect(result.structuredContent.certifications).toHaveLength(1);
    expect(result.structuredContent.certifications[0].canonical_name).toBe(
      'iso 27001',
    );
    expect(result.structuredContent.certifications[0].holder).toBe('self');
    expect(
      result.structuredContent.certifications[0].supplier_name,
    ).toBeUndefined();
  });

  // 2. Supplier-held: appears in supplier_certifications[] when include_suppliers=true,
  //    absent when include_suppliers is false/omitted
  it('surfaces supplier-held cert only when include_suppliers=true', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 9001',
        },
      ],
      [
        {
          canonical_name: 'iso 9001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: {
            holder: 'supplier',
            supplier_name: 'example-datacentre london docklands',
            version: '2015',
          },
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    // With include_suppliers=true: supplier cert in markdown report
    const resultWithSuppliers = (await handler(
      { include_suppliers: true },
      extra,
    )) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: {
        certifications: Array<{
          canonical_name: string;
          holder?: string;
          supplier_name?: string;
        }>;
      };
    };

    expect(resultWithSuppliers.content[0].text).toContain(
      'Supplier Certifications',
    );
    expect(resultWithSuppliers.structuredContent.certifications[0].holder).toBe(
      'supplier',
    );
    expect(
      resultWithSuppliers.structuredContent.certifications[0].supplier_name,
    ).toBe('example-datacentre london docklands');

    // Reset chain mock indices for second call
    vi.clearAllMocks();
    mocks.resetFromIndex();

    // Reconfigure chains for the second invocation
    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 9001',
        },
      ],
      [
        {
          canonical_name: 'iso 9001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: {
            holder: 'supplier',
            supplier_name: 'example-datacentre london docklands',
            version: '2015',
          },
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    // Without include_suppliers (default false): no supplier section
    const resultWithout = (await handler({}, extra)) as {
      content: Array<{ type: string; text: string }>;
    };

    expect(resultWithout.content[0].text).not.toContain(
      'Supplier Certifications',
    );
  });

  // 3. Unset holder (metadata empty {}): excluded by strict-holder gate
  it('excludes mentions with unset holder (empty metadata)', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'cyber essentials',
        },
      ],
      [
        {
          canonical_name: 'cyber essentials',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: {},
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    const result = (await handler({}, extra)) as {
      structuredContent: {
        certifications: Array<{
          canonical_name: string;
          holder?: string;
        }>;
      };
    };

    // The cert appears in the report (it has an entity_relationships 'holds'
    // row) but has NO holder assigned since metadata.holder is absent and the
    // holderMap skips it (lines 304-306 continue when not 'self'|'supplier').
    // Guard against vacuous-pass: the handler must return exactly one cert
    // entry before we can meaningfully assert on its holder field.
    expect(result.structuredContent.certifications).toHaveLength(1);
    expect(result.structuredContent.certifications[0].holder).toBeUndefined();
  });

  // 4. Bogus holder value (e.g. 'unknown'): rejected at line 303-306
  it('rejects bogus holder value in metadata (e.g. "unknown")', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 14001',
        },
      ],
      [
        {
          canonical_name: 'iso 14001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: { holder: 'unknown', version: '2015' },
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    const result = (await handler({}, extra)) as {
      structuredContent: {
        certifications: Array<{
          canonical_name: string;
          holder?: string;
        }>;
      };
    };

    // holderMap should not contain an entry for this cert because
    // 'unknown' !== 'self' && 'unknown' !== 'supplier' → continue
    expect(result.structuredContent.certifications).toHaveLength(1);
    expect(result.structuredContent.certifications[0].holder).toBeUndefined();
  });

  // 5. Mixed per-cert: one self mention + one supplier mention for same canonical_name
  //    The tool merges metadata from multiple mentions (later overwrites).
  //    The holderMap picks up the LAST merged metadata.holder value.
  it('aggregation with mixed self+supplier mentions picks last metadata value', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 27001',
        },
      ],
      [
        // First mention: holder='self'
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: { holder: 'self', version: '2022' },
          content_item_id: UUID_CONTENT_1,
        },
        // Second mention: holder='supplier' — metadata merge overwrites holder
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: {
            holder: 'supplier',
            supplier_name: 'acme hosting',
          },
          content_item_id: UUID_CONTENT_2,
        },
      ],
    );

    const result = (await handler({ include_suppliers: true }, extra)) as {
      structuredContent: {
        certifications: Array<{
          canonical_name: string;
          holder?: string;
          supplier_name?: string;
        }>;
      };
    };

    // The second mention's metadata.holder='supplier' overwrites the first
    // during the metadata merge loop (line 268: existing.metadata[key] = value).
    // The holderMap then picks up 'supplier' from the merged entityData.
    expect(result.structuredContent.certifications).toHaveLength(1);
    const cert = result.structuredContent.certifications[0];
    expect(cert.holder).toBe('supplier');
    expect(cert.supplier_name).toBe('acme hosting');
  });

  // 6. Source-entity case mismatch: mixed-case still matches after lowercasing
  it('matches source_entity case-insensitively via BRANDING lowercase filter', async () => {
    const handler = mockServer.getHandler('get_certification_status')!;

    // The tool queries .eq('source_entity', orgNameLower) where
    // orgNameLower = BRANDING.organisationName.toLowerCase().
    // In the default branding config, organisationName = 'Knowledge Hub',
    // so source_entity in the DB must already be lowercase 'knowledge hub'
    // for the .eq() filter to match. This test verifies the tool sends the
    // lowercased query and gets results back.
    configureChains(
      [
        {
          source_entity: 'knowledge hub',
          target_entity: 'iso 27001',
        },
      ],
      [
        {
          canonical_name: 'iso 27001',
          entity_type: 'certification',
          entity_type_override: null,
          metadata: { holder: 'self' },
          content_item_id: UUID_CONTENT_1,
        },
      ],
    );

    const result = (await handler({}, extra)) as {
      content: Array<{ type: string; text: string }>;
      structuredContent: {
        certifications: Array<{ canonical_name: string; holder?: string }>;
      };
    };

    // Verify the query was sent with the lowercased org name
    expect(mocks.chain1.eq).toHaveBeenCalledWith(
      'source_entity',
      'knowledge hub',
    );

    // Cert should appear in the report
    expect(result.structuredContent.certifications).toHaveLength(1);
    expect(result.structuredContent.certifications[0].holder).toBe('self');
  });
});
