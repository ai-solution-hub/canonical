#!/usr/bin/env bun
/**
 * sweep-identity-relocation.ts — ID-68 PC-40 relocation sweep (PRODUCT Inv 40).
 *
 * A scripted, repeatable sweep so Gate 7 can cite the exact HEAD SHA it ran
 * against (TECH §PC-40, §Migration plan Phase 0/Phase 5). Sections:
 *
 *   1. Phase-0 verify+record set — PC-2 / PC-5 / PC-6 / PC-20 / PC-21 (landed
 *      slice) / PC-22 / PC-26.
 *   2. Identity grep — the PC-31 canonical denylist over the full tracked tree.
 *   3. Docs-pointer grep — `git grep -nP '\bdocs/'` over code + harness dirs,
 *      categorised runtime-read vs prose.
 *   4. Plain-grep extension over Python/SQL (ast-dataflow is TS-only).
 *   5. Explicit ID-83 coverage — POST /walk route, deploy/coolify compose
 *      files, onprem-deploy workflow, burn-prevention runbook + scheduled-task
 *      doc, scripts/tests/*.py identity carriers.
 *   6. OQ-E evidence — which code/tests read docs/ontology/ (PC-24 input).
 *
 * Denylist resolution (PC-31 — canonical copy lives in the PRIVATE docs-site
 * repo; the Actions secret holds the full JSON; ID-114.9 demotes the DS bridge
 * to fallback):
 *   1. `--denylist <path>` flag (explicit override — highest priority).
 *   2. `$KH_CLIENT_NAME_DENYLIST` env var (JSON content — written to a tmp file;
 *      PRIMARY MAIN-resolvable candidate; used in CI and by operators who export
 *      the secret locally; never commits client names to this repo).
 *   3. `$KH_PRIVATE_DOCS_DIR/ops/identity-denylist.json` (demoted to fallback —
 *      requires the private docs-site checkout; kept for local dev convenience).
 *   4. Sibling default: `<main-checkout-parent>/knowledge-hub-docs-site/ops/
 *      identity-denylist.json` (main checkout root derived from
 *      `git rev-parse --git-common-dir`, so agent worktrees resolve correctly).
 *
 * SECURITY (ratified dispatch rule, S321): denylist token VALUES must never be
 * copied into any file committed in this repo. This script therefore:
 *   - hardcodes no token values in its source (everything is read at runtime);
 *   - never prints matched line content — only file:line locations and
 *     per-token counts by CLASS LABEL;
 *   - never prints exclusion-pattern text (reasons + indices only);
 *   - applies a defensive redaction pass over the final report for tokens of
 *     legal-name / ICO-registration class;
 *   - self-excludes its report output path from the identity grep (the report
 *     cites stem-bearing file paths as match locations, which is permitted —
 *     but the report must not then count itself as a carrier on re-runs).
 *
 * Usage:
 *   bun scripts/sweep-identity-relocation.ts [--denylist <path>] [--out <path>]
 *
 * Default output: id68-pc40-sweep-report.md at the repo root (non-tracked;
 * re-runs overwrite; the report header cites the HEAD SHA of each run). The
 * former docs/audits/ default was archived OUT of this repo under ID-68.28 —
 * defaulting there would resurrect the archived dir. Pass --out to relocate.
 *
 * Outputs feed: record 15 (guard exclusion-list seed), record 19 (categorised
 * de-ID work list), record 27 (OQ-E evidence), record 29 (purge path
 * inventory), record 30 (Gate-7 re-run).
 */

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DenylistToken {
  value: string;
  case_insensitive: boolean;
  class: string;
  note?: string;
}

interface ExclusionPattern {
  pattern: string;
  reason: string;
}

interface NonTokenClass {
  class: string;
  handling: string;
}

interface Denylist {
  version: number;
  updated: string;
  tokens: DenylistToken[];
  non_token_classes?: NonTokenClass[];
  exclusion_patterns?: ExclusionPattern[];
}

interface GrepMatch {
  path: string;
  line: number;
  content: string;
}

interface TokenSweepResult {
  classLabel: string;
  caseInsensitive: boolean;
  kept: GrepMatch[];
  excluded: { match: GrepMatch; patternIndex: number }[];
}

interface VerifyCheck {
  id: string;
  name: string;
  command: string;
  pass: boolean;
  detail: string[];
}

type PointerCategory =
  | 'runtime-read'
  | 'code-comment'
  | 'prose-markdown'
  | 'code-literal';

interface PointerMatch extends GrepMatch {
  category: PointerCategory;
  docsTarget: string;
}

// ---------------------------------------------------------------------------
// Shell helpers
// ---------------------------------------------------------------------------

const MAX_BUFFER = 64 * 1024 * 1024;

function git(args: string[], opts: { allowFail?: boolean } = {}): string {
  const res = spawnSync('git', args, {
    encoding: 'utf8',
    maxBuffer: MAX_BUFFER,
  });
  if (res.error) throw res.error;
  // git grep exits 1 when nothing matches — that is a valid empty result.
  if (res.status !== 0 && res.status !== 1 && !opts.allowFail) {
    throw new Error(
      `git ${args.slice(0, 3).join(' ')}… exited ${res.status}: ${res.stderr}`,
    );
  }
  return res.stdout;
}

function gitGrep(args: string[]): GrepMatch[] {
  const out = git(['grep', ...args]);
  const matches: GrepMatch[] = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const m = /^(.+?):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    matches.push({ path: m[1], line: Number(m[2]), content: m[3] });
  }
  return matches;
}

function gitLsFiles(pathspecs: string[] = []): string[] {
  return git(['ls-files', ...pathspecs])
    .split('\n')
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// CLI args + denylist resolution
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { denylist?: string; out?: string } {
  const args: { denylist?: string; out?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--denylist') args.denylist = argv[++i];
    else if (argv[i] === '--out') args.out = argv[++i];
    else {
      console.error(`Unknown argument: ${argv[i]}`);
      console.error(
        'Usage: bun scripts/sweep-identity-relocation.ts [--denylist <path>] [--out <path>]',
      );
      process.exit(2);
    }
  }
  return args;
}

function resolveDenylistPath(
  flag: string | undefined,
  _repoRoot: string,
): string {
  const candidates: { source: string; path: string }[] = [];
  if (flag) {
    candidates.push({ source: '--denylist flag', path: resolve(flag) });
  }
  // PRIMARY (ID-114.9): KH_CLIENT_NAME_DENYLIST env var holds the full JSON
  // content (the same value as the homonymous GitHub Actions secret). When set,
  // write it to a process-scoped tmp file so downstream code gets a path.
  // The tmp file is never committed and holds no data beyond this process lifetime.
  const inlineJson = process.env.KH_CLIENT_NAME_DENYLIST;
  if (inlineJson) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'kh-denylist-'));
    const tmpPath = join(tmpDir, 'identity-denylist.json');
    writeFileSync(tmpPath, inlineJson, 'utf8');
    candidates.push({
      source: 'KH_CLIENT_NAME_DENYLIST env (inline JSON)',
      path: tmpPath,
    });
  }
  // FALLBACK (demoted by ID-114.9): private docs-site checkout path.
  const envDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (envDir) {
    candidates.push({
      source: 'KH_PRIVATE_DOCS_DIR env (fallback)',
      path: join(envDir, 'ops', 'identity-denylist.json'),
    });
  }
  // Sibling default: derive the MAIN checkout root via the common git dir so
  // agent worktrees (nested under .claude/worktrees/) resolve correctly.
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
    'Set KH_CLIENT_NAME_DENYLIST to the JSON content, provide --denylist <path>, or set KH_PRIVATE_DOCS_DIR to the docs-site checkout.',
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Section 2 — identity sweep
// ---------------------------------------------------------------------------

function sweepToken(
  token: DenylistToken,
  exclusions: ExclusionPattern[],
  excludePathspecs: string[],
): TokenSweepResult {
  const args = ['-I', '-n', '-F'];
  if (token.case_insensitive) args.push('-i');
  args.push('-e', token.value, '--', '.', ...excludePathspecs);
  const all = gitGrep(args);
  const result: TokenSweepResult = {
    classLabel: token.class,
    caseInsensitive: token.case_insensitive,
    kept: [],
    excluded: [],
  };
  for (const match of all) {
    const lower = match.content.toLowerCase();
    const idx = exclusions.findIndex((p) =>
      lower.includes(p.pattern.toLowerCase()),
    );
    if (idx >= 0) result.excluded.push({ match, patternIndex: idx });
    else result.kept.push(match);
  }
  return result;
}

function byFile(matches: GrepMatch[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const m of matches) {
    const lines = map.get(m.path) ?? [];
    lines.push(m.line);
    map.set(m.path, lines);
  }
  return new Map([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const LINE_LIST_CAP = 15;

function fmtLines(lines: number[]): string {
  const sorted = [...lines].sort((a, b) => a - b);
  if (sorted.length <= LINE_LIST_CAP) return sorted.join(', ');
  return `${sorted.slice(0, LINE_LIST_CAP).join(', ')} (+${sorted.length - LINE_LIST_CAP} more)`;
}

// ---------------------------------------------------------------------------
// Section 3 — docs-pointer sweep
// ---------------------------------------------------------------------------

const POINTER_PATHSPECS = [
  'lib/',
  'app/',
  'scripts/',
  'components/',
  'contexts/',
  'hooks/',
  '__tests__/',
  '.github/',
  '.claude/',
  'CLAUDE.md',
  'AGENTS.md',
];

const RUNTIME_READ_RE =
  /(readFileSync|readFile|readdir|read_text|readText|open\(|Path\(|existsSync|statSync|fs\.|require\(|import\s|from\s+['"]|glob|fileURLToPath|resolve\(|join\(|cat\s|loadFile|--file|pathlib)/;

function commentMarker(path: string, trimmed: string): boolean {
  if (/\.(md|mdx)$/.test(path)) return false; // whole file is prose
  if (
    /\.(py|sh|ya?ml|toml|gitignore|env.*)$/.test(path) ||
    path.endsWith('Makefile')
  ) {
    return trimmed.startsWith('#');
  }
  if (/\.sql$/.test(path)) return trimmed.startsWith('--');
  // TS/JS/JSON-with-comments and similar.
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    trimmed.startsWith('<!--')
  );
}

function categorisePointer(m: GrepMatch): PointerCategory {
  if (/\.(md|mdx)$/.test(m.path)) return 'prose-markdown';
  const trimmed = m.content.trim();
  if (commentMarker(m.path, trimmed)) return 'code-comment';
  if (RUNTIME_READ_RE.test(m.content)) return 'runtime-read';
  return 'code-literal';
}

function extractDocsTarget(content: string): string {
  const m = /docs\/[A-Za-z0-9._/-]*/.exec(content);
  return m ? m[0] : 'docs/';
}

function sweepDocsPointers(): { matches: PointerMatch[]; engine: string } {
  // git grep -P needs PCRE; fall back to an ERE word-boundary emulation.
  let raw: GrepMatch[];
  let engine = 'PCRE (git grep -P)';
  try {
    raw = gitGrep(['-n', '-P', '\\bdocs/', '--', ...POINTER_PATHSPECS]);
  } catch {
    engine = 'ERE word-boundary emulation (git grep -E)';
    raw = gitGrep([
      '-n',
      '-E',
      '(^|[^A-Za-z0-9_./-])docs/',
      '--',
      ...POINTER_PATHSPECS,
    ]);
  }
  const matches = raw.map((m) => ({
    ...m,
    category: categorisePointer(m),
    docsTarget: extractDocsTarget(m.content),
  }));
  return { matches, engine };
}

// ---------------------------------------------------------------------------
// Section 1 — Phase-0 verify+record set
// ---------------------------------------------------------------------------

// Built by concatenation so this script never matches the PC-26 grep itself.
const OLD_KNOB = ['KH', 'DOCS', 'DIR'].join('_');

function runVerifyChecks(repoRoot: string): VerifyCheck[] {
  const checks: VerifyCheck[] = [];
  const tracked = gitLsFiles();

  // PC-2 — no OSI licence file (AC-A2).
  const licence = tracked.filter((f) => /^(license|licence|copying)/i.test(f));
  checks.push({
    id: 'PC-2',
    name: 'No OSI-approved licence file tracked (AC-A2)',
    command: "git ls-files | grep -iE '^(LICENSE|LICENCE|COPYING)'",
    pass: licence.length === 0,
    detail:
      licence.length === 0
        ? ['zero matches — no licence file tracked']
        : licence.map((f) => `UNEXPECTED tracked file: ${f}`),
  });

  // PC-5 — .graphifyignore absent (verify-only; deletion already landed).
  const graphifyTracked = tracked.filter((f) => f.endsWith('.graphifyignore'));
  const graphifyWorktree = existsSync(join(repoRoot, '.graphifyignore'));
  checks.push({
    id: 'PC-5',
    name: '.graphifyignore absent (tracked + working tree)',
    command: 'git ls-files | grep graphifyignore; ls .graphifyignore',
    pass: graphifyTracked.length === 0 && !graphifyWorktree,
    detail: [
      `tracked matches: ${graphifyTracked.length}`,
      `working-tree file present: ${graphifyWorktree ? 'YES (unexpected)' : 'no'}`,
    ],
  });

  // PC-6 — legacy client-corpus paths zero (AC-A5) + OQ-2 accepted-public list.
  const corpusPrefixes = [
    'docs/client-documentation-corpus/',
    'docs/client-briefs/',
    'docs/client-personas.md',
    'docs/kh-client-feedback.md',
  ];
  const corpusHits = tracked.filter((f) =>
    corpusPrefixes.some((p) => f === p || f.startsWith(p)),
  );
  const templates = tracked.filter((f) =>
    f.startsWith('docs/testing/test-data/templates/'),
  );
  checks.push({
    id: 'PC-6',
    name: 'Legacy client-corpus paths zero (AC-A5) + OQ-2 accepted-public list recorded',
    command:
      'git ls-files docs/client-documentation-corpus/ docs/client-briefs/ docs/client-personas.md docs/kh-client-feedback.md; git ls-files docs/testing/test-data/templates/',
    pass: corpusHits.length === 0,
    detail: [
      `legacy corpus tracked matches: ${corpusHits.length}`,
      `OQ-2 accepted-public list under docs/testing/test-data/templates/ (${templates.length} files, expected 8):`,
      ...templates.map((f) => `  - ${f}`),
    ],
  });

  // PC-20 — CONTRIBUTING.md absent (AC-C2 half).
  const contribTracked = tracked.filter((f) => /^CONTRIBUTING\.md$/i.test(f));
  const contribWorktree = existsSync(join(repoRoot, 'CONTRIBUTING.md'));
  checks.push({
    id: 'PC-20',
    name: 'CONTRIBUTING.md absent',
    command: 'git ls-files CONTRIBUTING.md; ls CONTRIBUTING.md',
    pass: contribTracked.length === 0 && !contribWorktree,
    detail: [
      `tracked matches: ${contribTracked.length}`,
      `working-tree file present: ${contribWorktree ? 'YES (unexpected)' : 'no'}`,
    ],
  });

  // PC-21 — landed slice (9b1e5aaf): codebase-stats + mcp-inventory deleted,
  // .planning/ removed, CLAUDE.md gitnexus count-strip.
  const generated = tracked.filter((f) => f.startsWith('docs/generated/'));
  const staleGenerated = generated.filter((f) =>
    /(codebase-stats|mcp-inventory)\.(md|json)$/.test(f),
  );
  const planningTracked = tracked.filter((f) => f.startsWith('.planning/'));
  const driftBaselineAtRoot = tracked.includes('.type-drift-baseline.json');
  let claudeCountLines: number[] = [];
  try {
    const claudeMd = readFileSync(join(repoRoot, 'CLAUDE.md'), 'utf8');
    claudeMd.split('\n').forEach((line, i) => {
      if (/\d+\s+symbols,\s*\d+\s+relationships/.test(line)) {
        claudeCountLines.push(i + 1);
      }
    });
  } catch {
    claudeCountLines = [];
  }
  const countStripHolds = claudeCountLines.length === 0;
  checks.push({
    id: 'PC-21',
    name: 'PC-21 landed slice (9b1e5aaf): stats/inventory deleted, .planning/ removed, count-strip',
    command:
      "git ls-files docs/generated/ .planning/; grep -nE '[0-9]+ symbols, [0-9]+ relationships' CLAUDE.md",
    pass:
      staleGenerated.length === 0 &&
      planningTracked.length === 0 &&
      countStripHolds,
    detail: [
      `docs/generated/ tracked set: ${generated.length === 0 ? '(empty)' : generated.join(', ')}`,
      `stale codebase-stats / mcp-inventory artefacts: ${staleGenerated.length}`,
      `.planning/ tracked files: ${planningTracked.length}`,
      `.type-drift-baseline.json at repo root (AC-C4, root-move 47be7899): ${driftBaselineAtRoot ? 'yes' : 'NO (unexpected)'}`,
      countStripHolds
        ? 'CLAUDE.md gitnexus count-strip holds (no live counts)'
        : `CLAUDE.md count-strip REGRESSED — live symbol/relationship counts at line(s) ${claudeCountLines.join(', ')} ` +
          '(strip landed 9b1e5aaf; failure indicates a later stat-block refresh re-introduced live counts)',
    ],
  });

  // PC-22 — Inv 22 deletion set (verify-only; deleted at 3e13d6ee).
  const inv22 = ['scripts/run-1m-context.ts', 'scripts/wf-export.py'];
  const inv22Tracked = tracked.filter((f) => inv22.includes(f));
  const inv22Worktree = inv22.filter((f) => existsSync(join(repoRoot, f)));
  checks.push({
    id: 'PC-22',
    name: 'Inv 22 deletion set absent (run-1m-context.ts + wf-export.py, AC-C4 half)',
    command: 'git ls-files scripts/run-1m-context.ts scripts/wf-export.py',
    pass: inv22Tracked.length === 0 && inv22Worktree.length === 0,
    detail: [
      `tracked matches: ${inv22Tracked.length}`,
      `working-tree presence: ${inv22Worktree.length === 0 ? 'none' : inv22Worktree.join(', ')}`,
    ],
  });

  // PC-26 — old bridge-knob name zero outside docs/ (recorded baseline).
  const knobMatches = gitGrep([
    '-n',
    '-i',
    '-F',
    '-e',
    OLD_KNOB,
    '--',
    '.',
    ':!docs/',
  ]);
  checks.push({
    id: 'PC-26',
    name: `Old bridge-knob name (${OLD_KNOB}) zero outside docs/ (recorded baseline)`,
    command: `git grep -i '${OLD_KNOB}' -- ':!docs/'`,
    pass: knobMatches.length === 0,
    detail:
      knobMatches.length === 0
        ? ['zero matches outside docs/']
        : knobMatches.map((m) => `match: ${m.path}:${m.line}`),
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Section 5 — explicit ID-83 coverage
// ---------------------------------------------------------------------------

const ID83_TARGETS: { path: string; label: string }[] = [
  { path: 'scripts/cocoindex_pipeline/server.py', label: 'POST /walk route' },
  {
    path: 'scripts/cocoindex_pipeline/adapters.py',
    label: '/walk adapter references',
  },
  {
    path: 'scripts/cocoindex_pipeline/verify_driver.py',
    label: '/walk verify driver',
  },
  {
    path: 'deploy/coolify/docker-compose.production.yaml',
    label: 'production compose (incl. line-69 carry-over comment)',
  },
  {
    path: 'deploy/coolify/docker-compose.staging.yaml',
    label: 'staging compose',
  },
  { path: 'deploy/coolify/.env.staging.example', label: 'staging env example' },
  {
    path: '.github/workflows/onprem-deploy.yml',
    label: 'onprem-deploy workflow',
  },
  {
    path: 'docs/runbooks/onprem-b1-deploy.md',
    label:
      'burn-prevention runbook + scheduled-task doc (ID-83.5; relocates private with PC-17)',
  },
];

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/**
 * Defensive pass: tokens of legal-name / ICO-registration class must never
 * appear in the committed report, even inside cited paths. (Stem tokens in
 * repo paths are permitted match LOCATIONS per the ratified dispatch rule.)
 */
function redact(text: string, tokens: DenylistToken[]): string {
  let out = text;
  for (const t of tokens) {
    if (!/legal|ico|registration/i.test(t.class)) continue;
    const escaped = t.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(escaped, t.case_insensitive ? 'gi' : 'g'),
      `[REDACTED:${slugify(t.class)}]`,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const repoRoot = git(['rev-parse', '--show-toplevel']).trim();
  if (resolve(process.cwd()) !== resolve(repoRoot)) {
    console.error(
      `FATAL: run from the repo root (${repoRoot}), not ${process.cwd()}.`,
    );
    process.exit(1);
  }

  const headSha = git(['rev-parse', 'HEAD']).trim();
  const headShort = git(['rev-parse', '--short', 'HEAD']).trim();
  const branch = git(['branch', '--show-current']).trim() || '(detached)';
  const now = new Date();
  const ukDate = `${String(now.getUTCDate()).padStart(2, '0')}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${now.getUTCFullYear()}`;

  const denylistPath = resolveDenylistPath(args.denylist, repoRoot);
  const denylist: Denylist = JSON.parse(readFileSync(denylistPath, 'utf8'));
  const exclusions = denylist.exclusion_patterns ?? [];

  // Default to a repo-root, non-tracked path. The original default
  // (docs/audits/id68-pc40-sweep-report.md) was archived OUT of this repo under
  // ID-68.28 (moved to the knowledge-hub-archive sibling); defaulting there
  // would resurrect the archived docs/audits/ dir on the next run. Override
  // with --out as before.
  const outPath = resolve(args.out ?? 'id68-pc40-sweep-report.md');
  const outRel = outPath.startsWith(repoRoot + '/')
    ? outPath.slice(repoRoot.length + 1)
    : outPath;
  const selfExcludes = isAbsolute(outRel) ? [] : [`:!${outRel}`];

  // --- Run sweeps -----------------------------------------------------------
  const verifyChecks = runVerifyChecks(repoRoot);
  const tokenResults = denylist.tokens.map((t) =>
    sweepToken(t, exclusions, selfExcludes),
  );
  const pointers = sweepDocsPointers();
  const oqeMatches = gitGrep([
    '-n',
    '-F',
    '-e',
    'docs/ontology/',
    '--',
    'lib/',
    'app/',
    'scripts/',
    'components/',
    'contexts/',
    'hooks/',
    '__tests__/',
    '.github/',
  ]);

  // --- Build report ---------------------------------------------------------
  const L: string[] = [];
  const push = (...lines: string[]) => L.push(...lines);

  push(
    '# ID-68 PC-40 relocation sweep report',
    '',
    `> Generated by \`scripts/sweep-identity-relocation.ts\` (PRODUCT Inv 40; TECH §PC-40).`,
    `> Re-run for Gate 7 (record 30) — the HEAD SHA below is the citation.`,
    '',
    `- **HEAD SHA:** \`${headSha}\` (short \`${headShort}\`)`,
    `- **Branch:** \`${branch}\``,
    `- **Run date:** ${ukDate} (${now.toISOString()})`,
    `- **Denylist:** PC-31 canonical copy, version ${denylist.version} (updated ${denylist.updated}) — read at runtime from the private docs-site checkout; token values are never embedded in this report (class labels + file:line locations only).`,
    `- **Self-exclusion:** this report's own path (\`${outRel}\`) is excluded from the identity grep so re-runs do not count the inventory as a carrier.`,
    '',
  );

  // Section 1 — Phase-0 verify+record.
  push('## 1. Phase-0 verify+record set', '');
  for (const c of verifyChecks) {
    push(
      `### ${c.id} — ${c.name}`,
      '',
      `- Command: \`${c.command}\``,
      `- Result: **${c.pass ? 'PASS' : 'FAIL'}**`,
      ...c.detail.map((d) => `- ${d}`),
      '',
    );
  }

  // Section 2 — identity sweep.
  push(
    '## 2. Identity sweep (PC-31 denylist over the full tracked tree)',
    '',
    '| Token class | Case | Total | Excluded (carve-out) | Net |',
    '|---|---|---:|---:|---:|',
  );
  for (const r of tokenResults) {
    push(
      `| ${r.classLabel} | ${r.caseInsensitive ? 'insensitive' : 'sensitive'} | ${r.kept.length + r.excluded.length} | ${r.excluded.length} | ${r.kept.length} |`,
    );
  }
  push('');
  if (exclusions.length > 0) {
    push(
      '**Exclusion patterns applied** (pattern text withheld — see the PC-31 canonical file; reasons cited):',
      '',
    );
    exclusions.forEach((p, i) => {
      const count = tokenResults.reduce(
        (n, r) => n + r.excluded.filter((e) => e.patternIndex === i).length,
        0,
      );
      push(`- [${i + 1}] ${count} match(es) — ${p.reason}`);
    });
    push('');
  }
  for (const nt of denylist.non_token_classes ?? []) {
    push(`**Out-of-grep-scope class:** ${nt.class} — ${nt.handling}`, '');
  }
  for (const r of tokenResults) {
    push(`### Class: ${r.classLabel} — net carriers by file`, '');
    if (r.kept.length === 0) {
      push('Zero net matches.', '');
      continue;
    }
    push('| File | Count | Lines |', '|---|---:|---|');
    for (const [path, lines] of byFile(r.kept)) {
      push(`| ${path} | ${lines.length} | ${fmtLines(lines)} |`);
    }
    push('');
    if (r.excluded.length > 0) {
      push('Excluded (carve-out) locations:', '');
      for (const e of r.excluded) {
        push(
          `- ${e.match.path}:${e.match.line} (exclusion [${e.patternIndex + 1}])`,
        );
      }
      push('');
    }
  }

  // Section 3 — docs-pointer sweep.
  const cats: PointerCategory[] = [
    'runtime-read',
    'code-literal',
    'code-comment',
    'prose-markdown',
  ];
  push(
    '## 3. Docs-pointer sweep (Inv 19 pointer-rework inventory)',
    '',
    `Engine: ${pointers.engine}. Pathspecs: \`${POINTER_PATHSPECS.join(' ')}\`.`,
    '',
    '| Category | Matches |',
    '|---|---:|',
    ...cats.map(
      (c) =>
        `| ${c} | ${pointers.matches.filter((m) => m.category === c).length} |`,
    ),
    `| **total** | **${pointers.matches.length}** |`,
    '',
    'Categorisation is heuristic: `prose-markdown` = .md/.mdx files; `code-comment` = comment-marker lines in code files; `runtime-read` = lines matching file-IO/import indicators; `code-literal` = remaining code lines (review candidates).',
    '',
  );
  for (const cat of ['runtime-read', 'code-literal'] as PointerCategory[]) {
    const set = pointers.matches.filter((m) => m.category === cat);
    push(`### ${cat} (${set.length}) — full locations`, '');
    if (set.length === 0) {
      push('None.', '');
      continue;
    }
    push('| Location | docs/ target |', '|---|---|');
    for (const m of set) {
      push(`| ${m.path}:${m.line} | ${m.docsTarget} |`);
    }
    push('');
  }
  for (const cat of ['code-comment', 'prose-markdown'] as PointerCategory[]) {
    const set = pointers.matches.filter((m) => m.category === cat);
    push(`### ${cat} (${set.length}) — per-file counts`, '');
    if (set.length === 0) {
      push('None.', '');
      continue;
    }
    push('| File | Count |', '|---|---:|');
    for (const [path, lines] of byFile(set)) {
      push(`| ${path} | ${lines.length} |`);
    }
    push('');
  }

  // Section 4 — Python/SQL plain-grep extension.
  const isPySql = (p: string) => /\.(py|sql)$/.test(p);
  push(
    '## 4. Python/SQL plain-grep extension',
    '',
    'ast-dataflow is TS-only (`.ast-dataflow/CLAUDE.md`) — the views below restate sections 2–3 restricted to `*.py` / `*.sql` so the de-ID records have an explicit non-TS work list. Scope: tracked files.',
    '',
  );
  for (const r of tokenResults) {
    const set = r.kept.filter((m) => isPySql(m.path));
    push(
      `### Identity class: ${r.classLabel} — ${set.length} match(es) in py/sql`,
      '',
    );
    if (set.length === 0) {
      push('None.', '');
      continue;
    }
    push('| File | Count | Lines |', '|---|---:|---|');
    for (const [path, lines] of byFile(set)) {
      push(`| ${path} | ${lines.length} | ${fmtLines(lines)} |`);
    }
    push('');
  }
  const pyderPointers = pointers.matches.filter((m) => isPySql(m.path));
  push(`### Docs-pointers in py/sql — ${pyderPointers.length} match(es)`, '');
  if (pyderPointers.length > 0) {
    push('| Location | Category | docs/ target |', '|---|---|---|');
    for (const m of pyderPointers) {
      push(`| ${m.path}:${m.line} | ${m.category} | ${m.docsTarget} |`);
    }
  } else {
    push('None.');
  }
  push('');

  // Section 5 — ID-83 coverage.
  const tracked = new Set(gitLsFiles());
  push(
    '## 5. Explicit ID-83 coverage (walk-trigger / on-prem deploy surface)',
    '',
    '| Target | Exists | Net identity matches (by class) |',
    '|---|---|---|',
  );
  for (const t of ID83_TARGETS) {
    const counts = tokenResults
      .map((r) => {
        const n = r.kept.filter((m) => m.path === t.path).length;
        return n > 0 ? `${r.classLabel}: ${n}` : null;
      })
      .filter(Boolean)
      .join('; ');
    push(
      `| ${t.path} (${t.label}) | ${tracked.has(t.path) ? 'yes' : '**MISSING**'} | ${counts || 'zero'} |`,
    );
  }
  push('');
  const pyTestCarriers = new Map<string, number>();
  for (const r of tokenResults) {
    for (const m of r.kept) {
      if (/^scripts\/tests\/.*\.py$/.test(m.path)) {
        pyTestCarriers.set(m.path, (pyTestCarriers.get(m.path) ?? 0) + 1);
      }
    }
  }
  push(
    `### scripts/tests/*.py identity carriers — ${pyTestCarriers.size} file(s) (TECH §PC-40 expected 6 at authoring HEAD 5db5eb88; re-verified each run)`,
    '',
  );
  if (pyTestCarriers.size > 0) {
    push('| File | Net matches (all classes) |', '|---|---:|');
    for (const [path, n] of [...pyTestCarriers.entries()].sort()) {
      push(`| ${path} | ${n} |`);
    }
  } else {
    push('None.');
  }
  push('');

  // Section 6 — OQ-E evidence.
  push(
    '## 6. OQ-E evidence — code/tests reading docs/ontology/ (feeds record 27 / PC-24)',
    '',
  );
  if (oqeMatches.length === 0) {
    push(
      'Zero matches — no code or test reads ontology docs at this HEAD.',
      '',
    );
  } else {
    push('| Location |', '|---|');
    for (const m of oqeMatches) push(`| ${m.path}:${m.line} |`);
    push('');
  }

  // Footer — outputs-feed map.
  push(
    '## Outputs feed',
    '',
    '- **Record 15** (guard-CI exclusion-list seed): section 2 per-file inventory = the pending-de-ID path set.',
    '- **Record 19** (categorised de-ID work list): sections 2 + 4.',
    '- **Record 27** (OQ-E evidence): section 6.',
    '- **Record 29** (purge path inventory): section 2 net-carrier file list.',
    '- **Record 30** (Gate 7): re-run this script at the then-current HEAD; the header SHA is the citation.',
    '',
  );

  const report = redact(L.join('\n'), denylist.tokens);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, report);

  // --- stdout summary -------------------------------------------------------
  console.log(`PC-40 sweep complete — HEAD ${headShort} (${branch})`);
  console.log(`Report written: ${outRel}`);
  for (const c of verifyChecks) {
    console.log(`  ${c.pass ? 'PASS' : 'FAIL'}  ${c.id} — ${c.name}`);
  }
  for (const r of tokenResults) {
    console.log(
      `  identity [${r.classLabel}]: net ${r.kept.length} (excluded ${r.excluded.length})`,
    );
  }
  console.log(
    `  docs-pointers: ${pointers.matches.length} total (runtime-read ${pointers.matches.filter((m) => m.category === 'runtime-read').length})`,
  );
  console.log(`  OQ-E ontology readers: ${oqeMatches.length}`);
  const anyFail = verifyChecks.some((c) => !c.pass);
  process.exit(anyFail ? 3 : 0);
}

main();
