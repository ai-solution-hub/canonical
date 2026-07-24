#!/usr/bin/env bun
/**
 * sync-intent-notes — deterministic core of the Intent-notes → docs-site sync
 * (id-165 {165.18}; owner-locked Option C from the {165.5} spike).
 *
 * Moves an Intent workspace's on-disk notes into the matching docs-site spec
 * folder so a task's working artefacts are preserved point-in-time when a
 * workspace / wave closes. This is the deterministic SCRIPT; the judgment layer
 * (triaging leak hits + dangling refs with the owner) lives in the
 * `sync-intent-notes` skill that wraps it.
 *
 * Source : <workspace>/.workspace/notes/*.md   (UUID-named notes + spec.md;
 *          `.meta/` machine noise and `.DS_Store` are ignored)
 * Target : $KH_PRIVATE_DOCS_DIR/src/content/docs/specs/<id-N-slug>/notes/
 *
 * The five spike requirements, each addressed here:
 *   1. Movement       — copy top-level `*.md` only; never `.meta/` or dotfiles.
 *   2. Ref rewriting  — `intent://local/{task,note}/<id>` → `./<id>.md`
 *                       (relative link, target sits in the same folder; link
 *                       text is preserved).
 *   3. Astro YAML     — Intent writes unquoted `title: {N.M} …` values that
 *                       fail js-yaml (parsed as a flow map). We quote the title
 *                       then full-re-dump the frontmatter via `yaml`, so it is
 *                       valid YAML even though content.config.ts currently
 *                       excludes notes from the docs collection via the
 *                       specs-notes negative glob (un-excluding later stays a
 *                       config-only change).
 *   4. Idempotence    — the transform is deterministic; a file whose transformed
 *                       output already equals the target is skipped, so a re-run
 *                       is a no-op.
 *   5. Leak scan      — each note's *content* (frontmatter + body) is scanned
 *                       against the resolved IP denylist; a hit blocks that file
 *                       (never written) and forces a non-zero exit. The existing
 *                       `ip-leak-filename-guard.sh` only checks filenames.
 *
 * Usage:
 *   bun run scripts/sync-intent-notes.ts <workspace-path> [id-N | id-N-slug]
 *                                        [--dry-run]
 *
 *   <workspace-path>  Intent workspace root (the dir holding `.workspace/`),
 *                     or a `.workspace` dir, or a notes dir directly.
 *   [id-N | slug]     Optional target override. `id-165` resolves the spec dir
 *                     by prefix; a full `id-165-ordna-adoption` slug is used
 *                     as-is. Omitted → resolved from workspace.json `branch`.
 *   --dry-run         Report the plan; write nothing.
 *
 * Exit codes:
 *   0 — success (clean; files written, or --dry-run)
 *   1 — one or more notes hit the IP denylist (blocked, not written)
 *   2 — usage / resolution error (no notes dir, ambiguous spec dir, …)
 *
 * Resolution:
 *   - Docs-site root  : $KH_PRIVATE_DOCS_DIR (sibling checkout locally;
 *                       GitHub-App-token checkout in CI via resolve-private-docs).
 *   - Denylist        : $KH_IP_DENYLIST_PATH, else
 *                       $KH_PRIVATE_DOCS_DIR/.config/ip-denylist.txt.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

const INTENT_REF =
  /intent:\/\/local\/(?:task|note)\/([A-Za-z0-9][A-Za-z0-9-]*)/g;
const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

interface Resolved {
  notesDir: string;
  workspaceJson: string | null;
}

/** Resolve the source notes dir from a flexible workspace-path argument. */
function resolveSource(arg: string): Resolved {
  const p = resolve(arg);
  if (!existsSync(p)) fail(`workspace path does not exist: ${p}`);

  // <root>/.workspace/notes
  const dotWsNotes = join(p, '.workspace', 'notes');
  if (existsSync(dotWsNotes) && statSync(dotWsNotes).isDirectory()) {
    return {
      notesDir: dotWsNotes,
      workspaceJson: join(p, '.workspace', 'workspace.json'),
    };
  }
  // <.workspace>/notes  (arg is the .workspace dir)
  const wsNotes = join(p, 'notes');
  if (
    existsSync(wsNotes) &&
    statSync(wsNotes).isDirectory() &&
    existsSync(join(p, 'workspace.json'))
  ) {
    return { notesDir: wsNotes, workspaceJson: join(p, 'workspace.json') };
  }
  // arg IS a notes dir
  if (basename(p) === 'notes' && statSync(p).isDirectory()) {
    const sibling = join(dirname(p), 'workspace.json');
    return { notesDir: p, workspaceJson: existsSync(sibling) ? sibling : null };
  }
  fail(
    `could not find a notes dir under ${p} ` +
      `(looked for .workspace/notes, notes/, or a notes dir)`,
  );
  throw new Error('unreachable');
}

/** Pull the workspace branch (for id-N resolution) from workspace.json. */
function readBranch(workspaceJson: string | null): string | null {
  if (!workspaceJson || !existsSync(workspaceJson)) return null;
  try {
    const ws = JSON.parse(readFileSync(workspaceJson, 'utf8'));
    return typeof ws.branch === 'string' ? ws.branch : null;
  } catch {
    return null;
  }
}

/** Resolve the target spec dir under docs-site/src/content/docs/specs. */
function resolveSpecDir(
  docsDir: string,
  override: string | undefined,
  branch: string | null,
): string {
  const specsRoot = join(docsDir, 'src', 'content', 'docs', 'specs');
  if (!existsSync(specsRoot)) fail(`specs root not found: ${specsRoot}`);

  // A full slug override (id-N-...) is used verbatim.
  if (override && /^id-\d+-/.test(override)) {
    const dir = join(specsRoot, override);
    if (!existsSync(dir)) fail(`spec dir not found: ${dir}`);
    return dir;
  }

  const prefix =
    override?.match(/^(id-\d+)$/)?.[1] ?? branch?.match(/(id-\d+)/)?.[1];
  if (!prefix) {
    fail(
      'could not derive id-N (no override, and workspace.json branch missing / ' +
        'unparseable). Pass an explicit id-N or full spec-dir slug.',
    );
  }

  const matches = readdirSync(specsRoot).filter(
    (d) =>
      (d === prefix || d.startsWith(`${prefix}-`)) &&
      statSync(join(specsRoot, d)).isDirectory(),
  );
  if (matches.length === 0) {
    fail(
      `no spec dir matches ${prefix} under ${specsRoot}. Pass an explicit slug.`,
    );
  }
  if (matches.length > 1) {
    fail(
      `ambiguous: ${matches.length} spec dirs match ${prefix} (${matches.join(', ')}). ` +
        'Pass an explicit slug.',
    );
  }
  return join(specsRoot, matches[0]);
}

/** Non-comment, non-blank denylist terms (case-insensitive substrings). */
function loadDenylist(docsDir: string): string[] {
  const path =
    process.env.KH_IP_DENYLIST_PATH ||
    join(docsDir, '.config', 'ip-denylist.txt');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

function safeQuoteTitle(raw: string): string {
  const v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v;
  }
  return JSON.stringify(v);
}

/**
 * Deterministic transform of one note's content:
 *   normalise frontmatter YAML (quote title, full re-dump) + rewrite refs.
 * `resolveRef` maps an intent-link id (which may be a short prefix of a note
 * UUID) to the on-disk note basename, so rewritten relative links resolve.
 * Throws (with the caller supplying the filename) if the frontmatter cannot be
 * made parseable even after quoting the title.
 */
function transform(
  content: string,
  resolveRef: (id: string) => string,
): string {
  const m = content.match(FRONTMATTER);
  let out: string;
  if (!m) {
    out = content; // no frontmatter — body only
  } else {
    let fm = m[1];
    const body = m[2];
    let parsed: unknown;
    try {
      parsed = parseYaml(fm);
    } catch {
      fm = fm.replace(
        /^title:[ \t]*(.*)$/m,
        (_all, v) => `title: ${safeQuoteTitle(v)}`,
      );
      parsed = parseYaml(fm); // let a still-broken doc throw up to the caller
    }
    const normalised = stringifyYaml(parsed);
    out = `---\n${normalised}---\n${body}`;
  }
  return out.replace(
    INTENT_REF,
    (_all, id: string) => `./${resolveRef(id)}.md`,
  );
}

function fail(msg: string): never {
  console.error(`sync-intent-notes: ${msg}`);
  process.exit(2);
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const positional = argv.filter((a) => !a.startsWith('--'));
  const [wsArg, targetOverride] = positional;

  if (!wsArg) {
    fail(
      'usage: sync-intent-notes.ts <workspace-path> [id-N | id-N-slug] [--dry-run]',
    );
  }

  const docsDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (!docsDir || !existsSync(docsDir)) {
    fail(`KH_PRIVATE_DOCS_DIR unset or missing: ${docsDir ?? '(unset)'}`);
  }

  const { notesDir, workspaceJson } = resolveSource(wsArg);
  const branch = readBranch(workspaceJson);
  const specDir = resolveSpecDir(docsDir!, targetOverride, branch);
  const targetDir = join(specDir, 'notes');
  const denylist = loadDenylist(docsDir!);

  const sources = readdirSync(notesDir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .sort();

  console.error(`sync-intent-notes: ${notesDir}`);
  console.error(`             ->    ${targetDir}`);
  console.error(
    `             ${sources.length} note(s); denylist ${denylist.length} term(s)` +
      `${dryRun ? '; DRY-RUN' : ''}`,
  );

  const created: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  const blocked: { file: string; terms: string[] }[] = [];
  const unresolvedRefs = new Set<string>();
  const sourceNames = new Set(sources.map((f) => f.replace(/\.md$/, '')));

  // Map an intent-link id to a note basename: exact match wins; else a unique
  // source whose UUID starts with the (possibly short) id; else the id verbatim
  // (left as a dangling relative link for the skill to triage).
  const resolveRef = (id: string): string => {
    if (sourceNames.has(id)) return id;
    const prefixed = [...sourceNames].filter((n) => n.startsWith(`${id}-`));
    if (prefixed.length === 1) return prefixed[0];
    unresolvedRefs.add(id);
    return id;
  };

  for (const file of sources) {
    const raw = readFileSync(join(notesDir, file), 'utf8');
    let output: string;
    try {
      output = transform(raw, resolveRef);
    } catch (e) {
      fail(`frontmatter unparseable in ${file}: ${(e as Error).message}`);
    }

    const hits = denylist.filter((t) =>
      output.toLowerCase().includes(t.toLowerCase()),
    );
    if (hits.length > 0) {
      blocked.push({ file, terms: hits });
      continue;
    }

    const target = join(targetDir, file);
    if (existsSync(target) && readFileSync(target, 'utf8') === output) {
      unchanged.push(file);
      continue;
    }
    const isNew = !existsSync(target);
    if (!dryRun) {
      mkdirSync(targetDir, { recursive: true });
      writeFileSync(target, output);
    }
    (isNew ? created : updated).push(file);
  }

  console.error(
    `\nresult: ${created.length} created, ${updated.length} updated, ` +
      `${unchanged.length} unchanged, ${blocked.length} blocked`,
  );
  if (created.length) console.error(`  created:   ${created.join(', ')}`);
  if (updated.length) console.error(`  updated:   ${updated.join(', ')}`);
  if (unresolvedRefs.size) {
    console.error(
      `  WARN dangling refs (target file absent in source): ` +
        `${[...unresolvedRefs].join(', ')}`,
    );
  }
  if (blocked.length) {
    console.error('\nBLOCKED — IP denylist hits (not written):');
    for (const b of blocked)
      console.error(`  ${b.file}: ${b.terms.join(', ')}`);
    process.exit(1);
  }
}

main();
