#!/usr/bin/env bun
/**
 * generate-purge-path-inventory.ts — ID-68 record 29 purge-prep (TECH PC-35
 * step 2, PRODUCT Inv 35).
 *
 * Emits the `--paths-from-file` input for the HELD `{68.10}` git-filter-repo
 * history purge. Repeatable — designed to be RE-RUN AT PURGE TIME from the
 * main checkout (TECH PC-35: "generated at purge time"), because the
 * relocation cutover (records 27/28) had NOT yet executed when this script
 * was authored: entries are derived prospectively from the DOC-LIFECYCLE §4
 * dispositions + historical `git log --all` enumeration, and each entry is
 * marked `pending-relocation` (still tracked at HEAD) vs
 * `already-removed-at-HEAD`.
 *
 * Path groups (PC-35 step 2):
 *   1. Legacy AC2 set — client corpus/briefs/personas/feedback, the CSP under
 *      docs/testing/test-data/, scripts/catalogue-*-itt.ts historical paths.
 *   2. Relocated docs/** (DOC-LIFECYCLE §4: ALL of docs/ leaves the public
 *      tier — AC-C1 — sole possible exception the OQ-E ontology subset,
 *      expressed via `--keep`).
 *   3. .planning/** (historical; removed at HEAD S301a `9b1e5aaf`).
 *   4. docs-site/** (the co-relocated Astro project).
 *   5. Client branding — lib/branding/clients/<stem>.json +
 *      public/clients/<stem>/** (Inv 33-A).
 *   6. The 3 record-19 deleted client-named scripts.
 *   7. scripts/run-1m-context.ts + scripts/wf-export.py (Inv 22).
 *   8. The 4 legacy eval gold-standard paths (record 17 — replacements live
 *      at __tests__/fixtures/eval-gold/ with clean first blobs).
 *
 * The client-named hook migration is NOT in the removal set — its treatment
 * (`--path-rename` + content redaction + staging `supabase db reset` replay
 * proof) is CONDITIONAL on OQ-H/OQ-G(b) and documented in the private
 * filter-repo runbook. It is emitted as a comment-only advisory.
 *
 * SECURITY (PC-31 placement constraint): this script contains ZERO raw
 * denylist token values. Stem-bearing paths (branding, deleted scripts, the
 * hook migration) are TEMPLATED at runtime from the client-name stem token in
 * the canonical denylist, which lives in the PRIVATE docs-site repo and is
 * resolved exactly like scripts/sweep-identity-relocation.ts:
 *   1. `--denylist <path>` flag.
 *   2. `$KH_PRIVATE_DOCS_DIR/ops/identity-denylist.json`.
 *   3. Sibling default: `<main-checkout-parent>/knowledge-hub-docs-site/ops/
 *      identity-denylist.json` (main checkout root via
 *      `git rev-parse --git-common-dir`, so agent worktrees resolve).
 *
 * The EMITTED inventory contains stem-bearing PATHS (permitted — paths only,
 * never token-class content) and is NOT a committed artefact: write it
 * outside the repo tree at purge time (see the private runbook
 * `runbooks/id68-filter-repo-purge.md` in the docs-site repo).
 *
 * Usage:
 *   bun scripts/generate-purge-path-inventory.ts \
 *     [--denylist <path>] [--out <path>] [--keep <prefix>]...
 *
 * Default output: stdout. `--keep` removes a prefix from the removal set
 * (OQ-E ontology-subset branch); excluded paths stay visible as comments.
 * git-filter-repo's --paths-from-file ignores blank lines and `#` comments
 * (verified against git-filter-repo 2.47.0 get_paths_from_file).
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DenylistToken {
  value: string;
  case_insensitive: boolean;
  class: string;
  note?: string;
}

export interface Denylist {
  version: number;
  updated: string;
  tokens: DenylistToken[];
}

export type HeadState = 'pending-relocation' | 'already-removed-at-HEAD';

export interface AnnotatedPath {
  path: string;
  state: HeadState;
}

export interface InventoryGroup {
  id: string;
  title: string;
  entries: AnnotatedPath[];
}

export interface StemDerivedPaths {
  brandingExact: string[];
  brandingDirs: string[];
  deletedScripts: string[];
  conditionalMigration: { path: string; renameTo: string };
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested in
// __tests__/scripts/generate-purge-path-inventory.test.ts)
// ---------------------------------------------------------------------------

const STEM_CLASS_MARKER = 'client-name stem';

/** Derive the client-name stem from the PC-31 canonical denylist. */
export function deriveClientStem(denylist: Denylist): string {
  const stems = denylist.tokens.filter((t) =>
    t.class.toLowerCase().includes(STEM_CLASS_MARKER),
  );
  if (stems.length === 0) {
    throw new Error(
      `Denylist (version ${denylist.version}, updated ${denylist.updated}) ` +
        `carries no token whose class includes '${STEM_CLASS_MARKER}' — ` +
        'cannot template stem-bearing purge paths.',
    );
  }
  if (stems.length > 1) {
    throw new Error(
      `Denylist carries ${stems.length} '${STEM_CLASS_MARKER}' tokens — ` +
        'ambiguous; expected exactly one.',
    );
  }
  return stems[0].value;
}

/**
 * Template the stem-bearing purge paths at runtime so this source file
 * carries zero raw token values (PC-31 placement constraint).
 */
export function buildStemDerivedPaths(stem: string): StemDerivedPaths {
  return {
    brandingExact: [`lib/branding/clients/${stem}.json`],
    brandingDirs: [`public/clients/${stem}/`],
    deletedScripts: [
      `scripts/export-${stem}-articles.ts`,
      `scripts/seed-${stem}-guides.ts`,
      `scripts/split_${stem}_site_content.py`,
    ],
    conditionalMigration: {
      path: `supabase/migrations/20260424202806_capture_${stem}_domain_hook.sql`,
      renameTo:
        'supabase/migrations/20260424202806_capture_signup_domain_hook.sql',
    },
  };
}

/**
 * Mark each path `pending-relocation` (tracked at HEAD — the records-27/28
 * cutover has not yet removed it) vs `already-removed-at-HEAD` (historical
 * blob only). Directory entries (trailing `/`) are pending when any tracked
 * path lives under them.
 */
export function annotateHeadState(
  paths: string[],
  trackedAtHead: ReadonlySet<string>,
): AnnotatedPath[] {
  let trackedList: string[] | undefined;
  return paths.map((path) => {
    let pending: boolean;
    if (path.endsWith('/')) {
      trackedList ??= [...trackedAtHead];
      pending = trackedList.some((t) => t.startsWith(path));
    } else {
      pending = trackedAtHead.has(path);
    }
    return {
      path,
      state: pending ? 'pending-relocation' : 'already-removed-at-HEAD',
    };
  });
}

/** OQ-E branch: split keep-prefixed paths out of the removal set. */
export function applyKeepPrefixes(
  paths: string[],
  keeps: string[],
): { kept: string[]; excluded: string[] } {
  if (keeps.length === 0) return { kept: paths, excluded: [] };
  const kept: string[] = [];
  const excluded: string[] = [];
  for (const p of paths) {
    if (keeps.some((k) => p === k || p.startsWith(k))) excluded.push(p);
    else kept.push(p);
  }
  return { kept, excluded };
}

/** Earlier groups take precedence; later groups drop duplicate paths. */
export function dedupeGroups(groups: InventoryGroup[]): InventoryGroup[] {
  const seen = new Set<string>();
  return groups.map((g) => {
    const entries = g.entries.filter((e) => {
      if (seen.has(e.path)) return false;
      seen.add(e.path);
      return true;
    });
    return { ...g, entries };
  });
}

/** Harness/CI floor (PRODUCT Inv 18/19) — must never enter the removal set. */
const FLOOR_PATHS = new Set([
  'README.md',
  'AGENTS.md',
  'CLAUDE.md',
  '.knip-baseline.json',
  '.type-drift-baseline.json',
  'reference-doc-paths.json',
]);
const FLOOR_PREFIXES = ['.claude/', '.gitnexus/', '.ast-dataflow/'];

function assertNoFloorPaths(groups: InventoryGroup[]): void {
  for (const g of groups) {
    for (const e of g.entries) {
      if (
        FLOOR_PATHS.has(e.path) ||
        FLOOR_PREFIXES.some((p) => e.path.startsWith(p))
      ) {
        throw new Error(
          `Floor file '${e.path}' (group ${g.id}) entered the removal set — ` +
            'PRODUCT Inv 18/19 violation; refusing to emit.',
        );
      }
    }
  }
}

export interface RenderOptions {
  headSha: string;
  generatedAt: string;
  groups: InventoryGroup[];
  keepExcluded: string[];
  conditionalMigration: { path: string; renameTo: string };
}

/**
 * Render the git-filter-repo `--paths-from-file` input. Non-comment lines are
 * bare exact paths; group + HEAD-state annotations ride in `#` comment
 * subsections (filter-repo 2.47.0 skips blank lines and `#` lines).
 */
export function renderPathsFromFile(opts: RenderOptions): string {
  const groups = dedupeGroups(opts.groups);
  assertNoFloorPaths(groups);

  const L: string[] = [
    '# id68-purge-path-inventory — git-filter-repo --paths-from-file input',
    `# Generated: ${opts.generatedAt} at HEAD ${opts.headSha}`,
    '# Generator: scripts/generate-purge-path-inventory.ts (ID-68.29 / TECH PC-35 step 2)',
    '# RE-GENERATE AT PURGE TIME — do not reuse a stale run (TECH §Risks: HEAD drift).',
    '# Consumed by: git filter-repo --invert-paths --paths-from-file <this file>',
    '',
  ];

  for (const g of groups) {
    const pending = g.entries.filter((e) => e.state === 'pending-relocation');
    const removed = g.entries.filter(
      (e) => e.state === 'already-removed-at-HEAD',
    );
    L.push(
      `# == group: ${g.title} (${g.id}) — ${g.entries.length} paths ` +
        `(${pending.length} pending-relocation, ${removed.length} already-removed-at-HEAD)`,
    );
    if (pending.length > 0) {
      L.push(
        '# -- pending-relocation (tracked at HEAD; records 27/28 cutover removes them before the purge):',
      );
      for (const e of pending) L.push(e.path);
    }
    if (removed.length > 0) {
      L.push('# -- already-removed-at-HEAD (historical blobs only):');
      for (const e of removed) L.push(e.path);
    }
    L.push('');
  }

  if (opts.keepExcluded.length > 0) {
    L.push(
      '# == keep-excluded (OQ-E branch: ratified-in public subset — NOT purged;',
      '#    listed for operator visibility only):',
    );
    for (const p of opts.keepExcluded) L.push(`# ${p}`);
    L.push('');
  }

  L.push(
    '# == conditional (NOT in the removal set — OQ-H / OQ-G(b) gate, see the private',
    '#    runbook runbooks/id68-filter-repo-purge.md): client-named hook migration is',
    '#    a --path-rename + --replace-text candidate, never --invert-paths (removing an',
    '#    applied migration breaks `supabase db reset` replay):',
    `# ${opts.conditionalMigration.path}`,
    `#   ==> ${opts.conditionalMigration.renameTo}`,
    '',
  );

  return L.join('\n');
}

// ---------------------------------------------------------------------------
// git helpers (runtime only)
// ---------------------------------------------------------------------------

const MAX_BUFFER = 256 * 1024 * 1024;

function git(args: string[]): string {
  // core.quotePath=false: emit non-ASCII paths raw (em-dashes, § characters
  // exist under docs/) — C-quoted lines would corrupt the filter-repo input.
  const res = spawnSync('git', ['-c', 'core.quotePath=false', ...args], {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  if (res.error) throw res.error;
  if (res.status !== 0 && res.status !== 1) {
    throw new Error(
      `git ${args.slice(0, 3).join(' ')}… exited ${res.status}: ${res.stderr}`,
    );
  }
  return res.stdout;
}

/** Every path that EVER existed under the given pathspecs, across all refs. */
function historicalPaths(pathspecs: string[]): string[] {
  const out = git([
    'log',
    '--all',
    '--format=',
    '--name-only',
    '--',
    ...pathspecs,
  ]);
  return [...new Set(out.split('\n').filter(Boolean))].sort();
}

function trackedAtHeadSet(): Set<string> {
  return new Set(git(['ls-files']).split('\n').filter(Boolean));
}

// ---------------------------------------------------------------------------
// Denylist resolution (mirrors scripts/sweep-identity-relocation.ts — that
// script executes main() at import time, so the pattern is duplicated rather
// than imported)
// ---------------------------------------------------------------------------

function resolveDenylistPath(flag: string | undefined): string {
  const candidates: { source: string; path: string }[] = [];
  if (flag) candidates.push({ source: '--denylist flag', path: resolve(flag) });
  const envDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (envDir) {
    candidates.push({
      source: 'KH_PRIVATE_DOCS_DIR env',
      path: join(envDir, 'ops', 'identity-denylist.json'),
    });
  }
  const commonDir = git([
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]).trim();
  const mainRoot = dirname(commonDir);
  candidates.push({
    source: 'sibling checkout default',
    path: join(
      dirname(mainRoot),
      'knowledge-hub-docs-site',
      'ops',
      'identity-denylist.json',
    ),
  });
  for (const c of candidates) {
    if (existsSync(c.path)) return c.path;
  }
  console.error(
    'FATAL: PC-31 canonical identity denylist not found. Tried (in order):',
  );
  for (const c of candidates) console.error(`  - [${c.source}] ${c.path}`);
  console.error(
    'Provide --denylist <path> or set KH_PRIVATE_DOCS_DIR to the docs-site checkout.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

interface CliArgs {
  denylist?: string;
  out?: string;
  keeps: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { keeps: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--denylist') args.denylist = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else if (argv[i] === '--keep') args.keeps.push(argv[++i]);
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      console.error(
        'Usage: bun scripts/generate-purge-path-inventory.ts ' +
          '[--denylist <path>] [--out <path>] [--keep <prefix>]...',
      );
      process.exit(2);
    }
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const denylistPath = resolveDenylistPath(args.denylist);
  const denylist = JSON.parse(readFileSync(denylistPath, 'utf8')) as Denylist;
  const stem = deriveClientStem(denylist);
  const derived = buildStemDerivedPaths(stem);

  const headSha = git(['rev-parse', '--short', 'HEAD']).trim();
  const tracked = trackedAtHeadSet();

  // Group 1 — legacy AC2 set ({68.5} inventory + {68.7} ITT seed).
  const ac2Prefixes = [
    'docs/client-documentation-corpus/',
    'docs/client-briefs/',
    'docs/client-personas.md',
    'docs/kh-client-feedback.md',
    'docs/testing/test-data/templates/csp-checklist/',
  ];
  const ac2 = [
    ...historicalPaths(ac2Prefixes),
    ...historicalPaths(['scripts/catalogue-*-itt.ts']),
  ];

  // Group 2 — relocated docs/** (DOC-LIFECYCLE §4 / AC-C1: the whole tree
  // leaves; OQ-E subset via --keep).
  const docsAll = historicalPaths(['docs/']);
  const { kept: docsKept, excluded: keepExcluded } = applyKeepPrefixes(
    docsAll,
    args.keeps,
  );

  // Groups 3-4 — .planning/** + docs-site/**.
  const planning = historicalPaths(['.planning/']);
  const docsSite = historicalPaths(['docs-site/']);

  // Group 5 — client branding (Inv 33-A), templated from the stem.
  const branding = [
    ...derived.brandingExact,
    ...historicalPaths(derived.brandingDirs),
  ];

  // Group 6 — record-19 deleted client-named scripts.
  // Group 7 — Inv 22 zero-coupling scripts.
  // Group 8 — record-17 legacy gold-standard paths (replacements live at
  // __tests__/fixtures/eval-gold/ with clean first blobs — NOT purged).
  const legacyGold = [
    '__tests__/fixtures/classification-eval-gold-standard.json',
    '__tests__/fixtures/entity-eval-gold-standard.json',
    '__tests__/fixtures/summarisation-eval-gold-standard.json',
    '__tests__/fixtures/procurement-drafting-eval-gold-standard.json',
  ];

  const groups: InventoryGroup[] = [
    {
      id: 'legacy-ac2',
      title: 'Legacy AC2 set (corpus/briefs/personas/feedback, CSP, ITT seeds)',
      entries: annotateHeadState(ac2, tracked),
    },
    {
      id: 'relocated-docs',
      title: 'Relocated docs/** (DOC-LIFECYCLE §4 dispositions, AC-C1)',
      entries: annotateHeadState(docsKept, tracked),
    },
    {
      id: 'planning',
      title: '.planning/** (historical; removed at HEAD S301a)',
      entries: annotateHeadState(planning, tracked),
    },
    {
      id: 'docs-site',
      title: 'docs-site/** (co-relocated Astro project)',
      entries: annotateHeadState(docsSite, tracked),
    },
    {
      id: 'branding',
      title: 'Client branding (Inv 33-A)',
      entries: annotateHeadState(branding, tracked),
    },
    {
      id: 'deleted-scripts',
      title: 'Record-19 deleted client-named scripts',
      entries: annotateHeadState(derived.deletedScripts, tracked),
    },
    {
      id: 'zero-coupling-scripts',
      title: 'Inv 22 zero-coupling scripts',
      entries: annotateHeadState(
        ['scripts/run-1m-context.ts', 'scripts/wf-export.py'],
        tracked,
      ),
    },
    {
      id: 'legacy-gold-standards',
      title: 'Record-17 legacy eval gold-standard paths',
      entries: annotateHeadState(legacyGold, tracked),
    },
  ];

  const rendered = renderPathsFromFile({
    headSha,
    generatedAt: new Date().toISOString(),
    groups,
    keepExcluded,
    conditionalMigration: derived.conditionalMigration,
  });

  if (args.out) {
    writeFileSync(resolve(args.out), rendered);
  } else {
    console.log(rendered);
  }

  // stderr summary (keeps stdout clean for piping).
  const deduped = dedupeGroups(groups);
  console.error(`id68 purge path inventory — HEAD ${headSha}`);
  console.error(`Denylist: ${denylistPath} (version ${denylist.version})`);
  let total = 0;
  for (const g of deduped) {
    const pending = g.entries.filter(
      (e) => e.state === 'pending-relocation',
    ).length;
    total += g.entries.length;
    console.error(
      `  ${g.id}: ${g.entries.length} paths (${pending} pending-relocation)`,
    );
  }
  console.error(
    `  TOTAL: ${total} removal paths` +
      (keepExcluded.length > 0
        ? `; ${keepExcluded.length} keep-excluded (OQ-E)`
        : ''),
  );
  if (args.out) console.error(`Written: ${resolve(args.out)}`);
}

if (import.meta.main) {
  main();
}
