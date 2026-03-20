/**
 * Entity relationship formatters for MCP tool responses.
 */

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
    lines.push(`## ${entity.canonical_name}`);
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
      lines.push(`| ${rel.source_entity} | ${relLabel} | ${rel.target_entity} | ${conf}% |`);
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
      lines.push(`| ${entity.canonical_name} | ${entity.entity_type} | ${entity.mention_count} |`);
    }
  }

  return lines.join('\n');
}
