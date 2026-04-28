import { NextResponse } from 'next/server';
import { getAuthenticatedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import {
  deriveExpiryStatus,
  type CertificationMetadata,
  type FrameworkMetadata,
  type RegistrationMetadata,
  type ExpiryStatus,
} from '@/lib/certification-status';
import { BRANDING } from '@/lib/client-config';

export const maxDuration = 30;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

interface CertificationEntry {
  canonical_name: string;
  entity_type: 'certification';
  mention_count: number;
  content_item_count: number;
  content_items: { id: string; title: string }[];
  holder: 'self' | 'supplier';
  supplier_name?: string;
  metadata: CertificationMetadata;
  expiry_status: ExpiryStatus;
}

interface FrameworkEntry {
  canonical_name: string;
  entity_type: 'framework';
  mention_count: number;
  content_item_count: number;
  content_items: { id: string; title: string }[];
  metadata: FrameworkMetadata;
  expiry_status: ExpiryStatus;
}

interface RegistrationEntry {
  canonical_name: string;
  entity_type: 'regulation';
  mention_count: number;
  content_item_count: number;
  content_items: { id: string; title: string }[];
  metadata: RegistrationMetadata;
  expiry_status: ExpiryStatus;
}

interface CertificationReport {
  certifications: CertificationEntry[];
  frameworks: FrameworkEntry[];
  registrations: RegistrationEntry[];
  summary: {
    total_certifications: number;
    valid: number;
    expiring_soon: number;
    expired: number;
    unknown: number;
  };
}

// ---------------------------------------------------------------------------
// GET /api/certifications
// ---------------------------------------------------------------------------

/**
 * GET /api/certifications — aggregate certification, framework, and
 * registration data from entity relationships and mentions.
 *
 * Auth: any authenticated user (read-only).
 */
export async function GET() {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // 1. Get all 'holds' relationships
    const { data: relationships, error: relsError } = await supabase
      .from('entity_relationships')
      .select('source_entity, target_entity, source_item_id')
      .eq('relationship_type', 'holds');

    if (relsError) {
      return NextResponse.json(
        { error: safeErrorMessage(relsError, 'Failed to fetch relationships') },
        { status: 500 },
      );
    }

    if (!relationships || relationships.length === 0) {
      const emptyReport: CertificationReport = {
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
      };
      return NextResponse.json(emptyReport);
    }

    // Filter to relationships where the source entity is the client org
    const orgNameLower = BRANDING.organisationName.toLowerCase();
    const orgRelationships = relationships.filter(
      (r) => r.source_entity.toLowerCase() === orgNameLower,
    );

    // Collect unique target entity names from filtered holds relationships
    const targetEntities = [
      ...new Set(orgRelationships.map((r) => r.target_entity)),
    ];

    if (targetEntities.length === 0) {
      const emptyReport: CertificationReport = {
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
      };
      return NextResponse.json(emptyReport);
    }

    // 2. Get entity_mentions for the target entities with metadata
    const { data: mentions, error: mentionsError } = await supabase
      .from('entity_mentions')
      .select(
        'canonical_name, entity_type, entity_type_override, content_item_id, metadata',
      )
      .in('canonical_name', targetEntities);

    if (mentionsError) {
      return NextResponse.json(
        {
          error: safeErrorMessage(
            mentionsError,
            'Failed to fetch entity mentions',
          ),
        },
        { status: 500 },
      );
    }

    // 3. Get content item titles for evidence links
    const contentItemIds = [
      ...new Set((mentions ?? []).map((m) => m.content_item_id)),
    ];

    let contentItems: { id: string; title: string }[] = [];
    const warnings: string[] = [];
    if (contentItemIds.length > 0) {
      const { data: items, error: itemsError } = await supabase
        .from('content_items')
        .select('id, title')
        .in('id', contentItemIds);
      if (itemsError) {
        console.error(
          'Failed to fetch content item titles for certifications:',
          itemsError,
        );
        warnings.push(
          'Some evidence links may be missing titles: ' +
            safeErrorMessage(itemsError, 'content item title fetch failed'),
        );
      }
      contentItems = items ?? [];
    }

    const contentItemMap = new Map(contentItems.map((ci) => [ci.id, ci.title]));

    // 4. Aggregate mentions by canonical_name
    interface MentionAgg {
      canonical_name: string;
      effective_type: string;
      mention_count: number;
      content_item_ids: Set<string>;
      metadata: Record<string, unknown>;
    }

    const mentionMap = new Map<string, MentionAgg>();

    for (const m of mentions ?? []) {
      const effectiveType = m.entity_type_override ?? m.entity_type;
      let agg = mentionMap.get(m.canonical_name);
      if (!agg) {
        agg = {
          canonical_name: m.canonical_name,
          effective_type: effectiveType,
          mention_count: 0,
          content_item_ids: new Set(),
          metadata: {},
        };
        mentionMap.set(m.canonical_name, agg);
      }
      agg.mention_count++;
      agg.content_item_ids.add(m.content_item_id);

      // Merge metadata — later mentions with metadata override earlier ones
      if (
        m.metadata &&
        typeof m.metadata === 'object' &&
        Object.keys(m.metadata as object).length > 0
      ) {
        agg.metadata = {
          ...agg.metadata,
          ...(m.metadata as Record<string, unknown>),
        };
      }
    }

    // 5. Build report entries
    const certifications: CertificationEntry[] = [];
    const supplierCertifications: CertificationEntry[] = [];
    const frameworks: FrameworkEntry[] = [];
    const registrations: RegistrationEntry[] = [];

    for (const agg of mentionMap.values()) {
      const contentItemList = Array.from(agg.content_item_ids).map((id) => ({
        id,
        title: contentItemMap.get(id) ?? 'Unknown',
      }));

      const metadata = agg.metadata as Record<string, unknown>;
      const expiryDate = metadata.expiry_date as string | undefined;
      const expiryStatus = deriveExpiryStatus(expiryDate);

      if (agg.effective_type === 'certification') {
        const holder = metadata.holder as 'self' | 'supplier' | undefined;

        // Skip certifications where holder is not explicitly set — avoids
        // surfacing false positives from legacy data lacking metadata.holder
        if (!holder) continue;

        const entry: CertificationEntry = {
          canonical_name: agg.canonical_name,
          entity_type: 'certification',
          mention_count: agg.mention_count,
          content_item_count: agg.content_item_ids.size,
          content_items: contentItemList,
          holder,
          metadata: metadata as unknown as CertificationMetadata,
          expiry_status: expiryStatus,
        };

        if (metadata.supplier_name) {
          entry.supplier_name = metadata.supplier_name as string;
        }

        if (holder === 'supplier') {
          supplierCertifications.push(entry);
        } else {
          certifications.push(entry);
        }
      } else if (agg.effective_type === 'framework') {
        frameworks.push({
          canonical_name: agg.canonical_name,
          entity_type: 'framework',
          mention_count: agg.mention_count,
          content_item_count: agg.content_item_ids.size,
          content_items: contentItemList,
          metadata: metadata as unknown as FrameworkMetadata,
          expiry_status: expiryStatus,
        });
      } else if (agg.effective_type === 'regulation') {
        registrations.push({
          canonical_name: agg.canonical_name,
          entity_type: 'regulation',
          mention_count: agg.mention_count,
          content_item_count: agg.content_item_ids.size,
          content_items: contentItemList,
          metadata: metadata as unknown as RegistrationMetadata,
          expiry_status: expiryStatus,
        });
      }
    }

    // Combine self + supplier certifications for summary count
    const allCerts = [...certifications, ...supplierCertifications];

    // 6. Build summary
    const summary = {
      total_certifications: allCerts.length,
      valid: allCerts.filter((c) => c.expiry_status === 'valid').length,
      expiring_soon: allCerts.filter((c) => c.expiry_status === 'expiring_soon')
        .length,
      expired: allCerts.filter((c) => c.expiry_status === 'expired').length,
      unknown: allCerts.filter((c) => c.expiry_status === 'unknown').length,
    };

    const report: CertificationReport = {
      certifications: [...certifications, ...supplierCertifications],
      frameworks,
      registrations,
      summary,
    };

    if (warnings.length > 0) {
      return NextResponse.json({ ...report, warnings });
    }
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch certification data') },
      { status: 500 },
    );
  }
}
