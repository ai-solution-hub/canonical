#!/usr/bin/env bun
/**
 * Roadmap JSON → MD reverse renderer — kh-prod-readiness-S39 W1 Phase 2.
 *
 * Reads `docs/reference/product-roadmap.json` (the JSON-authoritative
 * source post-Phase-2) and emits `docs/reference/product-roadmap.md` as
 * a generated artefact. Per `roadmap-conversion-approach.md` §6.1 step 5
 * the JSON is authoritative; this script + `scripts/roadmap-to-json.ts`
 * + the round-trip CI guard (`__tests__/docs/roadmap-roundtrip.test.ts`)
 * form the migration triad.
 *
 * Round-trip invariant (§5 in approach doc): the diff between
 *   render( parse(MD) ) and MD
 * must be whitespace-only after both sides are normalised (pipe-padding
 * collapsed, multi-blank lines collapsed, trailing newlines stripped).
 * Word-level diffs are failures.
 *
 * Schema source: `lib/validation/roadmap-schema.ts`.
 *
 * Usage:
 *   bun run scripts/roadmap-from-json.ts            # write MD from JSON
 *   bun run scripts/roadmap-from-json.ts --check    # dry-run; emit to stdout
 *
 * Exit codes:
 *   0 — MD emitted (or --check stream succeeded)
 *   1 — input JSON missing or schema validation failed
 *   2 — output write failed
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'node:util';
import {
  RoadmapSchema,
  type Roadmap,
  type RoadmapSection,
  type RoadmapItem,
  type ColumnSet,
} from '@/lib/validation/roadmap-schema';

const DEFAULT_INPUT = 'docs/reference/product-roadmap.json';
const DEFAULT_OUTPUT = 'docs/reference/product-roadmap.md';

interface CliFlags {
  input: string;
  output: string;
  check: boolean;
}

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      check: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(
      'roadmap-from-json.ts — emit product-roadmap.md from product-roadmap.json.\n',
    );
    process.exit(0);
  }
  return {
    input: values.input as string,
    output: values.output as string,
    check: Boolean(values.check),
  };
}

// ──────────────────────────────────────────
// Cell rendering helpers
// ──────────────────────────────────────────

function capitalise(s: string): string {
  if (s.length === 0) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function priorityCanonical(value: string): string {
  return capitalise(value);
}

function statusCanonical(value: string): string {
  return capitalise(value.replace('_', ' '));
}

function renderPriorityCell(item: RoadmapItem): string {
  if (item.priority_note != null && item.priority_note.length > 0) {
    return item.priority_note;
  }
  if (item.priority != null) return priorityCanonical(item.priority);
  return '';
}

function renderStatusCell(item: RoadmapItem): string {
  if (item.status_note != null && item.status_note.length > 0) {
    return item.status_note;
  }
  if (item.status != null) return statusCanonical(item.status);
  return '';
}

const HEADERS_BY_COLUMNSET: Record<ColumnSet, string[]> = {
  item_desc_owner_effort_status: [
    '#',
    'Item',
    'Description',
    'Owner',
    'Effort',
    'Status',
  ],
  item_desc_effort_priority: ['#', 'Item', 'Description', 'Effort', 'Priority'],
  phase_desc_effort_priority: [
    '#',
    'Phase',
    'Description',
    'Effort',
    'Priority',
  ],
  item_desc_effort_severity: ['#', 'Item', 'Description', 'Effort', 'Severity'],
  item_desc_priority_status: ['#', 'Item', 'Description', 'Priority', 'Status'],
  item_desc_effort_priority_status: [
    '#',
    'Item',
    'Description',
    'Effort',
    'Priority',
    'Status',
  ],
};

function rowCells(item: RoadmapItem, columnSet: ColumnSet): string[] {
  const id = item.id;
  const titleOrPhase =
    columnSet === 'phase_desc_effort_priority' &&
    item.phase_label != null &&
    item.phase_label.length > 0
      ? item.phase_label
      : item.title;
  switch (columnSet) {
    case 'item_desc_owner_effort_status':
      return [
        id,
        titleOrPhase,
        item.description,
        item.owner ?? '',
        item.effort_estimate ?? '',
        renderStatusCell(item),
      ];
    case 'item_desc_effort_priority':
      return [
        id,
        titleOrPhase,
        item.description,
        item.effort_estimate ?? '',
        renderPriorityCell(item),
      ];
    case 'phase_desc_effort_priority':
      return [
        id,
        titleOrPhase,
        item.description,
        item.effort_estimate ?? '',
        renderPriorityCell(item),
      ];
    case 'item_desc_effort_severity':
      return [
        id,
        titleOrPhase,
        item.description,
        item.effort_estimate ?? '',
        item.severity ?? '',
      ];
    case 'item_desc_priority_status':
      return [
        id,
        titleOrPhase,
        item.description,
        renderPriorityCell(item),
        renderStatusCell(item),
      ];
    case 'item_desc_effort_priority_status':
      return [
        id,
        titleOrPhase,
        item.description,
        item.effort_estimate ?? '',
        renderPriorityCell(item),
        renderStatusCell(item),
      ];
  }
}

// ──────────────────────────────────────────
// Table rendering
//
// Auto-pad each column to the max content width seen across header +
// rows. Round-trip diff strategy normalises pipe-padding so the chosen
// padding is irrelevant to the test — it only affects readability of the
// generated MD. We keep one space either side of every cell, matching
// the source convention.
// ──────────────────────────────────────────

function renderTable(section: RoadmapSection): string {
  if (section.items.length === 0) return '';
  const headers = HEADERS_BY_COLUMNSET[section.table_columns];
  const dataRows = section.items.map((item) =>
    rowCells(item, section.table_columns),
  );
  const widths = headers.map((header, col) => {
    let max = header.length;
    for (const row of dataRows) {
      const cell = row[col] ?? '';
      max = Math.max(max, cell.length);
    }
    return max;
  });
  function pad(value: string, col: number): string {
    return value + ' '.repeat(Math.max(0, widths[col] - value.length));
  }
  const lines: string[] = [];
  lines.push('| ' + headers.map((h, c) => pad(h, c)).join(' | ') + ' |');
  lines.push('| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |');
  for (const row of dataRows) {
    lines.push(
      '| ' + row.map((cell, c) => pad(cell ?? '', c)).join(' | ') + ' |',
    );
  }
  return lines.join('\n');
}

// ──────────────────────────────────────────
// Section rendering
// ──────────────────────────────────────────

function renderSection(section: RoadmapSection): string {
  const out: string[] = [];
  const heading =
    section.parent_id == null
      ? '## ' + section.id + '. ' + section.title
      : '### ' + section.id + ' ' + section.title;
  out.push(heading);
  out.push('');
  if (section.narrative != null && section.narrative.trim().length > 0) {
    out.push(section.narrative.trim());
    out.push('');
  }
  const table = renderTable(section);
  if (table.length > 0) {
    out.push(table);
    out.push('');
  }
  return out.join('\n');
}

// ──────────────────────────────────────────
// Roadmap rendering — orchestration
//
// Layout (per source convention):
//   # Knowledge Hub Roadmap
//   <blank>
//   <document_purpose preamble>
//   <blank>
//   ---
//   <blank>
//   ## 1. Title
//   <section content>
//   ---
//   ## 2. Title
//   ...
//
// `---` separators precede every H2 except the first. H3 sub-sections
// are not preceded by `---`.
// ──────────────────────────────────────────

function renderRoadmap(roadmap: Roadmap): string {
  const out: string[] = [];
  out.push('# Knowledge Hub Roadmap');
  out.push('');
  out.push(roadmap.document_purpose.trim());
  out.push('');
  out.push('---');
  out.push('');
  let firstH2 = true;
  for (const section of roadmap.sections) {
    if (section.parent_id == null) {
      if (!firstH2) {
        out.push('---');
        out.push('');
      }
      firstH2 = false;
    }
    out.push(renderSection(section));
  }
  return (
    out
      .join('\n')
      .replace(/\n{3,}$/g, '\n')
      .trimEnd() + '\n'
  );
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

function main(): void {
  const flags = parseCli();
  const inputPath = resolve(process.cwd(), flags.input);
  const outputPath = resolve(process.cwd(), flags.output);
  if (!existsSync(inputPath)) {
    console.error('roadmap-from-json: input not found: ' + inputPath);
    process.exit(1);
  }
  const raw = readFileSync(inputPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('roadmap-from-json: invalid JSON: ' + (err as Error).message);
    process.exit(1);
  }
  const validation = RoadmapSchema.safeParse(parsed);
  if (!validation.success) {
    console.error('roadmap-from-json: Zod validation failed:');
    console.error(JSON.stringify(validation.error.format(), null, 2));
    process.exit(1);
  }
  const md = renderRoadmap(validation.data);
  if (flags.check) {
    process.stdout.write(md);
    process.exit(0);
  }
  try {
    writeFileSync(outputPath, md, 'utf-8');
  } catch (err) {
    console.error('roadmap-from-json: write failed: ' + (err as Error).message);
    process.exit(2);
  }
  console.log(
    'roadmap-from-json: emitted ' +
      flags.output +
      ' (' +
      validation.data.sections.length +
      ' section(s); ' +
      validation.data.sections.reduce((acc, s) => acc + s.items.length, 0) +
      ' item(s)).',
  );
  process.exit(0);
}

main();
