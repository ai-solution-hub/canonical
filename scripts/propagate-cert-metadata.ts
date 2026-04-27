#!/usr/bin/env bun
/**
 * Propagate certification metadata from richly-populated entity mentions
 * to empty mentions of the same certification.
 *
 * Context: The entity audit (docs/reference/entity-audit-s126.md, Section 6)
 * found that 8 certification mentions have rich metadata while 19 mentions
 * of the same certifications have empty metadata `{}`. This script propagates
 * metadata from rich to empty mentions, with holder awareness to avoid
 * cross-contaminating self-held vs supplier-held certifications.
 *
 * Holder logic:
 *   - example-datacentre content items → supplier certifications (holder: "supplier")
 *   - All other content items → self-held certifications (holder: "self")
 *   - Supplier mentions only receive: holder, supplier_name
 *   - Self-held mentions receive full metadata from the self-held source
 *
 * Usage:
 *   bun run scripts/propagate-cert-metadata.ts                # propagate all
 *   bun run scripts/propagate-cert-metadata.ts --dry-run      # preview without writing
 *   bun run scripts/propagate-cert-metadata.ts --limit 5      # process max 5
 *   bun run scripts/propagate-cert-metadata.ts --help         # show help
 */

import { createClient } from '@supabase/supabase-js';
import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';

// ── Env loading (handles worktrees) ────────────────────────────────────────

function loadEnv() {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) break;
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── Args ───────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    limit: { type: 'string', default: '0' },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/propagate-cert-metadata.ts [options]

Options:
  --limit N    Max mentions to update (0 = all eligible)
  --dry-run    Preview what would be updated without writing
  --help       Show this help
`);
  process.exit(0);
}

const LIMIT = parseInt(args.limit!, 10) || 0;
const DRY_RUN = args['dry-run']!;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Constants ──────────────────────────────────────────────────────────────

/** Certifications to skip entirely — see audit section 4 and section 6. */
const SKIP_CERTIFICATIONS = new Set([
  'Iso Certification', // Should be deleted (poorly normalised duplicate)
  'WCAG 2.1 AA', // Should be reclassified to standard, not certification
  'Scorm', // No rich source to propagate from
  'Climate Neutral Data Centre Certification', // No rich source to propagate from
  'DBS Basic Check', // No rich source to propagate from
]);

/** Metadata fields that can be propagated to self-held mentions. */
const SELF_HELD_FIELDS = [
  'holder',
  'issuing_body',
  'expiry_date',
  'date_obtained',
  'certificate_number',
  'scope',
  'notes',
  'version',
] as const;

/** Metadata fields that can be propagated to supplier-held mentions. */
const SUPPLIER_FIELDS = ['holder', 'supplier_name'] as const;

// ── Types ──────────────────────────────────────────────────────────────────

interface EntityMention {
  id: string;
  canonical_name: string;
  entity_type: string;
  metadata: Record<string, unknown> | null;
  content_item_id: string;
}

interface ContentItem {
  id: string;
  suggested_title: string | null;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Count non-null, non-empty metadata fields. */
function metadataRichness(metadata: Record<string, unknown> | null): number {
  if (!metadata) return 0;
  return Object.values(metadata).filter(
    (v) => v !== null && v !== undefined && v !== '',
  ).length;
}

/** Check if metadata is empty or effectively empty. */
function isMetadataEmpty(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return true;
  return metadataRichness(metadata) === 0;
}

/** Check if a content item title indicates example-datacentre (supplier) context. */
function isexample-datacentreContent(title: string | null): boolean {
  if (!title) return false;
  return title.toLowerCase().includes('example-datacentre');
}

/** Pick only specified fields from an object. */
function pickFields(
  source: Record<string, unknown>,
  fields: readonly string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null) {
      result[field] = source[field];
    }
  }
  return result;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Certification Metadata Propagation');
  console.log('='.repeat(60));
  console.log(`  Limit:   ${LIMIT || 'all'}`);
  console.log(`  Dry run: ${DRY_RUN}`);
  console.log();

  // 1. Fetch all certification entity mentions
  const { data: allMentions, error: mentionsError } = await supabase
    .from('entity_mentions')
    .select('id, canonical_name, entity_type, metadata, content_item_id')
    .eq('entity_type', 'certification')
    .order('canonical_name');

  if (mentionsError) {
    console.error('Failed to fetch entity mentions:', mentionsError.message);
    process.exit(1);
  }

  if (!allMentions || allMentions.length === 0) {
    console.log('No certification mentions found.');
    return;
  }

  console.log(`Found ${allMentions.length} certification mentions total.`);

  // 2. Fetch content item titles for holder context
  const contentItemIds = [
    ...new Set(allMentions.map((m) => m.content_item_id)),
  ];

  const { data: contentItems, error: contentError } = await supabase
    .from('content_items')
    .select('id, suggested_title')
    .in('id', contentItemIds);

  if (contentError) {
    console.error('Failed to fetch content items:', contentError.message);
    process.exit(1);
  }

  const titleMap = new Map<string, string | null>();
  for (const ci of (contentItems || []) as ContentItem[]) {
    titleMap.set(ci.id, ci.suggested_title);
  }

  // 3. Group mentions by canonical_name
  const groups = new Map<string, EntityMention[]>();
  for (const mention of allMentions as EntityMention[]) {
    const existing = groups.get(mention.canonical_name) || [];
    existing.push(mention);
    groups.set(mention.canonical_name, existing);
  }

  console.log(`Grouped into ${groups.size} distinct certifications.`);
  console.log();

  // 4. Process each group
  let propagated = 0;
  let skippedCert = 0;
  let skippedNoSource = 0;
  let skippedAlreadyRich = 0;
  let errors = 0;
  const details: string[] = [];

  for (const [certName, mentions] of groups) {
    // Skip certifications from the skip list
    if (SKIP_CERTIFICATIONS.has(certName)) {
      const reason =
        certName === 'Iso Certification'
          ? 'should be deleted'
          : certName === 'WCAG 2.1 AA'
            ? 'should be reclassified to standard'
            : 'no rich source to propagate from';
      console.log(
        `  SKIP: "${certName}" (${mentions.length} mentions) — ${reason}`,
      );
      skippedCert += mentions.length;
      continue;
    }

    // Separate mentions by holder context (example-datacentre = supplier, other = self)
    const selfHeldMentions = mentions.filter(
      (m) => !isexample-datacentreContent(titleMap.get(m.content_item_id)),
    );
    const supplierMentions = mentions.filter((m) =>
      isexample-datacentreContent(titleMap.get(m.content_item_id)),
    );

    // Find richest source for each holder type
    const richestSelfHeld = selfHeldMentions
      .filter((m) => !isMetadataEmpty(m.metadata))
      .sort(
        (a, b) => metadataRichness(b.metadata) - metadataRichness(a.metadata),
      )[0];

    const richestSupplier = supplierMentions
      .filter((m) => !isMetadataEmpty(m.metadata))
      .sort(
        (a, b) => metadataRichness(b.metadata) - metadataRichness(a.metadata),
      )[0];

    // Find empty mentions that need propagation
    const emptySelfHeld = selfHeldMentions.filter((m) =>
      isMetadataEmpty(m.metadata),
    );
    const emptySupplier = supplierMentions.filter((m) =>
      isMetadataEmpty(m.metadata),
    );

    const totalEmpty = emptySelfHeld.length + emptySupplier.length;

    if (totalEmpty === 0) {
      console.log(
        `  OK:   "${certName}" (${mentions.length} mentions) — all already have metadata`,
      );
      skippedAlreadyRich += mentions.length;
      continue;
    }

    console.log(
      `  PROC: "${certName}" (${mentions.length} mentions, ${totalEmpty} empty)`,
    );

    // Propagate to empty self-held mentions
    for (const mention of emptySelfHeld) {
      if (LIMIT > 0 && propagated >= LIMIT) break;

      const title = titleMap.get(mention.content_item_id) || '(unknown)';

      if (!richestSelfHeld) {
        console.log(`        SKIP (no self-held source): ${title}`);
        skippedNoSource++;
        continue;
      }

      const newMetadata = pickFields(
        richestSelfHeld.metadata!,
        SELF_HELD_FIELDS,
      );
      const sourceTitle =
        titleMap.get(richestSelfHeld.content_item_id) || '(unknown)';

      console.log(
        `        ${DRY_RUN ? 'WOULD PROPAGATE' : 'PROPAGATING'} → ${title}`,
      );
      console.log(
        `          Source: ${sourceTitle} (${Object.keys(newMetadata).join(', ')})`,
      );

      details.push(
        `${certName}: ${sourceTitle} → ${title} [${Object.keys(newMetadata).join(', ')}]`,
      );

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('entity_mentions')
          .update({ metadata: newMetadata })
          .eq('id', mention.id);

        if (updateError) {
          console.log(`          ERROR: ${updateError.message}`);
          errors++;
          continue;
        }
      }

      propagated++;
    }

    // Propagate to empty supplier mentions
    for (const mention of emptySupplier) {
      if (LIMIT > 0 && propagated >= LIMIT) break;

      const title = titleMap.get(mention.content_item_id) || '(unknown)';

      if (!richestSupplier) {
        // No supplier source — infer minimal supplier metadata
        // from example-datacentre context
        const supplierMetadata: Record<string, unknown> = {
          holder: 'supplier',
          supplier_name: 'example-datacentre',
        };

        console.log(
          `        ${DRY_RUN ? 'WOULD SET' : 'SETTING'} supplier defaults → ${title}`,
        );
        console.log(
          `          Fields: holder, supplier_name (inferred from example-datacentre context)`,
        );

        details.push(
          `${certName}: inferred supplier defaults → ${title} [holder, supplier_name]`,
        );

        if (!DRY_RUN) {
          const { error: updateError } = await supabase
            .from('entity_mentions')
            .update({ metadata: supplierMetadata })
            .eq('id', mention.id);

          if (updateError) {
            console.log(`          ERROR: ${updateError.message}`);
            errors++;
            continue;
          }
        }

        propagated++;
        continue;
      }

      const newMetadata = pickFields(
        richestSupplier.metadata!,
        SUPPLIER_FIELDS,
      );
      const sourceTitle =
        titleMap.get(richestSupplier.content_item_id) || '(unknown)';

      console.log(
        `        ${DRY_RUN ? 'WOULD PROPAGATE' : 'PROPAGATING'} → ${title}`,
      );
      console.log(
        `          Source: ${sourceTitle} (${Object.keys(newMetadata).join(', ')})`,
      );

      details.push(
        `${certName}: ${sourceTitle} → ${title} [${Object.keys(newMetadata).join(', ')}]`,
      );

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('entity_mentions')
          .update({ metadata: newMetadata })
          .eq('id', mention.id);

        if (updateError) {
          console.log(`          ERROR: ${updateError.message}`);
          errors++;
          continue;
        }
      }

      propagated++;
    }
  }

  // 5. Report results
  console.log();
  console.log('='.repeat(60));
  console.log('PROPAGATION COMPLETE');
  console.log('='.repeat(60));
  console.log(
    `  Propagated:           ${propagated}${DRY_RUN ? ' (dry run)' : ''}`,
  );
  console.log(`  Skipped (exclusion):  ${skippedCert}`);
  console.log(`  Skipped (no source):  ${skippedNoSource}`);
  console.log(`  Skipped (has data):   ${skippedAlreadyRich}`);
  console.log(`  Errors:               ${errors}`);
  console.log();

  if (details.length > 0) {
    console.log('Detail:');
    for (const d of details) {
      console.log(`  ${d}`);
    }
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
