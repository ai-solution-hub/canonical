#!/usr/bin/env bun
/**
 * migrate-legacy-ids-to-id-n.ts — Phase A backlog bare-digit ID migration.
 *
 * Migrates all legacy-format backlog item ids (e.g. `OPS-6`, `AST-S10-O1`,
 * `C2-PA5`) to bare-digit canonical format (e.g. `42`, `23`, `30`).
 *
 * TECH spec: docs/specs/legacy-id-migration/TECH.md §A.0..A.7
 * Mapping: docs/research/legacy-id-migration-mapping.md §3.2 + §A.0 drift rule
 *
 * Mapping data is also available as a companion inventory JSON:
 *   scripts/legacy-id-mapping.inventory.json
 *
 * Idempotent: running twice on already-migrated data is a no-op.
 *
 * Usage:
 *   bun scripts/migrate-legacy-ids-to-id-n.ts --dry-run   # print diff only
 *   bun scripts/migrate-legacy-ids-to-id-n.ts --apply     # apply in-place
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

// ── Types ────────────────────────────────────────────────────────────────────

export interface MigrationEntry {
  /** Legacy id key (e.g. "OPS-6"). */
  legacyId: string;
  /** Bare-digit target (e.g. "42"). */
  target: string;
  /** If true, prepend OPS-X.Y lineage note to `notes` field per §A.3. */
  lineagePrefix?: true;
  /** Cluster or standalone description for inventory purposes. */
  cluster: string;
  /** Engineering track. */
  track: string;
}

export interface BacklogItem {
  id: string;
  description: string;
  type: string;
  status: string;
  effort_estimate: string | null;
  priority: string;
  track: string;
  dependencies: string[];
  surfaced: string;
  notes: string | null;
  [key: string]: unknown;
}

export interface BacklogDocument {
  document_name: string;
  document_purpose: string;
  last_updated: string;
  related_documents: string[];
  items: BacklogItem[];
  [key: string]: unknown;
}

export interface MigrationResult {
  document: BacklogDocument;
  /** Legacy ids skipped because they are absent from the live data. */
  skipped: string[];
  /** Warning messages emitted during migration. */
  warnings: string[];
}

// ── Mapping table (§3.2 + §A.0 drift: AST-S3-O1/O2 absent) ──────────────────

/**
 * Build the canonical mapping from legacy id → migration entry.
 *
 * Per TECH §A.0 drift rule: AST-S3-O1 and AST-S3-O2 are absent from live data
 * (shipped/closed between mapping-doc snapshot and this spec). The mapping table
 * reflects the 42-item live reality, starting Cluster 1 at id 23.
 *
 * RLS-P9 removed from the backlog entirely (audit-confirmed-clean S243+S56,
 * Liam-ratified S58 ID-15.4) — slot 41 is vacated (non-compaction per OQ-A).
 *
 * Final post-migration backlog occupies: 17, 18, 23..40, 42..65
 * (17 and 18 are existing canonical items; 23..40 + 42..65 are the 42 migrated items).
 */
export function buildMapping(): ReadonlyMap<string, MigrationEntry> {
  const entries: MigrationEntry[] = [
    // ── Cluster 1 — ast-dataflow follow-ons (5 live items; AST-S3-O1/O2 absent per §A.0) ──
    // Targets start at 23 (21+22 vacated by absent AST-S3-O1/O2 — non-compaction choice)
    { legacyId: 'AST-S10-O1', target: '23', cluster: 'C1', track: 'ast-dataflow' },
    { legacyId: 'AST-S10-O2', target: '24', cluster: 'C1', track: 'ast-dataflow' },
    { legacyId: 'AST-S11-O1', target: '25', cluster: 'C1', track: 'ast-dataflow' },
    { legacyId: 'AST-S11-O2', target: '26', cluster: 'C1', track: 'ast-dataflow' },
    { legacyId: 'AST-S11-O3', target: '27', cluster: 'C1', track: 'ast-dataflow' },

    // ── Cluster 2 — Onboarding (5 items → 28..32) ──
    { legacyId: 'C1-T3-Settings-3', target: '28', cluster: 'C2', track: 'onboarding' },
    { legacyId: 'C1-DT-Settings-2', target: '29', cluster: 'C2', track: 'onboarding' },
    { legacyId: 'C2-PA5', target: '30', cluster: 'C2', track: 'onboarding' },
    { legacyId: 'C2-T3-Session-1', target: '31', cluster: 'C2', track: 'onboarding' },
    { legacyId: 'C4-DT-Guide-1', target: '32', cluster: 'C2', track: 'onboarding' },

    // ── Cluster 3 — Auth allowlist pair (2 items → 33..34) — dep target first ──
    { legacyId: 'OPS-29', target: '33', cluster: 'C3', track: 'authentication' },
    { legacyId: 'OPS-28', target: '34', cluster: 'C3', track: 'authentication' },

    // ── Cluster 4 — Auth design (2 items → 35..36) ──
    { legacyId: 'C1-DT-Login-1', target: '35', cluster: 'C4', track: 'authentication' },
    { legacyId: 'C1-DT-Login-2', target: '36', cluster: 'C4', track: 'authentication' },

    // ── Cluster 6 — Change Reports (3 items → 37..39) ──
    { legacyId: 'C3-DT-Digest-1', target: '37', cluster: 'C6', track: 'change-reporting' },
    { legacyId: 'C3-DT-Digest-2', target: '38', cluster: 'C6', track: 'change-reporting' },
    { legacyId: 'C3-DT-Digest-3', target: '39', cluster: 'C6', track: 'change-reporting' },

    // ── Cluster 7 — RLS-audit (1 item → 40; slot 41 vacated) ──
    // RLS-P8: spec_needed (unchanged). RLS-P9 removed — audit-confirmed-clean
    // S243+S56, Liam-ratified S58 — not worth tracking.
    { legacyId: 'RLS-P8', target: '40', cluster: 'C7', track: 'database' },

    // ── Standalone — 24 items (42..65) ──
    { legacyId: 'OPS-6', target: '42', cluster: 'standalone', track: 'database' },
    { legacyId: 'OPS-11', target: '43', cluster: 'standalone', track: 'database' },
    { legacyId: 'OPS-13', target: '44', cluster: 'standalone', track: 'database' },
    {
      legacyId: 'OPS-43.1',
      target: '45',
      cluster: 'standalone',
      track: 'database',
      lineagePrefix: true,
    },
    { legacyId: 'OPS-63', target: '46', cluster: 'standalone', track: 'database' },
    { legacyId: 'EVAL-2', target: '47', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'OPS-24', target: '48', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'OPS-27', target: '49', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'OPS-30', target: '50', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'OPS-33', target: '51', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'ENG-TAX-SIMPLIFY', target: '52', cluster: 'standalone', track: 'ai-integration' },
    { legacyId: 'PL-3', target: '53', cluster: 'standalone', track: 'bid-management' },
    { legacyId: 'C2-DT-Session-1', target: '54', cluster: 'standalone', track: 'bid-management' },
    { legacyId: 'C2-DT-Session-2', target: '55', cluster: 'standalone', track: 'bid-management' },
    { legacyId: 'C2-DT-BidDetail-1', target: '56', cluster: 'standalone', track: 'bid-management' },
    { legacyId: 'C2-DT-BidDetail-2', target: '57', cluster: 'standalone', track: 'bid-management' },
    { legacyId: 'C4-DT-ItemDetail-3', target: '58', cluster: 'standalone', track: 'browse' },
    { legacyId: 'OPS-25', target: '59', cluster: 'standalone', track: 'browse' },
    { legacyId: 'C8-Mobile-2', target: '60', cluster: 'standalone', track: 'mobile' },
    { legacyId: 'OPS-47', target: '61', cluster: 'standalone', track: 'ingestion' },
    { legacyId: 'OPS-59 (main)', target: '62', cluster: 'standalone', track: 'ingestion' },
    { legacyId: 'OPS-62', target: '63', cluster: 'standalone', track: 'cloud-run' },
    { legacyId: 'OPS-36', target: '64', cluster: 'standalone', track: 'documentation' },
    { legacyId: 'OPS-32', target: '65', cluster: 'standalone', track: 'testing' },
  ];

  return new Map(entries.map((e) => [e.legacyId, e]));
}

// ── Idempotence guard ────────────────────────────────────────────────────────

/** Regex matching legacy id formats that must be migrated. */
const LEGACY_ID_RE =
  /^(OPS-\d+(\.\d+)?(\s*\([^)]+\))?|AST-S\d+-O\d+|C\d+-(DT|T\d+|PA\d*|Mobile)-[A-Za-z0-9-]+|RLS-P\d+|ENG-TAX-SIMPLIFY|EVAL-\d+|PL-\d+)$/;

/**
 * Returns true if the document contains no legacy-format ids — i.e. the
 * migration has already been applied or the document has no legacy ids at all.
 */
export function isAlreadyMigrated(doc: BacklogDocument): boolean {
  return doc.items.every((item) => !LEGACY_ID_RE.test(item.id));
}

// ── Dependency rewriting ─────────────────────────────────────────────────────

/**
 * Rewrite dependency ids using the mapping. Ids not in the mapping are
 * returned unchanged (covers canonical ids, external references, etc.).
 */
export function rewriteDependencies(
  deps: string[],
  mapping: ReadonlyMap<string, MigrationEntry>,
): string[] {
  return deps.map((dep) => mapping.get(dep)?.target ?? dep);
}

// ── OPS-43.1 lineage prefix (§A.3) ──────────────────────────────────────────

/**
 * Prepend an OPS-X.Y lineage note to `notes` for items migrating from a
 * sub-decimal legacy id (e.g. `OPS-43.1`).
 *
 * Per §A.3: the prefix records the original id and its parent lineage.
 * Any existing notes content is appended after the prefix.
 */
export function applyLineagePrefix(item: BacklogItem, legacyId: string): BacklogItem {
  // Only applies to sub-decimal ids (OPS-43.1 shape)
  if (!/^OPS-\d+\.\d+$/.test(legacyId)) {
    return item;
  }

  const parentId = legacyId.replace(/\.\d+$/, '');
  const prefix = `Originally ${legacyId} — sub-decimal lineage of ${parentId} (SHIPPED, removed from backlog). Migrated S58 ID-15.3.`;

  const newNotes = item.notes ? `${prefix}\n${item.notes}` : prefix;
  return { ...item, notes: newNotes };
}

// ── Full document migration ──────────────────────────────────────────────────

/**
 * Apply the legacy-id migration to a backlog document.
 *
 * Idempotent: if `isAlreadyMigrated` returns true, the document is
 * returned unchanged with empty skipped/warnings arrays.
 *
 * Per §A.0: ids in the mapping doc that are absent from the live data are
 * logged as skipped (not an error). The mapping table already excludes
 * AST-S3-O1/O2 (the two confirmed absent ids).
 */
export function applyMigration(doc: BacklogDocument): MigrationResult {
  if (isAlreadyMigrated(doc)) {
    return { document: structuredClone(doc), skipped: [], warnings: [] };
  }

  const mapping = buildMapping();
  const skipped: string[] = [];
  const warnings: string[] = [];

  const migratedItems: BacklogItem[] = doc.items.map((item) => {
    const entry = mapping.get(item.id);

    if (!entry) {
      // Item id not in mapping.
      if (LEGACY_ID_RE.test(item.id)) {
        // Legacy-format id not in mapping — absent from live data or unknown.
        warnings.push(
          `[WARN] Legacy id "${item.id}" matches legacy pattern but has no mapping entry — left unchanged.`,
        );
        skipped.push(item.id);
      }
      // Canonical or unknown ids pass through unchanged.
      return { ...item, dependencies: rewriteDependencies(item.dependencies, mapping) };
    }

    // Apply migration.
    let migrated: BacklogItem = { ...item, id: entry.target };

    // Rewrite dependencies.
    migrated = { ...migrated, dependencies: rewriteDependencies(migrated.dependencies, mapping) };

    // Apply OPS-X.Y lineage prefix per §A.3.
    if (entry.lineagePrefix) {
      migrated = applyLineagePrefix(migrated, item.id);
    }

    return migrated;
  });

  return {
    document: { ...doc, items: migratedItems },
    skipped,
    warnings,
  };
}

// ── runMigration — file I/O wrapper ─────────────────────────────────────────

export interface RunMigrationOptions {
  backlogPath: string;
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Load the backlog JSON, apply the migration, and optionally write back.
 *
 * In dry-run mode, prints the result to stdout but does not write.
 * In apply mode, writes the migrated document in-place.
 */
export function runMigration(options: RunMigrationOptions): void {
  const { backlogPath, dryRun, verbose } = options;

  const raw = readFileSync(backlogPath, 'utf-8');
  const doc: BacklogDocument = JSON.parse(raw);

  const { document: migrated, skipped, warnings } = applyMigration(doc);

  for (const warning of warnings) {
    console.warn(warning);
  }

  if (skipped.length > 0) {
    console.log(`[SKIP] ${skipped.length} legacy id(s) absent from mapping: ${skipped.join(', ')}`);
  }

  if (isAlreadyMigrated(doc)) {
    if (verbose) {
      console.log('[INFO] Document is already migrated — no changes applied.');
    }
    return;
  }

  const output = JSON.stringify(migrated, null, 2) + '\n';

  if (dryRun) {
    console.log('[DRY-RUN] Migration result (not written):');
    console.log(output);
  } else {
    writeFileSync(backlogPath, output, 'utf-8');
    if (verbose) {
      console.log(`[APPLY] Migration applied: ${backlogPath}`);
    }
  }
}

// ── CLI entry point ──────────────────────────────────────────────────────────

function main(): void {
  const { values } = parseArgs({
    options: {
      input: {
        type: 'string',
        default: 'docs/reference/product-backlog.json',
      },
      'dry-run': { type: 'boolean', default: false },
      apply: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      'migrate-legacy-ids-to-id-n.ts — migrate backlog legacy ids to bare-digit format.\n\n' +
        'Usage:\n' +
        '  bun scripts/migrate-legacy-ids-to-id-n.ts [--input=path] [--dry-run] [--apply] [-v]\n\n' +
        'Options:\n' +
        '  --input     Path to product-backlog.json (default: docs/reference/product-backlog.json)\n' +
        '  --dry-run   Print migration result without writing (default)\n' +
        '  --apply     Apply migration in-place\n' +
        '  -v          Verbose output\n',
    );
    process.exit(0);
  }

  const inputPath = resolve(process.cwd(), values.input as string);

  const dryRun = values['dry-run'] as boolean;
  const applyMode = values['apply'] as boolean;

  if (!dryRun && !applyMode) {
    // Default to dry-run if neither flag given.
    runMigration({ backlogPath: inputPath, dryRun: true, verbose: true });
  } else {
    runMigration({ backlogPath: inputPath, dryRun, verbose: values.verbose as boolean });
  }
}

// Only run when executed directly (not imported by tests).
if (import.meta.main) {
  main();
}
