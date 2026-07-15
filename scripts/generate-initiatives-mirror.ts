#!/usr/bin/env bun
/**
 * generate-initiatives-mirror.ts — ID-148.9 (TECH §3.3, INV-9).
 *
 * KH-native LOCAL mirror generator (Option A — NOT task-view-server-side; the
 * task-view server owns only the task-list/backlog/roadmap mirror regen).
 * Emits ONE mirror per TOP-LEVEL initiative:
 *
 *   <ledgerDir>/initiatives/{id}.md   (e.g. 1.md .. 10.md)
 *
 * — the same bare-numeric filename shape as the retired 16-theme roadmap
 * mirror it replaces, so the directory shape stays stable. Frontmatter models
 * the initiative (id, title, status, originating_session, optional
 * substrate_doc) in the `ledgers/tasks/ID-10.md` mirror style; the body
 * renders the sub-initiative -> project -> linked-tasks/linked-backlog tree
 * as a nested bullet list (arbitrary recursion depth, no heading-level cap).
 *
 * Any stale `{id}.md` left over from a prior topology (not a current
 * top-level initiative id) is DELETED — this is how the stale 11.md-16.md
 * theme-mirror leftovers get cleared (INV-9).
 *
 * Read is LENIENT (parseInitiativesWithWarnings, INV-1) — dirty legacy data
 * (out-of-enum statuses, initiative-4 off-project links, missing
 * substrate_doc) still regenerates a mirror; warnings are reported, never
 * fatal.
 *
 * Usage:
 *   bun scripts/generate-initiatives-mirror.ts [--ledger-dir <path>]
 *
 * Default ledger dir: $KH_PRIVATE_DOCS_DIR/src/content/docs/ledgers (ID-68.35
 * relocation) — pass --ledger-dir to point at a fixture dir (tests).
 */
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from 'node:fs';
import { join } from 'node:path';

import {
  parseInitiativesWithWarnings,
  type Initiative,
  type SubInitiative,
  type Project,
  type InitiativesWarning,
} from '@/lib/validation/initiatives-schema';

// ──────────────────────────────────────────────────────────────────────────
// Ledger dir resolution — mirrors the ledger-compact-done.ts / regen-mirrors.sh
// ID-68.35 convention (fail loud, no stale in-repo default).
// ──────────────────────────────────────────────────────────────────────────

export function resolveLedgerDir(argv: string[]): string {
  const flagIdx = argv.indexOf('--ledger-dir');
  if (flagIdx >= 0 && argv[flagIdx + 1]) return argv[flagIdx + 1]!;
  const docsDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (!docsDir) {
    throw new Error(
      'KH_PRIVATE_DOCS_DIR must be set (ID-68.35 ledger relocation), or pass --ledger-dir <path>',
    );
  }
  return join(docsDir, 'src/content/docs/ledgers');
}

const STALE_FILENAME_RE = /^(\d+)\.md$/;

// ──────────────────────────────────────────────────────────────────────────
// YAML scalar/array helpers — small hand-rolled serializer matching the
// existing tasks/ID-10.md mirror convention (unquoted where safe, `[]` for
// empty arrays, inline `[a, b]` for simple string arrays).
// ──────────────────────────────────────────────────────────────────────────

function yamlScalar(value: string): string {
  if (value === '') return '""';
  const needsQuote =
    /[:#[\]{}"'\n]/.test(value) ||
    /^[\s-]/.test(value) ||
    /\s$/.test(value) ||
    /^(true|false|null|~)$/i.test(value) ||
    /^-?\d+(\.\d+)?$/.test(value);
  return needsQuote ? JSON.stringify(value) : value;
}

function yamlInlineArray(items: string[]): string {
  if (items.length === 0) return '[]';
  return `[${items.map(yamlScalar).join(', ')}]`;
}

// ──────────────────────────────────────────────────────────────────────────
// Body rendering — nested bullet-list tree (sub-initiative -> project ->
// linked-tasks/linked-backlog). Arbitrary recursion depth via indentation,
// not markdown heading levels (headings cap at h6; bullets do not).
// ──────────────────────────────────────────────────────────────────────────

function renderIdList(ids: string[]): string {
  return ids.length > 0 ? ids.join(', ') : '_none_';
}

function renderProject(project: Project, indent: string): string[] {
  const lines: string[] = [];
  lines.push(
    `${indent}- **${project.id}** — ${project.title} [${project.status}]`,
  );
  if (project.summary) lines.push(`${indent}  - Summary: ${project.summary}`);
  lines.push(
    `${indent}  - Linked tasks: ${renderIdList(project.linked_tasks)}`,
  );
  lines.push(
    `${indent}  - Linked backlog: ${renderIdList(project.linked_backlog)}`,
  );
  if (project.blocked_by.length > 0) {
    lines.push(`${indent}  - Blocked by: ${renderIdList(project.blocked_by)}`);
  }
  if (project.blocking.length > 0) {
    lines.push(`${indent}  - Blocking: ${renderIdList(project.blocking)}`);
  }
  if (project.substrate_doc) {
    lines.push(`${indent}  - Substrate doc: ${project.substrate_doc}`);
  }
  return lines;
}

function renderSubInitiative(node: SubInitiative, indent: string): string[] {
  const lines: string[] = [];
  lines.push(`${indent}- **${node.id}: ${node.title}** [${node.status}]`);
  if (node.description) lines.push(`${indent}  ${node.description}`);
  if (node.substrate_doc) {
    lines.push(`${indent}  - Substrate doc: ${node.substrate_doc}`);
  }
  const projects = node.projects;
  lines.push(`${indent}  - Projects:${projects.length === 0 ? ' _none_' : ''}`);
  for (const project of projects) {
    lines.push(...renderProject(project, `${indent}    `));
  }
  const subs = node['sub-initiatives'];
  lines.push(
    `${indent}  - Sub-initiatives:${subs.length === 0 ? ' _none_' : ''}`,
  );
  for (const sub of subs) {
    lines.push(...renderSubInitiative(sub, `${indent}    `));
  }
  return lines;
}

function renderBody(initiative: Initiative): string {
  const lines: string[] = [];
  lines.push(`# ${initiative.id}: ${initiative.title}`);
  lines.push('');
  if (initiative.description) {
    lines.push(initiative.description);
    lines.push('');
  }

  // Transitional initiative-level off-project links (audit A3 tolerance —
  // e.g. live initiative-4 SDLC workflow orchestration).
  if (
    (initiative.linked_tasks && initiative.linked_tasks.length > 0) ||
    (initiative.linked_backlog && initiative.linked_backlog.length > 0)
  ) {
    lines.push('## Linked tasks / backlog (initiative-level)');
    lines.push('');
    lines.push(
      `- Linked tasks: ${renderIdList(initiative.linked_tasks ?? [])}`,
    );
    lines.push(
      `- Linked backlog: ${renderIdList(initiative.linked_backlog ?? [])}`,
    );
    lines.push('');
  }

  lines.push('## Projects');
  lines.push('');
  if (initiative.projects.length === 0) {
    lines.push('_none_');
  } else {
    for (const project of initiative.projects) {
      lines.push(...renderProject(project, ''));
    }
  }
  lines.push('');

  lines.push('## Sub-initiatives');
  lines.push('');
  const subs = initiative['sub-initiatives'];
  if (subs.length === 0) {
    lines.push('_none_');
  } else {
    for (const sub of subs) {
      lines.push(...renderSubInitiative(sub, ''));
    }
  }
  lines.push('');

  return lines.join('\n');
}

function renderFrontmatter(initiative: Initiative): string {
  const lines: string[] = ['---'];
  lines.push('type: initiative');
  lines.push(`id: "${initiative.id}"`);
  lines.push(`title: ${yamlScalar(initiative.title)}`);
  lines.push(`status: ${yamlScalar(initiative.status)}`);
  lines.push(
    `originating_session: ${yamlInlineArray(initiative.originating_session)}`,
  );
  if (initiative.substrate_doc) {
    lines.push(`substrate_doc: ${yamlScalar(initiative.substrate_doc)}`);
  }
  lines.push('---');
  return lines.join('\n');
}

function renderInitiativeMirror(initiative: Initiative): string {
  return `${renderFrontmatter(initiative)}\n\n${renderBody(initiative)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// generateInitiativesMirror — the testable core. Reads
// <ledgerDir>/initiatives.json, writes <ledgerDir>/initiatives/{id}.md per
// top-level initiative, deletes any stale {id}.md not in the current
// topology. Returns a summary for callers (CLI + tests).
// ──────────────────────────────────────────────────────────────────────────

export interface InitiativesMirrorResult {
  written: string[];
  deleted: string[];
  warnings: InitiativesWarning[];
}

export function generateInitiativesMirror(
  ledgerDir: string,
): InitiativesMirrorResult {
  const sourcePath = join(ledgerDir, 'initiatives.json');
  const mirrorDir = join(ledgerDir, 'initiatives');

  const raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
  // parseInitiativesWithWarnings throws ZodError loudly on hard-invalid shape
  // (delegates to InitiativesSchema.parse) — no silent catch here. It is
  // lenient only on dirty VALUES within a valid shape (INV-1).
  const { value, warnings } = parseInitiativesWithWarnings(raw);

  mkdirSync(mirrorDir, { recursive: true });

  const currentIds = new Set(value.initiatives.map((i) => i.id));
  const written: string[] = [];
  for (const initiative of value.initiatives) {
    const outPath = join(mirrorDir, `${initiative.id}.md`);
    writeFileSync(outPath, `${renderInitiativeMirror(initiative)}\n`, 'utf8');
    written.push(outPath);
  }

  const deleted: string[] = [];
  if (existsSync(mirrorDir)) {
    for (const entry of readdirSync(mirrorDir)) {
      const match = STALE_FILENAME_RE.exec(entry);
      if (!match) continue;
      if (currentIds.has(match[1]!)) continue;
      const stalePath = join(mirrorDir, entry);
      unlinkSync(stalePath);
      deleted.push(stalePath);
    }
  }

  return { written, deleted, warnings };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint
// ──────────────────────────────────────────────────────────────────────────

function main(): void {
  const ledgerDir = resolveLedgerDir(process.argv.slice(2));
  const result = generateInitiativesMirror(ledgerDir);
  for (const warning of result.warnings) {
    process.stderr.write(`[warn] ${warning.path}: ${warning.message}\n`);
  }
  process.stdout.write(
    `initiatives mirror: wrote ${result.written.length}, deleted ${result.deleted.length} stale file(s)\n`,
  );
  if (result.deleted.length > 0) {
    for (const path of result.deleted)
      process.stdout.write(`  - deleted ${path}\n`);
  }
}

if (import.meta.main) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `generate-initiatives-mirror: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
