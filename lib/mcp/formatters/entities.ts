/**
 * Entity relationship formatters for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';
import { formatEntityDisplayName } from '@/lib/entities/entity-dedup';

// ---------------------------------------------------------------------------
// Entity relationships
// ---------------------------------------------------------------------------

export interface EntitySummaryResult {
  canonical_name: string;
  entity_type: string;
  mention_count: number;
  content_item_ids: string[];
  related_entities: Array<{ relationship: string; target?: string; source?: string }>;
}

export interface EntityRelationship {
  source_entity: string;
  relationship_type: string;
  target_entity: string;
  source_item_id: string;
  confidence: number;
}

export interface EntityOverview {
  total_entities: number;
  by_type: Record<string, number>;
  top_entities: Array<{ canonical_name: string; entity_type: string; mention_count: number }>;
}

export function formatEntitySummary(
  entityName: string | undefined,
  entityType: string | undefined,
  summaries: EntitySummaryResult[],
  relationships: EntityRelationship[],
): string {
  if (summaries.length === 0) {
    const filter = entityName
      ? `"${entityName}"${entityType ? ` (type: ${entityType})` : ''}`
      : entityType
        ? `type "${entityType}"`
        : 'the specified criteria';
    return `# Entity Relationships\n\nNo entities found matching ${filter}.`;
  }

  const lines: string[] = [
    '# Entity Relationships',
    '',
  ];

  for (const entity of summaries) {
    lines.push(`## ${formatEntityDisplayName(entity.canonical_name)}`);
    lines.push(`**Type:** ${entity.entity_type}`);
    lines.push(`**Mentions:** ${entity.mention_count}`);
    lines.push(`**Referenced in:** ${entity.content_item_ids.length} content item${entity.content_item_ids.length === 1 ? '' : 's'}`);

    if (entity.related_entities.length > 0) {
      lines.push('', '### Related Entities');
      for (const related of entity.related_entities) {
        const relLabel = related.relationship.replace(/_/g, ' ');
        const entityName = related.target ?? related.source ?? 'unknown';
        const direction = related.target ? `${relLabel} → ${entityName}` : `${entityName} → ${relLabel}`;
        lines.push(`- ${direction}`);
      }
    }

    lines.push('');
  }

  if (relationships.length > 0) {
    lines.push('## Relationships', '');
    lines.push('| Source | Relationship | Target | Confidence |');
    lines.push('|--------|-------------|--------|------------|');
    for (const rel of relationships) {
      const conf = Math.round(rel.confidence * 100);
      const relLabel = rel.relationship_type.replace(/_/g, ' ');
      lines.push(`| ${formatEntityDisplayName(rel.source_entity)} | ${relLabel} | ${formatEntityDisplayName(rel.target_entity)} | ${conf}% |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

export function formatEntityOverview(overview: EntityOverview): string {
  const lines: string[] = [
    '# Entity Overview',
    '',
    `**Total entities:** ${overview.total_entities}`,
    '',
    '## Entities by Type',
    '',
  ];

  const sortedTypes = Object.entries(overview.by_type).sort(([, a], [, b]) => b - a);
  for (const [type, count] of sortedTypes) {
    lines.push(`- **${type}:** ${count}`);
  }

  if (overview.top_entities.length > 0) {
    lines.push('', '## Top Entities', '');
    lines.push('| Entity | Type | Mentions |');
    lines.push('|--------|------|----------|');
    for (const entity of overview.top_entities) {
      lines.push(`| ${formatEntityDisplayName(entity.canonical_name)} | ${entity.entity_type} | ${entity.mention_count} |`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Certification status report
// ---------------------------------------------------------------------------

export interface CertificationReportEntry {
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, unknown>;
  expiry_status: string;
  mention_count: number;
  content_item_count: number;
  holder?: string;
  supplier_name?: string;
}

export interface CertificationReportData {
  certifications: CertificationReportEntry[];
  frameworks: CertificationReportEntry[];
  registrations: CertificationReportEntry[];
  summary: {
    total_certifications: number;
    valid: number;
    expiring_soon: number;
    expired: number;
    unknown: number;
  };
}

export function formatCertificationReport(
  data: CertificationReportData,
  includeSuppliers: boolean = false,
): string {
  const lines: string[] = ['# Certification Status Report', ''];

  // Summary line
  const s = data.summary;
  lines.push(
    `**Total:** ${s.total_certifications} | ` +
    `Valid: ${s.valid} | ` +
    `Expiring soon: ${s.expiring_soon} | ` +
    `Expired: ${s.expired} | ` +
    `Unknown: ${s.unknown}`,
  );
  lines.push('');

  // Separate self-held from supplier certifications
  const selfCerts = data.certifications.filter((c) => c.holder !== 'supplier');
  const supplierCerts = data.certifications.filter((c) => c.holder === 'supplier');

  // Certifications section
  if (selfCerts.length > 0) {
    lines.push(`## Certifications (${selfCerts.length} held)`, '');
    lines.push('| Certification | Version | Issuer | Obtained | Expires | Status |');
    lines.push('|---|---|---|---|---|---|');
    for (const cert of selfCerts) {
      const meta = cert.metadata;
      const version = (meta.version as string) ?? '';
      const issuer = (meta.issuing_body as string) ?? '';
      const obtained = formatDateUK((meta.date_obtained as string) ?? null);
      const expires = formatDateUK((meta.expiry_date as string) ?? null);
      const status = cert.expiry_status.replace(/_/g, ' ');
      lines.push(`| ${formatEntityDisplayName(cert.canonical_name)} | ${version} | ${issuer} | ${obtained} | ${expires} | ${status} |`);
    }
    lines.push('');
  }

  // Frameworks section
  if (data.frameworks.length > 0) {
    lines.push(`## Frameworks (${data.frameworks.length} active)`, '');
    lines.push('| Framework | Round | Status | Joined | Expires |');
    lines.push('|---|---|---|---|---|');
    for (const fw of data.frameworks) {
      const meta = fw.metadata;
      const round = (meta.round as string) ?? '';
      const status = (meta.status as string) ?? fw.expiry_status.replace(/_/g, ' ');
      const joined = formatDateUK((meta.date_joined as string) ?? null);
      const expires = formatDateUK((meta.expiry_date as string) ?? null);
      lines.push(`| ${formatEntityDisplayName(fw.canonical_name)} | ${round} | ${status} | ${joined} | ${expires} |`);
    }
    lines.push('');
  }

  // Registrations section
  if (data.registrations.length > 0) {
    lines.push(`## Registrations (${data.registrations.length})`, '');
    lines.push('| Registration | Number | Expires |');
    lines.push('|---|---|---|');
    for (const reg of data.registrations) {
      const meta = reg.metadata;
      const regNumber = (meta.registration_number as string) ?? '';
      const expires = formatDateUK((meta.expiry_date as string) ?? null);
      lines.push(`| ${formatEntityDisplayName(reg.canonical_name)} | ${regNumber} | ${expires} |`);
    }
    lines.push('');
  }

  // Evidence section
  const allEntries = [...selfCerts, ...data.frameworks, ...data.registrations];
  const evidenceEntries = allEntries.filter((e) => e.content_item_count > 0);
  if (evidenceEntries.length > 0) {
    lines.push('### Evidence', '');
    for (const entry of evidenceEntries) {
      lines.push(`- ${formatEntityDisplayName(entry.canonical_name)}: referenced in ${entry.content_item_count} content ${entry.content_item_count === 1 ? 'item' : 'items'}`);
    }
    lines.push('');
  }

  // Supplier certifications section
  if (includeSuppliers && supplierCerts.length > 0) {
    lines.push(`## Supplier Certifications (${supplierCerts.length})`, '');
    lines.push('| Certification | Supplier | Version | Expires | Status |');
    lines.push('|---|---|---|---|---|');
    for (const cert of supplierCerts) {
      const meta = cert.metadata;
      const supplier = cert.supplier_name ?? (meta.supplier_name as string) ?? '';
      const version = (meta.version as string) ?? '';
      const expires = formatDateUK((meta.expiry_date as string) ?? null);
      const status = cert.expiry_status.replace(/_/g, ' ');
      lines.push(`| ${formatEntityDisplayName(cert.canonical_name)} | ${supplier} | ${version} | ${expires} | ${status} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
