#!/usr/bin/env bun
/**
 * Roadmap MD to JSON converter — Subtask 30.13 (PR-C Wave 2, Option β).
 *
 * Reads `docs/reference/product-roadmap.md` (the generated artefact rendered
 * by `scripts/roadmap-from-json.ts`) and emits a themes-shape JSON object
 * conforming to `RoadmapSchema` from `lib/validation/roadmap-schema.ts`.
 *
 * The primary canonical surface for the Roadmap is JSON. This MD-to-JSON
 * converter exists only for round-trip integrity testing — see
 * `__tests__/docs/roadmap-roundtrip.test.ts`. Day-to-day Roadmap edits
 * happen on the JSON via `/update-roadmap-backlog` skill or direct edits;
 * the MD is regenerated via `bun run roadmap:render`.
 *
 * Round-trip invariant: parse(render(roadmap)) re-produces a JSON object
 * that round-trips through RoadmapSchema cleanly. Provenance fields
 * (session_refs, commit_refs) that are not present in the rendered MD are
 * re-introduced as empty arrays — the JSON-side fields are not reversible
 * from MD alone, which the round-trip test accounts for.
 *
 * Spec refs:
 *   - PRODUCT.md inv 6 + 7 (Shape A flat themes[] root)
 *   - TECH.md §3.1 (schema final reshape — drop sections / RoadmapSection
 *     / RoadmapItem; themes-only)
 *   - PLAN.md §2.3 Subtask 30.13 (Option β expanded scope — symmetric
 *     pair to scripts/roadmap-from-json.ts)
 *
 * Usage:
 *   bun run scripts/roadmap-to-json.ts              # full convert + write JSON
 *   bun run scripts/roadmap-to-json.ts --check      # validate only, no write
 *
 * Exit codes:
 *   0 — JSON emitted (or --check passed)
 *   2 — input file missing / unreadable
 *   3 — Zod validation failure on assembled object
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseArgs } from 'node:util';
import {
  RoadmapSchema,
  type RoadmapTheme,
  type DocLink,
} from '@/lib/validation/roadmap-schema';

const DEFAULT_INPUT = 'docs/reference/product-roadmap.md';
const DEFAULT_OUTPUT = 'docs/reference/product-roadmap.json';

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
      'roadmap-to-json.ts\n\n' +
        'Convert docs/reference/product-roadmap.md (themes-shape MD) to JSON\n' +
        'validated by lib/validation/roadmap-schema.ts.\n',
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
// Date helpers
// ──────────────────────────────────────────

/**
 * Convert UK English DD/MM/YYYY to ISO 8601 YYYY-MM-DD. Returns null when
 * the input does not match the UK format.
 */
function parseDateUK(uk: string): string | null {
  const m = uk.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m == null) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

// ──────────────────────────────────────────
// Section tokeniser
//
// Layout produced by `scripts/roadmap-from-json.ts`:
//
//   # Knowledge Hub Roadmap
//
//   {document_purpose}
//
//   **Status:** Active | **Forward-looking only:** true | **Last updated:** DD/MM/YYYY
//
//   ---
//
//   ## Theme: {title} (time_horizon: now|next|later — status: pending|in_progress|done)
//
//   {description multi-paragraph}
//
//   **Linked Tasks:** [ID-x](task-list.json#x), ...
//   **Linked Backlog:** [BID-x](product-backlog.json#x), ...
//
//   **Cross-doc links:**
//
//   - [{raw}]({path}#{anchor})
//
//   {notes paragraph}
//
//   ---
//   ...
// ──────────────────────────────────────────

const THEME_HEADING_RE =
  /^##\s+Theme:\s+(.+?)\s+\(time_horizon:\s+(now|next|later)\s+—\s+status:\s+(pending|in_progress|done)\)\s*$/;
const STATUS_LINE_RE =
  /^\*\*Status:\*\*\s+(\S+)\s+\|\s+\*\*Forward-looking only:\*\*\s+(true|false)\s+\|\s+\*\*Last updated:\*\*\s+(\d{2}\/\d{2}\/\d{4})\s*$/;
const LINKED_TASKS_RE = /^\*\*Linked Tasks:\*\*\s*(.*)$/;
const LINKED_BACKLOG_RE = /^\*\*Linked Backlog:\*\*\s*(.*)$/;
const TASK_LINK_RE = /\[ID-(\d+)\]\(task-list\.json#\d+\)/g;
const BACKLOG_LINK_RE = /\[BID-(\d+)\]\(product-backlog\.json#\d+\)/g;
const CROSS_DOC_LINK_BULLET_RE = /^-\s+\[(.+?)\]\((.+?)\)\s*$/;

function extractIdsFromLine(line: string, re: RegExp): string[] {
  return Array.from(line.matchAll(re)).map((m) => m[1]);
}

function parseCrossDocLink(rawPath: string): DocLink {
  const hashIndex = rawPath.indexOf('#');
  if (hashIndex === -1) {
    return { path: rawPath, anchor: null, raw: rawPath };
  }
  return {
    path: rawPath.slice(0, hashIndex),
    anchor: rawPath.slice(hashIndex + 1),
    raw: rawPath,
  };
}

interface ParseThemeBlockResult {
  theme: RoadmapTheme;
}

function parseThemeBlock(
  title: string,
  timeHorizon: 'now' | 'next' | 'later',
  status: 'pending' | 'in_progress' | 'done',
  body: string[],
  themeIndex: number,
): ParseThemeBlockResult {
  // Walk the body and split it into:
  //   - description (everything before the first **Linked Tasks:** line)
  //   - linked_tasks / linked_backlog (the two adjacent lines)
  //   - cross_doc_links (lines following **Cross-doc links:** header up to next blank)
  //   - notes (remaining paragraphs after cross_doc_links block)
  //
  // The renderer emits these sections in a fixed order with blank
  // separators; the parser tolerates absent sections.

  let cursor = 0;
  const descriptionLines: string[] = [];
  while (cursor < body.length) {
    if (LINKED_TASKS_RE.test(body[cursor])) break;
    descriptionLines.push(body[cursor]);
    cursor++;
  }
  // Trim trailing blank lines from description.
  while (
    descriptionLines.length > 0 &&
    descriptionLines[descriptionLines.length - 1].trim().length === 0
  ) {
    descriptionLines.pop();
  }
  const description = descriptionLines.join('\n').trim();

  let linkedTasks: string[] = [];
  let linkedBacklog: string[] = [];
  if (cursor < body.length) {
    const tasksMatch = body[cursor].match(LINKED_TASKS_RE);
    if (tasksMatch != null) {
      linkedTasks = extractIdsFromLine(tasksMatch[1], TASK_LINK_RE);
      cursor++;
    }
  }
  if (cursor < body.length) {
    const backlogMatch = body[cursor].match(LINKED_BACKLOG_RE);
    if (backlogMatch != null) {
      linkedBacklog = extractIdsFromLine(backlogMatch[1], BACKLOG_LINK_RE);
      cursor++;
    }
  }
  // Skip blank lines.
  while (cursor < body.length && body[cursor].trim().length === 0) cursor++;

  // Cross-doc links: optional `**Cross-doc links:**` header + bullet list.
  const crossDocLinks: DocLink[] = [];
  if (cursor < body.length && body[cursor].trim() === '**Cross-doc links:**') {
    cursor++;
    // Skip the blank line between header and first bullet.
    while (cursor < body.length && body[cursor].trim().length === 0) cursor++;
    while (cursor < body.length) {
      const bulletMatch = body[cursor].match(CROSS_DOC_LINK_BULLET_RE);
      if (bulletMatch == null) break;
      // bulletMatch[2] is the full link URL (path + optional #anchor).
      crossDocLinks.push(parseCrossDocLink(bulletMatch[2]));
      cursor++;
    }
    // Skip trailing blank lines after the bullet list.
    while (cursor < body.length && body[cursor].trim().length === 0) cursor++;
  }

  // Remaining lines = notes paragraph (could be multi-paragraph; preserve
  // verbatim Markdown structure).
  const notesLines = body.slice(cursor);
  while (
    notesLines.length > 0 &&
    notesLines[notesLines.length - 1].trim().length === 0
  ) {
    notesLines.pop();
  }
  const notes = notesLines.length > 0 ? notesLines.join('\n').trim() : null;

  // Theme id is derived from the body insertion order — the renderer does
  // not emit the theme id verbatim. For round-trip purposes we assign
  // sequential bare-digit ids starting at 1; the canonical JSON carries
  // the authoritative ids, so a true round-trip starts and ends with JSON.
  const id = String(themeIndex + 1);

  return {
    theme: {
      id,
      title,
      description,
      time_horizon: timeHorizon,
      status,
      linked_tasks: linkedTasks,
      linked_backlog: linkedBacklog,
      session_refs: [], // not reversible from MD; canonical JSON carries this
      commit_refs: [], // not reversible from MD; canonical JSON carries this
      cross_doc_links: crossDocLinks,
      notes,
    },
  };
}

function tokeniseThemes(content: string): {
  documentPurpose: string;
  status: string;
  forwardLookingOnly: boolean;
  date: string;
  themes: RoadmapTheme[];
} {
  const lines = content.split('\n');

  // Locate the H1 heading.
  const h1Index = lines.findIndex((l) => /^#\s+/.test(l));
  if (h1Index === -1) {
    throw new Error('roadmap-to-json: H1 heading not found in input.');
  }

  // Locate the **Status:** ... line.
  let statusLineIndex = -1;
  let statusMatch: RegExpMatchArray | null = null;
  for (let i = h1Index + 1; i < lines.length; i++) {
    const m = lines[i].match(STATUS_LINE_RE);
    if (m != null) {
      statusLineIndex = i;
      statusMatch = m;
      break;
    }
  }
  if (statusMatch == null) {
    throw new Error('roadmap-to-json: **Status:** ... line not found.');
  }

  // document_purpose is the prose between H1 and the **Status:** line.
  const purposeLines = lines.slice(h1Index + 1, statusLineIndex);
  while (
    purposeLines.length > 0 &&
    purposeLines[purposeLines.length - 1].trim().length === 0
  ) {
    purposeLines.pop();
  }
  while (purposeLines.length > 0 && purposeLines[0].trim().length === 0) {
    purposeLines.shift();
  }
  const documentPurpose = purposeLines.join('\n').trim();

  const status = statusMatch[1];
  const forwardLookingOnly = statusMatch[2] === 'true';
  const dateIso = parseDateUK(statusMatch[3]);
  if (dateIso == null) {
    throw new Error(
      'roadmap-to-json: Last updated date must be DD/MM/YYYY; got: ' +
        statusMatch[3],
    );
  }

  // Walk the rest of the file collecting theme blocks.
  const themes: RoadmapTheme[] = [];
  let cursor = statusLineIndex + 1;
  while (cursor < lines.length) {
    const line = lines[cursor];
    const themeMatch = line.match(THEME_HEADING_RE);
    if (themeMatch == null) {
      cursor++;
      continue;
    }
    const title = themeMatch[1];
    const timeHorizon = themeMatch[2] as 'now' | 'next' | 'later';
    const themeStatus = themeMatch[3] as 'pending' | 'in_progress' | 'done';
    cursor++;
    // Collect body lines until the next `## Theme:` heading or EOF.
    const bodyLines: string[] = [];
    while (cursor < lines.length) {
      if (THEME_HEADING_RE.test(lines[cursor])) break;
      bodyLines.push(lines[cursor]);
      cursor++;
    }
    // Strip leading blank lines.
    while (bodyLines.length > 0 && bodyLines[0].trim().length === 0) {
      bodyLines.shift();
    }
    // Strip trailing `---` separators that precede the next theme.
    while (
      bodyLines.length > 0 &&
      (bodyLines[bodyLines.length - 1].trim() === '---' ||
        bodyLines[bodyLines.length - 1].trim().length === 0)
    ) {
      bodyLines.pop();
    }
    const { theme } = parseThemeBlock(
      title,
      timeHorizon,
      themeStatus,
      bodyLines,
      themes.length,
    );
    themes.push(theme);
  }

  return {
    documentPurpose,
    status,
    forwardLookingOnly,
    date: dateIso,
    themes,
  };
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

  const content = readFileSync(inputPath, 'utf-8');
  const tokenised = tokeniseThemes(content);

  const roadmap = {
    document_name: 'Knowledge Hub Roadmap' as const,
    document_purpose: tokenised.documentPurpose,
    date: tokenised.date,
    status: 'Active' as const,
    forward_looking_only: true as const,
    related_documents: ['state-of-the-product.md', 'product-backlog.json'],
    last_updated:
      'Roadmap MD-to-JSON parse — provenance not reversible from MD (round-trip only)',
    themes: tokenised.themes,
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
        tokenised.themes.length +
        ' theme(s).',
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
      tokenised.themes.length +
      ' theme(s)).',
  );
  process.exit(0);
}

// Export tokeniseThemes for tests.
export { tokeniseThemes };

// Run main when invoked as a script.
if (import.meta.main) {
  main();
}
