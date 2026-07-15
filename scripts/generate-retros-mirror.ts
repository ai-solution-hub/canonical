#!/usr/bin/env bun
/**
 * generate-retros-mirror.ts — ID-148.9 (TECH §3.3, INV-9).
 *
 * KH-native LOCAL mirror generator (Option A) for `product-retros.json`
 * (597 KB — read structurally via the schema, never loaded wholesale into an
 * agent's context). Emits one mirror per retro record:
 *
 *   <ledgerDir>/retros/{session-id}.md
 *
 * — mirroring `ledgers/tasks/{id}.md` per-record granularity, keyed on the
 * retro record's `id` field (the short session-id form, e.g. "S264" —
 * `retro-schema.ts` documents `id` as "the session id"; `session_id` is the
 * separate long-form field, e.g. "kh-main-S264", surfaced in the frontmatter
 * body but not the filename).
 *
 * The `ledgers/retros/` dir does not exist yet — this generator creates it.
 * Frontmatter carries the flat record fields; the body renders the six
 * S264-template categories (bugs_discovered, failed_assumptions,
 * architecture_decisions, rejected_approaches, workflow_improvements,
 * unresolved_questions) as the retro narrative.
 *
 * Usage:
 *   bun scripts/generate-retros-mirror.ts [--ledger-dir <path>]
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
  RetrosSchema,
  type RetrosDocument,
} from '@/lib/validation/retro-schema';

type RetroRecord = RetrosDocument['retros'][number];
type RetroFinding = RetroRecord['bugs_discovered'][number];

// ──────────────────────────────────────────────────────────────────────────
// Ledger dir resolution — same convention as generate-initiatives-mirror.ts.
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

// Retro record ids are the `S<digits>` session-id form (retro-schema.ts
// SESSION_ID_REGEX) — filenames are therefore always `S<digits>.md`.
const STALE_FILENAME_RE = /^(S\d+)\.md$/;

// ──────────────────────────────────────────────────────────────────────────
// YAML helpers — same convention as generate-initiatives-mirror.ts.
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

function yamlCrossDocLinks(links: RetroRecord['cross_doc_links']): string {
  if (links.length === 0) return 'cross_doc_links: []';
  const lines = ['cross_doc_links: '];
  for (const link of links) {
    lines.push(`  - path: ${yamlScalar(link.path)}`);
    lines.push(
      `    anchor: ${link.anchor === null ? 'null' : yamlScalar(link.anchor)}`,
    );
    lines.push(`    raw: ${yamlScalar(link.raw)}`);
  }
  return lines.join('\n');
}

// ──────────────────────────────────────────────────────────────────────────
// Body rendering — the six S264-template categories.
// ──────────────────────────────────────────────────────────────────────────

const CATEGORIES: {
  key: keyof RetroRecord & string;
  heading: string;
}[] = [
  { key: 'bugs_discovered', heading: 'Bugs discovered' },
  { key: 'failed_assumptions', heading: 'Failed assumptions' },
  { key: 'architecture_decisions', heading: 'Architecture decisions' },
  { key: 'rejected_approaches', heading: 'Rejected approaches' },
  { key: 'workflow_improvements', heading: 'Workflow improvements' },
  { key: 'unresolved_questions', heading: 'Unresolved questions' },
];

function renderFinding(finding: RetroFinding): string {
  const link =
    finding.cross_doc_links.length > 0
      ? ` (${finding.cross_doc_links.map((l) => l.raw).join('; ')})`
      : '';
  return `- ${finding.text}${link}`;
}

function renderBody(retro: RetroRecord): string {
  const lines: string[] = [];
  lines.push(
    `# ${retro.id}: ${retro.session_id} (${retro.track}) — ${retro.date}`,
  );
  lines.push('');
  if (retro.deprecated) {
    lines.push(
      `> **Deprecated**${retro.superseding_record_id ? ` — superseded by ${retro.superseding_record_id}` : ''}${retro.deprecation_reason ? `: ${retro.deprecation_reason}` : ''}`,
    );
    lines.push('');
  }

  for (const category of CATEGORIES) {
    const findings = retro[category.key] as unknown as RetroFinding[];
    lines.push(`## ${category.heading}`);
    lines.push('');
    if (findings.length === 0) {
      lines.push('_none_');
    } else {
      for (const finding of findings) lines.push(renderFinding(finding));
    }
    lines.push('');
  }

  return lines.join('\n');
}

function renderFrontmatter(retro: RetroRecord): string {
  const lines: string[] = ['---'];
  lines.push('type: retro');
  lines.push(`id: "${retro.id}"`);
  lines.push(`session_id: ${yamlScalar(retro.session_id)}`);
  lines.push(`date: ${retro.date}`);
  lines.push(`track: ${yamlScalar(retro.track)}`);
  lines.push(`session_refs: ${yamlInlineArray(retro.session_refs)}`);
  lines.push(`commit_refs: ${yamlInlineArray(retro.commit_refs)}`);
  lines.push(yamlCrossDocLinks(retro.cross_doc_links));
  lines.push(`deprecated: ${retro.deprecated}`);
  lines.push(
    `deprecation_reason: ${retro.deprecation_reason === null ? 'null' : yamlScalar(retro.deprecation_reason)}`,
  );
  lines.push(
    `superseding_record_id: ${retro.superseding_record_id === null ? 'null' : yamlScalar(retro.superseding_record_id)}`,
  );
  lines.push(
    `last_conflict_check: ${retro.last_conflict_check === null ? 'null' : retro.last_conflict_check}`,
  );
  lines.push('---');
  return lines.join('\n');
}

function renderRetroMirror(retro: RetroRecord): string {
  return `${renderFrontmatter(retro)}\n\n${renderBody(retro)}`;
}

// ──────────────────────────────────────────────────────────────────────────
// generateRetrosMirror — the testable core.
// ──────────────────────────────────────────────────────────────────────────

export interface RetrosMirrorResult {
  written: string[];
  deleted: string[];
}

export function generateRetrosMirror(ledgerDir: string): RetrosMirrorResult {
  const sourcePath = join(ledgerDir, 'product-retros.json');
  const mirrorDir = join(ledgerDir, 'retros');

  const raw = JSON.parse(readFileSync(sourcePath, 'utf8'));
  // RetrosSchema is strict (retros are CLI-written, not hand-edited dirty
  // data like initiatives.json) — a hard parse failure here is a real bug,
  // surfaced loudly, not swallowed.
  const value = RetrosSchema.parse(raw);

  mkdirSync(mirrorDir, { recursive: true });

  const currentIds = new Set(value.retros.map((r) => r.id));
  const written: string[] = [];
  for (const retro of value.retros) {
    const outPath = join(mirrorDir, `${retro.id}.md`);
    writeFileSync(outPath, `${renderRetroMirror(retro)}\n`, 'utf8');
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

  return { written, deleted };
}

// ──────────────────────────────────────────────────────────────────────────
// CLI entrypoint
// ──────────────────────────────────────────────────────────────────────────

function main(): void {
  const ledgerDir = resolveLedgerDir(process.argv.slice(2));
  const result = generateRetrosMirror(ledgerDir);
  process.stdout.write(
    `retros mirror: wrote ${result.written.length}, deleted ${result.deleted.length} stale file(s)\n`,
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
      `generate-retros-mirror: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
