#!/usr/bin/env bun
/**
 * Roadmap §3 restructure migration script — WP4 (kh-prod-readiness-S50 Wave A.2).
 *
 * Flattens the AI Evaluation Pathway umbrella section (§3) so its sub-sections
 * §3.1–§3.7 (§3.6 vacant) become top-level sections. Renumbers other top-level
 * sections to maintain numeric contiguity. Cascades per-item id and section_id.
 *
 * Mapping table (from TECH §4):
 *   "3"   (umbrella) → removed
 *   "3.1" → "3"   (Pass 2 improvements)
 *   "3.2" → "4"   (Phase 2 outstanding)
 *   "3.3" → "5"   (Regression Infrastructure)
 *   "3.4" → "6"   (Human-in-the-Loop)
 *   "3.5" → "7"   (Full Coverage)
 *   "3.7" → "8"   (AI Telemetry)
 *   "4"   → "9"   (Bid Workflow & Templates)
 *   "5"   → "10"  (Document Control)
 *   "8"   → "11"  (E2E Test Expansion)
 *   "9"   → "12"  (Codebase Health)
 *   "11"  → "13"  (Context Graph Phase 5)
 *
 * Idempotent: running twice produces no further diff (second run is a no-op).
 *
 * Usage:
 *   bun run scripts/migrate-roadmap-section-3.ts            # apply in-place
 *   bun run scripts/migrate-roadmap-section-3.ts --dry-run  # print diff only
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const DEFAULT_PATH = 'docs/reference/product-roadmap.json';

// ──────────────────────────────────────────
// Mapping table: old section top-level id → new top-level id
// ──────────────────────────────────────────

/**
 * Maps an old section root id to its new id.
 * Only covers sections that exist in the current roadmap JSON.
 * Section ids not in this map are kept unchanged.
 */
const SECTION_ID_MAP: Record<string, string> = {
  // §3 sub-sections promoted to top level
  '3.1': '3',
  '3.2': '4',
  '3.3': '5',
  '3.4': '6',
  '3.5': '7',
  '3.7': '8',
  // Former top-level sections shifted to close gaps
  '4': '9',
  '5': '10',
  '8': '11',
  '9': '12',
  '11': '13',
};

// The umbrella §3 section is dropped (not remapped).
const UMBRELLA_ID = '3';

// ──────────────────────────────────────────
// Core transformation
// ──────────────────────────────────────────

interface RoadmapItem {
  id: string;
  section_id: string;
  [key: string]: unknown;
}

interface RoadmapSection {
  id: string;
  parent_id: string | null;
  number: string;
  items: RoadmapItem[];
  [key: string]: unknown;
}

interface Roadmap {
  sections: RoadmapSection[];
  [key: string]: unknown;
}

/**
 * Derive the new section id for a given old section id.
 *
 * For top-level sections (e.g. "4"), looks up SECTION_ID_MAP directly.
 * For sub-sections (e.g. "4.1"), splits on ".", maps the prefix, and
 * reconstructs: "4.1" → split: ["4","1"] → prefix "4" maps to "9" → "9.1".
 * For items of sub-sections (e.g. "4.1.1"), maps the first two segments.
 */
function mapSectionId(oldId: string): string {
  // Direct lookup for top-level sections and §3.x sub-sections
  if (SECTION_ID_MAP[oldId] !== undefined) {
    return SECTION_ID_MAP[oldId];
  }

  // Multi-segment ids: find the longest matching prefix
  const parts = oldId.split('.');
  // Try progressively shorter prefixes from longest to shortest
  for (let depth = parts.length - 1; depth >= 1; depth--) {
    const prefix = parts.slice(0, depth).join('.');
    if (SECTION_ID_MAP[prefix] !== undefined) {
      const newPrefix = SECTION_ID_MAP[prefix];
      const rest = parts.slice(depth).join('.');
      return `${newPrefix}.${rest}`;
    }
  }

  // No mapping found — return unchanged
  return oldId;
}

/**
 * Idempotence guard: detect whether the roadmap has already been migrated.
 *
 * The migration is complete (already applied) when there is NO section
 * with the old umbrella structure: id="3", parent_id=null, and at least
 * one child section with parent_id="3".
 *
 * This is the single reliable signal because:
 *   - After migration, id="3" belongs to the promoted §3.1 section
 *     which has zero sub-sections with parent_id="3".
 *   - If the umbrella §3 still exists with children, migration needed.
 */
function isAlreadyMigrated(roadmap: Roadmap): boolean {
  const hasUmbrellaWithChildren =
    roadmap.sections.some((s) => s.id === UMBRELLA_ID && s.parent_id === null) &&
    roadmap.sections.some((s) => s.parent_id === UMBRELLA_ID);
  return !hasUmbrellaWithChildren;
}

/**
 * Apply the §3 restructure migration to a roadmap object.
 *
 * Mutates and returns the input (deep-cloned before calling from main).
 * Safe to call on already-migrated data — returns unchanged.
 */
export function applyRoadmapSection3Migration(roadmap: Roadmap): Roadmap {
  if (isAlreadyMigrated(roadmap)) {
    return roadmap;
  }

  // Step 1: Remove the umbrella §3 section.
  roadmap.sections = roadmap.sections.filter(
    (s) => !(s.id === UMBRELLA_ID && s.parent_id === null),
  );

  // Step 2: For each remaining section, apply id / parent_id / number remapping.
  for (const section of roadmap.sections) {
    const newId = mapSectionId(section.id);
    const oldId = section.id;

    if (newId !== oldId) {
      section.id = newId;
      section.number = newId; // number mirrors id
    }

    // Update parent_id: if parent was "3" (umbrella, now removed), set null.
    // Otherwise remap the parent_id through the same mapping.
    if (section.parent_id === UMBRELLA_ID) {
      section.parent_id = null;
    } else if (section.parent_id !== null) {
      section.parent_id = mapSectionId(section.parent_id);
    }

    // Step 3: Cascade item ids and section_id within this section.
    for (const item of section.items) {
      item.id = mapSectionId(item.id);
      item.section_id = section.id; // always mirrors the section's new id
    }
  }

  // Step 4: Sort sections to maintain a consistent, ascending id order.
  // Top-level first, then sub-sections, with numeric sort within each tier.
  roadmap.sections.sort((a, b) => {
    const aParts = a.id.split('.').map(Number);
    const bParts = b.id.split('.').map(Number);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av !== bv) return av - bv;
    }
    return 0;
  });

  return roadmap;
}

// ──────────────────────────────────────────
// CLI entry point
// ──────────────────────────────────────────

function main(): void {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: DEFAULT_PATH },
      'dry-run': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      'migrate-roadmap-section-3.ts — flatten §3 sub-sections into top-level sections.\n\n' +
        'Usage:\n' +
        '  bun run scripts/migrate-roadmap-section-3.ts [--input=path] [--dry-run]\n',
    );
    process.exit(0);
  }

  const inputPath = resolve(process.cwd(), values.input as string);
  const raw = readFileSync(inputPath, 'utf-8');
  const roadmap: Roadmap = JSON.parse(raw);

  const result = applyRoadmapSection3Migration(roadmap);
  const output = JSON.stringify(result, null, 2) + '\n';

  if (values['dry-run']) {
    console.log(output);
  } else {
    writeFileSync(inputPath, output, 'utf-8');
    console.log(`Migration applied: ${inputPath}`);
  }
}

// Only run when executed directly (not imported by tests)
if (import.meta.main) {
  main();
}
