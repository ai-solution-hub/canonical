#!/usr/bin/env bun
/**
 * Roadmap JSON to MD reverse renderer — Subtask 30.13 (PR-C Wave 2).
 *
 * Reads `docs/reference/product-roadmap.json` (the JSON-authoritative
 * source post-Phase-2 / post-30.12 reshape) and emits
 * `docs/reference/product-roadmap.md` as a generated artefact. The 30.12
 * schema reshape dropped `sections[]` in favour of a flat `themes[]`
 * array (Linear-style capability themes); this renderer iterates themes
 * in JSON-stable insertion order and emits one heading-per-theme MD.
 *
 * Round-trip invariant: render-twice produces byte-identical MD output
 * (idempotency probe — TECH §7 risk row 9). Determinism rules:
 *   - iterate themes via for-loop over the `themes[]` array
 *   - no timestamps, no UUIDs, no map iteration on object keys
 *   - bullet lists for cross_doc_links use array insertion order
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
  type RoadmapTheme,
  type DocLink,
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
// Date helpers
// ──────────────────────────────────────────

/**
 * Convert ISO 8601 YYYY-MM-DD to UK English DD/MM/YYYY for prose rendering.
 * Pure function — same input always yields same output (idempotency-safe).
 */
function formatDateUK(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m == null) return iso;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// ──────────────────────────────────────────
// Link helpers
// ──────────────────────────────────────────

/**
 * Render a Task id as an inline Markdown link to `task-list.json` anchored
 * by the bare-digit id. Backlog items use the `product-backlog.json` link.
 * Deterministic — same id always yields the same string.
 */
function renderTaskLink(id: string): string {
  return `[ID-${id}](task-list.json#${id})`;
}

function renderBacklogLink(id: string): string {
  return `[BID-${id}](product-backlog.json#${id})`;
}

function renderLinkedTasks(ids: readonly string[]): string {
  if (ids.length === 0) return '';
  return ids.map(renderTaskLink).join(', ');
}

function renderLinkedBacklog(ids: readonly string[]): string {
  if (ids.length === 0) return '';
  return ids.map(renderBacklogLink).join(', ');
}

function renderCrossDocLinks(links: readonly DocLink[]): string {
  if (links.length === 0) return '';
  const lines: string[] = [];
  lines.push('**Cross-doc links:**');
  lines.push('');
  for (const link of links) {
    const anchorSuffix = link.anchor != null ? `#${link.anchor}` : '';
    lines.push(`- [${link.raw}](${link.path}${anchorSuffix})`);
  }
  return lines.join('\n');
}

// ──────────────────────────────────────────
// Theme rendering
//
// Layout per Subtask 30.13 brief:
//
//   ## Theme: {title} (time_horizon: {now|next|later} — status: {pending|in_progress|done})
//
//   {description — multi-paragraph Markdown verbatim}
//
//   **Linked Tasks:** {ID-x, ID-y, …}
//   **Linked Backlog:** {BID-x, BID-y, …}
//
//   **Cross-doc links:**
//   - [{raw}]({path}#{anchor})
//
//   {notes paragraph if non-null}
// ──────────────────────────────────────────

function renderTheme(theme: RoadmapTheme): string {
  const out: string[] = [];
  out.push(
    `## Theme: ${theme.title} (time_horizon: ${theme.time_horizon} — status: ${theme.status})`,
  );
  out.push('');
  out.push(theme.description.trim());
  out.push('');
  out.push(`**Linked Tasks:** ${renderLinkedTasks(theme.linked_tasks)}`);
  out.push(`**Linked Backlog:** ${renderLinkedBacklog(theme.linked_backlog)}`);
  out.push('');
  const crossDocLinks = renderCrossDocLinks(theme.cross_doc_links);
  if (crossDocLinks.length > 0) {
    out.push(crossDocLinks);
    out.push('');
  }
  if (theme.notes != null && theme.notes.trim().length > 0) {
    out.push(theme.notes.trim());
    out.push('');
  }
  return out.join('\n');
}

// ──────────────────────────────────────────
// Roadmap rendering — orchestration
//
// Layout (per Subtask 30.13 brief):
//
//   # Knowledge Hub Roadmap
//   <blank>
//   {document_purpose paragraph if present}
//   <blank>
//   **Status:** {status} | **Forward-looking only:** {forward_looking_only} | **Last updated:** {DD/MM/YYYY from .date}
//   <blank>
//   ---
//   <blank>
//   ## Theme: …
//   <blank>
//   ---
//   <blank>
//   ## Theme: …
//   ...
//
// `---` separator precedes every theme heading. Render-twice MUST produce
// byte-identical output.
// ──────────────────────────────────────────

function renderRoadmap(roadmap: Roadmap): string {
  const out: string[] = [];
  out.push(`# ${roadmap.document_name}`);
  out.push('');
  if (roadmap.document_purpose.trim().length > 0) {
    out.push(roadmap.document_purpose.trim());
    out.push('');
  }
  out.push(
    `**Status:** ${roadmap.status} | **Forward-looking only:** ${String(roadmap.forward_looking_only)} | **Last updated:** ${formatDateUK(roadmap.date)}`,
  );
  out.push('');
  for (const theme of roadmap.themes) {
    out.push('---');
    out.push('');
    out.push(renderTheme(theme));
  }
  // Normalise trailing newlines deterministically.
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
      validation.data.themes.length +
      ' theme(s)).',
  );
  process.exit(0);
}

// Export renderRoadmap for use by round-trip tests (idempotency probe).
export { renderRoadmap };

// Run main when invoked as a script, not when imported.
if (import.meta.main) {
  main();
}
