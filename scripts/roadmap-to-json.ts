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
    norm.length === 6 &&
    norm.includes('effort') &&
    norm.includes('priority') &&
    norm.includes('status')
  ) {
    return 'item_desc_effort_priority_status';
  }
  if (
    norm.length === 5 &&
    (norm.includes('item') || norm.includes('phase')) &&
    norm.includes('priority') &&
    norm.includes('status') &&
    !norm.includes('effort')
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

/**
 * Item 6 hybrid-parsing — extract the text span following a `Blocks:` /
 * `Coordinates with` marker up to the next paragraph break, sentence
 * terminator at column boundary, or end of cell. Markdown bold wrapping
 * (`**Blocks:**`) is tolerated. Inner parentheticals are captured (so
 * `§6` references inside annotation parens get pulled into blocks/coords
 * with their parent — acceptable approximation for round-trip purposes
 * given description text already preserves the verbatim annotation).
 */
function captureNamedSpan(
  text: string,
  marker: 'Blocks?' | 'Coordinates with',
): string {
  const re = new RegExp(
    '\\*{0,2}\\b' + marker + ':?\\*{0,2}\\s+([\\s\\S]+?)(?:\\.\\s|\\.\\*\\*|$)',
    'i',
  );
  const m = re.exec(text);
  return m ? m[1] : '';
}

function tokensInSpan(span: string): string[] {
  return uniq([
    ...(span.match(SECTION_REF_RE) ?? []),
    ...(span.match(D_REF_RE) ?? []),
    ...(span.match(OPS_REF_RE) ?? []),
  ]);
}

function sweepStructuredRefs(text: string): {
  depends_on: string[];
  blocks: string[];
  coordinates_with: string[];
  cross_doc_links: DocLink[];
  session_refs: string[];
  commit_refs: string[];
} {
  const blocksSpan = captureNamedSpan(text, 'Blocks?');
  const coordsSpan = captureNamedSpan(text, 'Coordinates with');
  const blocks = tokensInSpan(blocksSpan);
  const coordinates_with = tokensInSpan(coordsSpan);
  const blocksSet = new Set(blocks);
  const coordsSet = new Set(coordinates_with);
  const allRefs = uniq([
    ...(text.match(SECTION_REF_RE) ?? []),
    ...(text.match(D_REF_RE) ?? []),
    ...(text.match(OPS_REF_RE) ?? []),
  ]);
  // depends_on excludes refs already attributed to blocks/coordinates_with.
  // Per §6.1 Item 6 the three relationship buckets are mutually exclusive.
  const depends_on = allRefs.filter(
    (ref) => !blocksSet.has(ref) && !coordsSet.has(ref),
  );
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
  return {
    depends_on,
    blocks,
    coordinates_with,
    cross_doc_links,
    session_refs,
    commit_refs,
  };
}

// ──────────────────────────────────────────
// Priority + status enum parsers
//
// Source MD cells contain canonical enum text ("Must", "Should", "Pending")
// AND editorial annotations ("Should (demoted from Must)", "Spec pending
// Liam OQ answers", "Blocked on bid-to-template linkage"). The parsers
// emit:
//   - canonical enum value when the cell prefix matches one of the
//     ratified enum spellings;
//   - `*_note: string` carrying the verbatim original cell text whenever
//     the cell text differs from the canonical capitalised enum form.
//
// The renderer prefers the note over the capitalised enum so round-trip
// preserves the original wording.
// ──────────────────────────────────────────

const PRIORITY_KEYWORDS = [
  'must',
  'should',
  'could',
  'future',
  'high',
  'medium',
  'low',
  'trigger',
] as const;

function canonicalCapitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function parsePriorityCell(cell: string | undefined): {
  priority: RoadmapItem['priority'];
  priority_note: string | null;
} {
  const trimmed = (cell ?? '').trim();
  if (trimmed.length === 0) return { priority: null, priority_note: null };
  const lc = trimmed.toLowerCase();
  for (const keyword of PRIORITY_KEYWORDS) {
    if (lc === keyword) return { priority: keyword, priority_note: null };
    if (lc.startsWith(keyword + ' ') || lc.startsWith(keyword + '(')) {
      return { priority: keyword, priority_note: trimmed };
    }
  }
  return { priority: null, priority_note: trimmed };
}

const STATUS_KEYWORDS: Array<{ enum: RoadmapItem['status']; match: RegExp }> = [
  { enum: 'spec_needed', match: /\bspec\s*(pending|needed)\b/i },
  { enum: 'in_progress', match: /\bin[\s_]?progress\b/i },
  { enum: 'imp_deferred', match: /\b(impl|implementation)\s+deferred\b/i },
  { enum: 'deferred', match: /\bdeferred\b/i },
  { enum: 'blocked', match: /\bblocked\b/i },
  { enum: 'pending', match: /\bpending\b/i },
];

function parseStatusCell(cell: string | undefined): {
  status: RoadmapItem['status'];
  status_note: string | null;
} {
  const trimmed = (cell ?? '').trim();
  if (trimmed.length === 0) return { status: null, status_note: null };
  for (const { enum: enumValue, match } of STATUS_KEYWORDS) {
    if (match.test(trimmed)) {
      const canonicalText = canonicalCapitalise(
        (enumValue ?? '').replace('_', ' '),
      );
      const note = trimmed === canonicalText ? null : trimmed;
      return { status: enumValue, status_note: note };
    }
  }
  return { status: null, status_note: trimmed };
}

// ──────────────────────────────────────────
// Per-columnSet cell mapping (Phase 2)
//
// `cells` arrives with the leading ID stripped (see assembleSection). Each
// columnSet variant lays out post-ID cells differently — this fan-out
// captures every variation seen in the audited 27-section corpus.
// ──────────────────────────────────────────

interface ColumnExtraction {
  title: string;
  phase_label: string | null;
  description: string;
  owner: string | null;
  effort_estimate: string | null;
  priority: RoadmapItem['priority'];
  priority_note: string | null;
  severity: string | null;
  status: RoadmapItem['status'];
  status_note: string | null;
}

function emptyExtraction(): ColumnExtraction {
  return {
    title: '',
    phase_label: null,
    description: '',
    owner: null,
    effort_estimate: null,
    priority: null,
    priority_note: null,
    severity: null,
    status: null,
    status_note: null,
  };
}

function blankToNull(value: string | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function extractCells(cells: string[], columnSet: ColumnSet): ColumnExtraction {
  const out = emptyExtraction();
  out.title = cells[0]?.trim() ?? '';
  out.description = cells[1] ?? '';
  switch (columnSet) {
    case 'item_desc_owner_effort_status': {
      out.owner = blankToNull(cells[2]);
      out.effort_estimate = blankToNull(cells[3]);
      const parsedStatus = parseStatusCell(cells[4]);
      out.status = parsedStatus.status;
      out.status_note = parsedStatus.status_note;
      break;
    }
    case 'item_desc_effort_priority': {
      out.effort_estimate = blankToNull(cells[2]);
      const parsedPriority = parsePriorityCell(cells[3]);
      out.priority = parsedPriority.priority;
      out.priority_note = parsedPriority.priority_note;
      break;
    }
    case 'phase_desc_effort_priority': {
      // Item 5 ratification — phase_label only populates when the source
      // row text uses the canonical "Phase N — Title" pattern. Mixed
      // sections (e.g. §3.7 with rows like "OPS-N — Tighten Zod ...")
      // surface in the same column but are not Phase rows; populating
      // phase_label with their non-Phase title is semantic noise.
      if (/^Phase\s+\d/i.test(out.title)) {
        out.phase_label = out.title;
      }
      out.effort_estimate = blankToNull(cells[2]);
      const parsedPriority = parsePriorityCell(cells[3]);
      out.priority = parsedPriority.priority;
      out.priority_note = parsedPriority.priority_note;
      break;
    }
    case 'item_desc_effort_severity': {
      out.effort_estimate = blankToNull(cells[2]);
      out.severity = blankToNull(cells[3]);
      break;
    }
    case 'item_desc_priority_status': {
      const parsedPriority = parsePriorityCell(cells[2]);
      out.priority = parsedPriority.priority;
      out.priority_note = parsedPriority.priority_note;
      const parsedStatus = parseStatusCell(cells[3]);
      out.status = parsedStatus.status;
      out.status_note = parsedStatus.status_note;
      break;
    }
    case 'item_desc_effort_priority_status': {
      out.effort_estimate = blankToNull(cells[2]);
      const parsedPriority = parsePriorityCell(cells[3]);
      out.priority = parsedPriority.priority;
      out.priority_note = parsedPriority.priority_note;
      const parsedStatus = parseStatusCell(cells[4]);
      out.status = parsedStatus.status;
      out.status_note = parsedStatus.status_note;
      break;
    }
  }
  return out;
}

function buildItem(
  rawId: string,
  sectionId: string,
  cells: string[],
  columnSet: ColumnSet,
): RoadmapItem {
  const fields = extractCells(cells, columnSet);
  const refs = sweepStructuredRefs(fields.description);
  return {
    id: rawId,
    section_id: sectionId,
    title: fields.title,
    phase_label: fields.phase_label,
    description: fields.description,
    effort_estimate: fields.effort_estimate,
    priority: fields.priority,
    priority_note: fields.priority_note,
    severity: fields.severity,
    status: fields.status,
    status_note: fields.status_note,
    owner: fields.owner,
    depends_on: refs.depends_on,
    blocks: refs.blocks,
    coordinates_with: refs.coordinates_with,
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
  const iso = /Date:\s*\**\s*(\d{4}-\d{2}-\d{2})/.exec(content);
  if (iso) return iso[1];
  const uk = /Date:\**\s*(\d{2})\/(\d{2})\/(\d{4})/.exec(content);
  if (uk) return uk[3] + '-' + uk[2] + '-' + uk[1];
  return new Date().toISOString().slice(0, 10);
}

function extractDocumentPurpose(content: string): string {
  const lines = content.split('\n');
  const headingIdx = lines.findIndex((l) => /^#\s+/.test(l));
  if (headingIdx === -1) {
    return 'Knowledge Hub product roadmap — forward-looking work only.';
  }
  const ruleIdx = lines.findIndex(
    (l, i) => i > headingIdx && /^---\s*$/.test(l),
  );
  if (ruleIdx === -1) {
    return 'Knowledge Hub product roadmap — forward-looking work only.';
  }
  const preamble = lines
    .slice(headingIdx + 1, ruleIdx)
    .join('\n')
    .trim();
  if (preamble.length === 0) {
    return 'Knowledge Hub product roadmap — forward-looking work only.';
  }
  return preamble;
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
