/**
 * ledger-cli-journal-search.test.ts — `journal-search` (ID-156.2).
 *
 * Cross-task/cross-subtask journal search across the WHOLE task-list ledger.
 * Motivation (ID-156 description): parallel worktree sessions journal to
 * closed tasks; without a cross-task time view, contradictions between
 * concurrent sessions are invisible. Read-only — no server round-trip, same
 * rationale as `journal`/`show`/`list`.
 *
 * A hand-built synthetic task-list.json (NOT the shared __tests__/fixtures/
 * copy) gives deterministic, controllable `<info added on …>` timestamps
 * spanning multiple tasks — including a `done` task, to prove closed-task
 * inclusion — which the shared live-derived fixture cannot guarantee.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const CLI = join(REPO, 'scripts/ledger-cli.ts');

function subtask(id: string, details: string) {
  return {
    id,
    title: `Subtask ${id}`,
    description: 'Fixture subtask.',
    details,
    status: 'done',
    dependencies: [],
    testStrategy: 'n/a',
  };
}

function task(
  id: string,
  status: string,
  subtasks: ReturnType<typeof subtask>[],
) {
  return {
    id,
    title: `Fixture task ${id}`,
    description: 'Fixture task for journal-search tests.',
    status,
    priority: 'should',
    dependencies: [],
    subtasks,
    updatedAt: '2026-06-01T00:00:00.000Z',
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: null,
    cross_doc_links: [],
    session_refs: [],
    commit_refs: [],
  };
}

// Entry A: 2026-06-01 on T1.1 (T1 is DONE — proves closed-task inclusion).
// Entry B: 2026-06-10 on T1.1 (same subtask, later — supersession order).
// Entry C: 2026-06-05 on T2.1.
// Entry D: 2026-06-20 on T2.2, a hand-authored NON-ISO human label.
const DOC = {
  // The literal detectSchema (lib/ledger/detect-schema.ts) matches to route
  // to TaskListSchema / kind 'task-list' — NOT a free-form label.
  document_name: 'Knowledge Hub Task List',
  document_purpose: 'Synthetic fixture for ID-156.2 journal-search tests.',
  related_documents: [],
  tasks: [
    task('1', 'done', [
      subtask(
        '1',
        'Prose.\n\n<info added on 2026-06-01T09:00:00.000Z>\nEntry A on T1.1\n</info added on 2026-06-01T09:00:00.000Z>\n\n<info added on 2026-06-10T09:00:00.000Z>\nEntry B on T1.1\n</info added on 2026-06-10T09:00:00.000Z>',
      ),
    ]),
    task('2', 'in_progress', [
      subtask(
        '1',
        '<info added on 2026-06-05T09:00:00.000Z>\nEntry C on T2.1\n</info added on 2026-06-05T09:00:00.000Z>',
      ),
      subtask(
        '2',
        '<info added on 2026-06-20 (S400 legacy label)>\nEntry D on T2.2\n</info added on 2026-06-20 (S400 legacy label)>',
      ),
    ]),
  ],
};

let dir: string;

function writeDoc(doc: unknown = DOC): string {
  const path = join(dir, 'task-list.json');
  writeFileSync(path, JSON.stringify(doc), 'utf8');
  return path;
}

function args(
  subcommand: string,
  positionals: string[],
  extra: Partial<ParsedArgs['flags']> = {},
): ParsedArgs {
  return {
    subcommand,
    positionals,
    flags: {
      dryRun: false,
      pretty: false,
      regenMirrors: false,
      noRegenMirrors: true,
      ledgerDir: dir,
      ...extra,
    },
  };
}

interface SearchEntry {
  task: string;
  subtask: string;
  timestamp: string;
  text: string;
}
interface SearchResult {
  total: number;
  shown: number;
  truncated: boolean;
  entries: SearchEntry[];
  exported?: { path: string; bytes: number };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-journal-search-'));
  writeDoc();
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('journal-search — cross-task scan (ID-156.2)', () => {
  it('with no flags, returns every entry across every task, incl. a DONE task', async () => {
    const r = await run(args('journal-search', []));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.total).toBe(4);
    expect(result.truncated).toBe(false);
    const texts = result.entries.map((e) => e.text);
    expect(texts.some((t) => t.includes('Entry A on T1.1'))).toBe(true);
    expect(texts.some((t) => t.includes('Entry B on T1.1'))).toBe(true);
    expect(texts.some((t) => t.includes('Entry C on T2.1'))).toBe(true);
    expect(texts.some((t) => t.includes('Entry D on T2.2'))).toBe(true);
    // Entry A/B come from task "1", whose status is "done" — proves the scan
    // is NOT status-filtered (the whole point of a cross-task search).
    expect(result.entries.some((e) => e.task === '1')).toBe(true);
  });

  it('sorts matches chronologically ACROSS tasks (the cross-task time view)', async () => {
    const r = await run(args('journal-search', []));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    const order = result.entries.map((e) => e.text.match(/Entry (\w)/)?.[1]);
    expect(order).toEqual(['A', 'C', 'B', 'D']);
  });

  it('is read-only — the on-disk file is byte-identical after a search', async () => {
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    await run(args('journal-search', []));
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
  });
});

describe('journal-search — --since/--until day-key range filter (ID-156.2)', () => {
  it('--since excludes entries before the given date', async () => {
    const r = await run(args('journal-search', [], { since: '2026-06-05' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.total).toBe(3);
    expect(result.entries.some((e) => e.text.includes('Entry A'))).toBe(false);
  });

  it('--until excludes entries after the given date', async () => {
    const r = await run(args('journal-search', [], { until: '2026-06-10' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.total).toBe(3);
    expect(result.entries.some((e) => e.text.includes('Entry D'))).toBe(false);
  });

  it('--since + --until together narrow to the inclusive range', async () => {
    const r = await run(
      args('journal-search', [], { since: '2026-06-05', until: '2026-06-10' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.total).toBe(2);
    const texts = result.entries.map((e) => e.text);
    expect(texts.some((t) => t.includes('Entry C'))).toBe(true);
    expect(texts.some((t) => t.includes('Entry B'))).toBe(true);
  });

  it('a malformed --since (no leading YYYY-MM-DD) rejects bad-flag-value', async () => {
    const r = await run(args('journal-search', [], { since: 'not-a-date' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad-flag-value');
  });

  it('a malformed --until rejects bad-flag-value', async () => {
    const r = await run(args('journal-search', [], { until: 'nope' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad-flag-value');
  });
});

describe('journal-search — --task scope (ID-156.2)', () => {
  it('scopes to one task, incl. a DONE task', async () => {
    const r = await run(args('journal-search', [], { task: '1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.total).toBe(2);
    expect(result.entries.every((e) => e.task === '1')).toBe(true);
  });

  it('an unknown --task id rejects record-not-found', async () => {
    const r = await run(args('journal-search', [], { task: 'nope' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('record-not-found');
  });
});

describe('journal-search — --export writes the full detail to a file (ID-156.2)', () => {
  it('writes every matched entry to the export path and points to it on stdout', async () => {
    const exportPath = join(dir, 'export.json');
    const r = await run(args('journal-search', [], { export: exportPath }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult;
    expect(result.exported?.path).toBe(exportPath);
    expect(result.exported?.bytes).toBeGreaterThan(0);
    const written = JSON.parse(readFileSync(exportPath, 'utf8')) as {
      total: number;
      entries: SearchEntry[];
    };
    expect(written.total).toBe(4);
    expect(
      written.entries.some((e) => e.text.includes('Entry D on T2.2')),
    ).toBe(true);
  });
});

describe('journal-search — bounded output (S447 show-valve pattern, ID-156.2)', () => {
  it('degrades to a {task,subtask,timestamp} index when the match list exceeds 48KB', async () => {
    // A single oversized journal entry forces the default (non-export) path
    // past the 48KB show-valve ceiling.
    const bigDoc = {
      ...DOC,
      tasks: [
        task('1', 'done', [
          subtask(
            '1',
            `<info added on 2026-06-01T09:00:00.000Z>\n${'x'.repeat(60_000)}\n</info added on 2026-06-01T09:00:00.000Z>`,
          ),
        ]),
      ],
    };
    writeDoc(bigDoc);
    const r = await run(args('journal-search', []));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const result = r.result as SearchResult & { notice?: string };
    expect(result.truncated).toBe(true);
    expect(result.notice).toContain('48KB');
    expect(result.entries[0]).not.toHaveProperty('text');
    expect(result.entries[0]).toMatchObject({ task: '1', subtask: '1' });
  });
});

describe('journal-search — real CLI subprocess, USAGE/help completeness (ID-156.2)', () => {
  it('journal-search is documented in top-level --help with its flags', () => {
    const r = spawnSync('bun', [CLI, '--help'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const line = r.stdout
      .split('\n')
      .find((l) => l.trim().startsWith('journal-search'));
    expect(line).toBeDefined();
    const block = r.stdout.slice(r.stdout.indexOf('journal-search'));
    expect(block).toContain('--since');
    expect(block).toContain('--until');
    expect(block).toContain('--task');
    expect(block).toContain('--export');
  });

  it('journal-search --help returns a per-command help slice', () => {
    const r = spawnSync('bun', [CLI, 'journal-search', '--help'], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('journal-search');
    expect(r.stdout).toContain('--since');
    expect(r.stdout).toContain('--export');
  });

  it('emits exactly one JSON-parseable object on stdout, exit 0, no [branding]', () => {
    const r = spawnSync('bun', [CLI, 'journal-search', '--ledger-dir', dir], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const trimmed = (r.stdout ?? '').trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    expect(parsed.subcommand).toBe('journal-search');
    expect(r.stdout ?? '').not.toContain('[branding]');
    expect(r.stderr ?? '').not.toContain('[branding]');
  });
});
