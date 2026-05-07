#!/usr/bin/env bun
/**
 * Roadmap MD → JSON converter — kh-prod-readiness-S38 W5 Phase 1 scaffold.
 *
 * Phase 1 scope (this commit):
 *   - Pre-flight: invoke the shipped-framing detector and abort if findings exist.
 *   - Read `docs/reference/product-roadmap.md`.
 *   - Tokenise H2 / H3 to build the section tree (parent/child nesting).
 *   - Extract pre-table narrative per section (Item 1 ratification —
 *     `narrative: string | null`).
 *   - Extract markdown tables row-by-row; classify columns into one of
 *     six `ColumnSet` flavours; build `RoadmapItem[]` per section.
 *   - Run regex sweeps on each item description to populate
 *     `cross_doc_links[]`, `session_refs[]`, `commit_refs[]`,
 *     `depends_on[]`, `blocks[]`, `coordinates_with[]` (Item 6 hybrid
 *     parsing — high-confidence patterns only).
 *   - Validate the assembled object against `RoadmapSchema` (Zod).
 *   - Emit pretty-printed JSON to `docs/reference/product-roadmap.json`
 *     UNLESS `--check` is passed (validation-only mode for CI).
 *
 * Deferred to S39+ (NOT in this scaffold):
 *   - Round-trip verifier (`scripts/roadmap-from-json.ts`) re-rendering
 *     MD from JSON; diff guard (`__tests__/docs/roadmap-roundtrip.test.ts`).
 *   - `bun run roadmap:render` package.json wrapper.
 *   - `/update-docs` skill update (edit-JSON / regen-MD workflow).
 *   - `lib/docs/tracked-reference-docs.ts` switch from `.md` to `.json`.
 *   - Freshness verifier on JSON `last_updated` field.
 *   - Per-columnSet field mapping (priority enum, status enum,
 *     effort_estimate trimming) — Phase 2 IMPL once round-trip diff
 *     enforces correctness.
 *
 * Schema source: `lib/validation/roadmap-schema.ts` (S38 W5).
 * Decisions ratified: `.planning/.research/s37-housekeeping/roadmap-conversion-approach.md` §6.1.
 *
 * Usage:
 *   bun run scripts/roadmap-to-json.ts              # full convert + write JSON
 *   bun run scripts/roadmap-to-json.ts --check      # validate only, no write
 *   bun run scripts/roadmap-to-json.ts --skip-detector  # debug: skip pre-flight
 *
 * Exit codes:
 *   0 — JSON emitted (or --check passed)
 *   1 — shipped-framing detector found framings; operator must purge first
 *   2 — input file missing / unreadable
 *   3 — Zod validation failure on assembled object
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'node:util';
import {
  RoadmapSchema,
  type RoadmapSection,
  type RoadmapItem,
  type ColumnSet,
  type DocLink,
} from '@/lib/validation/roadmap-schema';

const DEFAULT_INPUT = 'docs/reference/product-roadmap.md';
const DEFAULT_OUTPUT = 'docs/reference/product-roadmap.json';
const DETECTOR_SCRIPT = 'scripts/detect-roadmap-shipped-framings.ts';

interface CliFlags {
  input: string;
  output: string;
  check: boolean;
  skipDetector: boolean;
}

function parseCli(): CliFlags {
  const { values } = parseArgs({
    options: {
      input: { type: 'string', default: DEFAULT_INPUT },
      output: { type: 'string', default: DEFAULT_OUTPUT },
      check: { type: 'boolean', default: false },
      'skip-detector': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
  });

  if (values.help) {
    console.log(
      'roadmap-to-json.ts (Phase 1 scaffold)\n\n' +
        'Convert docs/reference/product-roadmap.md to JSON validated by\n' +
        'lib/validation/roadmap-schema.ts. Round-trip diff + reverse-renderer\n' +
        'are deferred to S39+.\n',
    );
    process.exit(0);
  }

  return {
    input: values.input as string,
    output: values.output as string,
    check: Boolean(values.check),
    skipDetector: Boolean(values['skip-detector']),
  };
}

// ──────────────────────────────────────────
// Pre-flight: shipped-framing detector
//
// Uses Bun.spawnSync (Bun runtime built-in) — fixed-arg invocation, no
// shell expansion, no user-supplied input flows to the command line.
// ──────────────────────────────────────────

function runShippedFramingDetector(): void {
  const proc = Bun.spawnSync({
    cmd: ['bun', 'run', DETECTOR_SCRIPT, '--quiet'],
    cwd: process.cwd(),
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if (proc.exitCode === 0) return;
  if (proc.exitCode === 1) {
    console.error(
      '\nroadmap-to-json: shipped-framing detector found findings.\n' +
        '  See .planning/.research/roadmap-shipped-framings.txt for the\n' +
        '  purge list. Conversion blocked until findings are zero.',
    );
    process.exit(1);
  }
  console.error(
    'roadmap-to-json: detector failed with exit code ' + proc.exitCode,
  );
  process.exit(2);
}

// ──────────────────────────────────────────
// Section tokeniser
// ──────────────────────────────────────────

interface RawSection {
  id: string;
  parent_id: string | null;
  number: string;
  title: string;
  startLine: number;
  endLine: number; // exclusive
  body: string[]; // lines between this heading and the next (or EOF)
}

function tokeniseSections(content: string): RawSection[] {
  const lines = content.split('\n');
  const h2 = /^##\s+(\d+)\.\s+(.+?)\s*$/;
  const h3 = /^###\s+(\d+(?:\.\d+)*)\s+(.+?)\s*$/;
  const sections: RawSection[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let id: string | null = null;
    let title: string | null = null;
    let isH3 = false;
    const m3 = h3.exec(line);
    if (m3) {
      id = m3[1];
      title = m3[2];
      isH3 = true;
    } else {
      const m2 = h2.exec(line);
      if (m2) {
        id = m2[1];
        title = m2[2];
      }
    }
    if (id == null || title == null) continue;
    sections.push({
      id,
      parent_id: isH3 ? id.split('.').slice(0, -1).join('.') : null,
      number: id,
      title,
      startLine: i + 1, // 1-indexed
      endLine: -1, // patched below
      body: [],
    });
  }

  // Patch endLine + body slices.
  for (let s = 0; s < sections.length; s++) {
    const sec = sections[s];
    sec.endLine =
      s + 1 < sections.length ? sections[s + 1].startLine - 1 : lines.length;
    sec.body = lines.slice(sec.startLine, sec.endLine);
  }

  return sections;
}

// ──────────────────────────────────────────
// Narrative + spec_links extraction
// ──────────────────────────────────────────

const SPEC_LINK_RE =
  /(docs|\.planning)\/(specs|audits|plans|operations|runbooks|research|reference)\/[\w./§-]+/g;

function extractNarrativeAndSpecLinks(body: string[]): {
  narrative: string | null;
  spec_links: DocLink[];
} {
  // Narrative = body lines BEFORE the first table row (any line starting with '|').
  const tableStart = body.findIndex((l) => /^\s*\|/.test(l));
  const narrativeLines = (tableStart === -1 ? body : body.slice(0, tableStart))
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
  const narrative = narrativeLines.length > 0 ? narrativeLines : null;

  const spec_links: DocLink[] = [];
  if (narrative != null) {
    const matchSet = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = SPEC_LINK_RE.exec(narrative)) !== null) {
      const raw = m[0];
      if (matchSet.has(raw)) continue;
      matchSet.add(raw);
      const [path, anchor] = raw.split('#');
      spec_links.push({
        path,
        anchor: anchor ?? null,
        raw,
      });
    }
    SPEC_LINK_RE.lastIndex = 0;
  }
  return { narrative, spec_links };
}

// ──────────────────────────────────────────
// Table classification + row parsing
// ──────────────────────────────────────────

function classifyColumns(headerCells: string[]): ColumnSet | null {
  const norm = headerCells.map((c) => c.trim().toLowerCase());
  if (
    norm.length === 6 &&
    norm.includes('owner') &&
    norm.includes('effort') &&
    norm.includes('status')
  ) {
    return 'item_desc_owner_effort_status';
  }
  if (
    norm.length === 5 &&
    norm.includes('effort') &&
    norm.includes('priority') &&
    norm.includes('status')
  ) {
    return 'item_desc_effort_priority_status';
  }
  if (
    norm.length === 4 &&
    (norm.includes('item') || norm.includes('phase')) &&
    norm.includes('priority') &&
    norm.includes('status')
  ) {
    return 'item_desc_priority_status';
  }
  if (
    norm.length === 5 &&
    norm.includes('phase') &&
    norm.includes('effort') &&
    norm.includes('priority')
  ) {
    return 'phase_desc_effort_priority';
  }
  if (norm.length === 5 && norm.includes('item') && norm.includes('severity')) {
    return 'item_desc_effort_severity';
  }
  if (
    norm.length === 5 &&
    norm.includes('item') &&
    norm.includes('effort') &&
    norm.includes('priority')
  ) {
    return 'item_desc_effort_priority';
  }
  return null;
}

interface RawTable {
  header: string[];
  rows: string[][];
  columnSet: ColumnSet | null;
}

function parseTable(body: string[]): RawTable | null {
  const tableLines = body.filter((l) => /^\s*\|/.test(l));
  if (tableLines.length < 2) return null;
  const splitRow = (line: string): string[] =>
    line
      .replace(/^\s*\|/, '')
      .replace(/\|\s*$/, '')
      .split('|')
      .map((c) => c.trim());

  const header = splitRow(tableLines[0]);
  const rows = tableLines.slice(2).map(splitRow);
  const columnSet = classifyColumns(header);
  return { header, rows, columnSet };
}

// ──────────────────────────────────────────
// Item construction with regex sweeps
// ──────────────────────────────────────────

const SESSION_RE =
  /\b(?:kh-prod-readiness-)?S\d{1,3}(?:\s+[A-Z]\d?[-A-Za-z0-9.]*)?\b/g;
const COMMIT_RE = /`?\b[0-9a-f]{7,40}\b`?/g;
const SECTION_REF_RE = /§\d+(?:\.\d+){0,3}/g;
const D_REF_RE = /\bD-\d+\b/g;
const OPS_REF_RE = /\bOPS-\d+(?:\.\d+)?\b/g;

function uniq(arr: string[]): string[] {
  return Array.from(new Set(arr));
}

function sweepStructuredRefs(text: string): {
  depends_on: string[];
  cross_doc_links: DocLink[];
  session_refs: string[];
  commit_refs: string[];
} {
  const depends_on = uniq([
    ...(text.match(SECTION_REF_RE) ?? []),
    ...(text.match(D_REF_RE) ?? []),
    ...(text.match(OPS_REF_RE) ?? []),
  ]);
  const session_refs = uniq(text.match(SESSION_RE) ?? []);
  const commit_refs = uniq(
    (text.match(COMMIT_RE) ?? [])
      .map((s) => s.replace(/`/g, ''))
      .filter((s) => /^[0-9a-f]{7,40}$/.test(s)),
  );
  const cross_doc_links: DocLink[] = [];
  const seenPaths = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = SPEC_LINK_RE.exec(text)) !== null) {
    if (seenPaths.has(m[0])) continue;
    seenPaths.add(m[0]);
    const [path, anchor] = m[0].split('#');
    cross_doc_links.push({ path, anchor: anchor ?? null, raw: m[0] });
  }
  SPEC_LINK_RE.lastIndex = 0;
  return { depends_on, cross_doc_links, session_refs, commit_refs };
}

function buildItem(
  rawId: string,
  sectionId: string,
  cells: string[],
  columnSet: ColumnSet,
): RoadmapItem {
  // TODO(S39+): per-columnSet field mapping. Phase 1 scaffold returns a
  // skeleton item with structured-ref sweeps applied so the schema
  // validates, while leaving column-specific parsing (priority enum
  // mapping, status enum mapping, effort_estimate trimming) for the
  // round-trip-verified Phase 2 IMPL.
  const description = cells[1] ?? '';
  const refs = sweepStructuredRefs(description);
  return {
    id: rawId,
    section_id: sectionId,
    title: cells[0] ?? '',
    phase_label: columnSet === 'phase_desc_effort_priority' ? cells[0] : null,
    description,
    effort_estimate: null,
    priority: null,
    severity: null,
    status: null,
    status_note: null,
    owner: null,
    depends_on: refs.depends_on,
    blocks: [],
    coordinates_with: [],
    cross_doc_links: refs.cross_doc_links,
    session_refs: refs.session_refs,
    commit_refs: refs.commit_refs,
  };
}

// ──────────────────────────────────────────
// Section assembly
// ──────────────────────────────────────────

function assembleSection(raw: RawSection): RoadmapSection {
  const { narrative, spec_links } = extractNarrativeAndSpecLinks(raw.body);
  const table = parseTable(raw.body);
  const items: RoadmapItem[] = [];
  if (table != null && table.columnSet != null) {
    for (const row of table.rows) {
      const idCell = row[0]?.trim() ?? '';
      const idMatch = /^\d+(?:\.\d+)*/.exec(idCell);
      const id =
        idMatch != null
          ? idMatch[0]
          : raw.id + '.row' + (items.length + 1).toString();
      items.push(buildItem(id, raw.id, row.slice(1), table.columnSet));
    }
  }
  return {
    id: raw.id,
    parent_id: raw.parent_id,
    number: raw.number,
    title: raw.title,
    narrative,
    spec_links,
    owner: null,
    table_columns: table?.columnSet ?? 'item_desc_effort_priority',
    items,
  };
}

// ──────────────────────────────────────────
// Roadmap header extraction
// ──────────────────────────────────────────

function extractDate(content: string): string {
  const m = /Date:\s*(\d{4}-\d{2}-\d{2})/.exec(content);
  if (m) return m[1];
  const now = new Date();
  return now.toISOString().slice(0, 10);
}

function extractDocumentPurpose(content: string): string {
  const lines = content.split('\n').slice(0, 30);
  for (const line of lines) {
    if (line.startsWith('>') || line.startsWith('#')) continue;
    const trimmed = line.trim();
    if (trimmed.length > 30) return trimmed;
  }
  return 'Knowledge Hub product roadmap — forward-looking work only.';
}

// ──────────────────────────────────────────
// Main
// ──────────────────────────────────────────

function main(): void {
  const flags = parseCli();
  const inputPath = resolve(process.cwd(), flags.input);
  const outputPath = resolve(process.cwd(), flags.output);

  if (!existsSync(inputPath)) {
    console.error('roadmap-to-json: input not found: ' + inputPath);
    process.exit(2);
  }

  if (!flags.skipDetector) {
    runShippedFramingDetector();
  }

  const content = readFileSync(inputPath, 'utf-8');
  const sections = tokeniseSections(content).map(assembleSection);

  const roadmap = {
    document_name: 'Knowledge Hub Roadmap' as const,
    document_purpose: extractDocumentPurpose(content),
    date: extractDate(content),
    status: 'Active' as const,
    forward_looking_only: true as const,
    related_documents: ['state-of-the-product.md', 'product-backlog.json'],
    last_updated:
      'kh-prod-readiness-S38 W5 Phase 1 scaffold (initial conversion run)',
    sections,
  };

  const validation = RoadmapSchema.safeParse(roadmap);
  if (!validation.success) {
    console.error('roadmap-to-json: Zod validation failed.');
    console.error(JSON.stringify(validation.error.format(), null, 2));
    process.exit(3);
  }

  if (flags.check) {
    console.log(
      'roadmap-to-json: --check passed. ' +
        sections.length +
        ' section(s); ' +
        sections.reduce((acc, s) => acc + s.items.length, 0) +
        ' item(s).',
    );
    process.exit(0);
  }

  writeFileSync(
    outputPath,
    JSON.stringify(validation.data, null, 2) + '\n',
    'utf-8',
  );
  console.log(
    'roadmap-to-json: emitted ' +
      flags.output +
      ' (' +
      sections.length +
      ' section(s); ' +
      sections.reduce((acc, s) => acc + s.items.length, 0) +
      ' item(s)).',
  );
  process.exit(0);
}

main();
