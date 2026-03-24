import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ClientAttentionBridge } from '@/components/dashboard/client-attention-bridge';

// ---------------------------------------------------------------------------
// Mock fetch for ComplianceStatusSection + Supabase for ExpiringContentSection
// ---------------------------------------------------------------------------

const mockFetch = vi.fn();
const mockSupabaseSelect = vi.fn();

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: () => ({
      select: (...args: unknown[]) => {
        const result = mockSupabaseSelect(...args);
        return {
          is: () => ({
            not: () => ({
              lte: () => ({
                order: () => ({
                  limit: () => Promise.resolve(result),
                }),
              }),
            }),
          }),
        };
      },
    }),
  }),
}));

beforeEach(() => {
  vi.restoreAllMocks();
  mockFetch.mockReset();
  mockSupabaseSelect.mockReset();
  mockSupabaseSelect.mockReturnValue({ data: [], error: null });
  global.fetch = mockFetch;
});

// ---------------------------------------------------------------------------
// Default props
// ---------------------------------------------------------------------------

const defaultNeedsAttention = {
  governance_review_count: 0,
  unverified_count: 0,
  quality_flag_count: 0,
  stale_content_count: 0,
  expired_content_count: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ClientAttentionBridge', () => {
  it('renders NeedsAttentionSection with server-side data', () => {
    // Both client-side fetches return loading skeletons initially
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ certifications: [], frameworks: [], registrations: [], summary: { total_certifications: 0, valid: 0, expiring_soon: 0, expired: 0, unknown: 0 } }),
    });

    render(
      <ClientAttentionBridge
        needsAttention={{ ...defaultNeedsAttention, governance_review_count: 3 }}
        userRole="admin"
      />,
    );

    // NeedsAttentionSection should render with the governance count
    expect(screen.getByText(/Needs Attention/)).toBeDefined();
  });

  it('passes expiring cert count from ComplianceStatusSection to NeedsAttentionSection', async () => {
    // ComplianceStatusSection fetches /api/certifications
    mockFetch.mockImplementation(async (url: string) => {
      if (url === '/api/certifications') {
        return {
          ok: true,
          json: async () => ({
            certifications: [
              {
                canonical_name: 'ISO 27001',
                entity_type: 'certification',
                mention_count: 1,
                content_item_count: 1,
                content_items: [],
                holder: 'self',
                metadata: {
                  expiry_date: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString(),
                },
                expiry_status: 'expiring_soon',
              },
            ],
            frameworks: [],
            registrations: [],
            summary: {
              total_certifications: 1,
              valid: 0,
              expiring_soon: 1,
              expired: 0,
              unknown: 0,
            },
          }),
        };
      }
      // ExpiringContentSection fetches /api/items
      return {
        ok: true,
        json: async () => ({ items: [] }),
      };
    });

    render(
      <ClientAttentionBridge
        needsAttention={defaultNeedsAttention}
        userRole="admin"
      />,
    );

    // Wait for the client-side fetches to complete
    await waitFor(() => {
      expect(screen.getByText('Needs Attention (1)')).toBeDefined();
    });
  });

  it('passes expiring content count from ExpiringContentSection to NeedsAttentionSection', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    // ComplianceStatusSection uses fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        certifications: [],
        frameworks: [],
        registrations: [],
        summary: { total_certifications: 0, valid: 0, expiring_soon: 0, expired: 0, unknown: 0 },
      }),
    });

    // ExpiringContentSection now uses Supabase client directly
    mockSupabaseSelect.mockReturnValue({
      data: [
        { id: 'item-1', title: 'Test Item', expiry_date: futureDate, primary_domain: 'Security' },
        { id: 'item-2', title: 'Test Item 2', expiry_date: futureDate, primary_domain: 'HR' },
      ],
      error: null,
    });

    render(
      <ClientAttentionBridge
        needsAttention={defaultNeedsAttention}
        userRole="admin"
      />,
    );

    // Wait for the client-side fetches to complete — 2 expiring content items
    await waitFor(() => {
      expect(screen.getByText('Needs Attention (2)')).toBeDefined();
    });
  });

  it('combines server-side and client-side counts in the total', async () => {
    const futureDate = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

    // ComplianceStatusSection uses fetch
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        certifications: [],
        frameworks: [],
        registrations: [],
        summary: { total_certifications: 1, valid: 0, expiring_soon: 1, expired: 0, unknown: 0 },
      }),
    });

    // ExpiringContentSection uses Supabase client directly
    mockSupabaseSelect.mockReturnValue({
      data: [
        { id: 'item-1', title: 'Test Item', expiry_date: futureDate, primary_domain: null },
      ],
      error: null,
    });

    render(
      <ClientAttentionBridge
        needsAttention={{ ...defaultNeedsAttention, stale_content_count: 3 }}
        userRole="admin"
      />,
    );

    // 3 stale (server) + 1 cert (client) + 1 expiring content (client) = 5
    await waitFor(() => {
      expect(screen.getByText('Needs Attention (5)')).toBeDefined();
    });
  });

  it('passes userRole through to NeedsAttentionSection', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        certifications: [],
        frameworks: [],
        registrations: [],
        summary: { total_certifications: 0, valid: 0, expiring_soon: 0, expired: 0, unknown: 0 },
        items: [],
      }),
    });

    render(
      <ClientAttentionBridge
        needsAttention={{ ...defaultNeedsAttention, governance_review_count: 5 }}
        userRole="viewer"
      />,
    );

    // Viewer should not see governance reviews
    // The totalAttention for viewer is 0 (governance is hidden)
    await waitFor(() => {
      expect(
        screen.getByText('All clear — your knowledge base is in good shape.'),
      ).toBeDefined();
    });
  });
});
