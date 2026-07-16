/**
 * ledger-cli-initiatives.test.ts — initiatives + projects READ verbs
 * (ID-148.6, TECH §3.3 read handlers).
 *
 * `show initiatives [id]`, `list initiatives`, `show project <slug>`,
 * `list projects` — self-contained `readFile` + `InitiativesSchema.safeParse`
 * handlers mirroring the `show umbrellas` read arm (S450). Neither
 * `initiatives` nor `project(s)` is a `LedgerName` — the read is NOT routed
 * through `loadLedger`/`LEDGER_FILES` (same rationale as `umbrellas`).
 *
 * Fixture: `__tests__/fixtures/ledger/initiatives.json` — the same
 * synthetic, live-derived fixture the {148.5} schema suite uses (dirty
 * legacy project status, initiative-4-style off-project links, a
 * sub-initiative with no `substrate_doc`, two `substrate_doc` values under
 * git-ignored dirs, two-level recursive `sub-initiatives[]` nesting). Two
 * top-level initiatives: `"1"` (2 nested projects, both git-ignored
 * substrate_doc warnings) and `"4"` (0 projects, initiative-level
 * linked_tasks/linked_backlog).
 *
 * Filter-narrowing tests (`--status`/`--initiative`/`--recent`/`--limit`/
 * `--fields`/`--ids-only`) use a RICHER clone with two extra top-level
 * initiatives (`"7"` completed w/ one project, `"9"` planned w/ none) so
 * each filter has more than one bucket to narrow between — the base fixture
 * alone (both top-level initiatives `"active"`) can't exercise --status
 * narrowing meaningfully.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';

const REPO = resolve(__dirname, '../..');
const CLI = join(REPO, 'scripts/ledger-cli.ts');
const FIXTURE_PATH = resolve(__dirname, '../fixtures/ledger/initiatives.json');

function loadFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
}

/** The base live-derived fixture, unmutated (2 top-level initiatives: "1","4"). */
function baseFixture(): Record<string, unknown> {
  return loadFixture();
}

/**
 * A richer clone adding two top-level initiatives so --status/--recent/
 * --limit have more than one bucket to narrow between:
 *   "7" completed, 1 project "fixture-project-completed" (status completed)
 *   "9" planned, 0 projects
 * Document order becomes [1, 4, 7, 9] (reversed for --recent = [9, 7, 4, 1]).
 * flattenProjects order becomes [fixture-project-dirty-status,
 * fixture-nested-project, fixture-project-completed].
 */
function richFixture(): Record<string, unknown> {
  const doc = baseFixture();
  const initiatives = doc.initiatives as unknown[];
  initiatives.push(
    {
      id: '7',
      title: 'Fixture initiative three (completed)',
      description: '',
      status: 'completed',
      projects: [
        {
          id: 'fixture-project-completed',
          title: 'Fixture completed project',
          summary: 'Completed project for --status/--initiative narrowing.',
          description: '',
          substrate_doc: '',
          status: 'completed',
          blocked_by: [],
          blocking: [],
          linked_tasks: [],
          linked_backlog: [],
          originating_session: [],
        },
      ],
      originating_session: [],
      'sub-initiatives': [],
    },
    {
      id: '9',
      title: 'Fixture initiative four (planned)',
      description: '',
      status: 'planned',
      projects: [],
      originating_session: [],
      'sub-initiatives': [],
    },
  );
  return doc;
}

let dir: string;

function writeInitiatives(doc: Record<string, unknown>): string {
  const path = join(dir, 'initiatives.json');
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

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-initiatives-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ──────────────────────────────────────────────────────────────────────────
// `show initiatives [id]` — INV-1/INV-2/INV-4
// ──────────────────────────────────────────────────────────────────────────

describe('show initiatives (ID-148.6, INV-1/INV-2/INV-4)', () => {
  beforeEach(() => writeInitiatives(baseFixture()));

  it('`show initiatives` (no id) parses ok:true and returns the whole document', async () => {
    const r = await run(args('show', ['initiatives']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const doc = r.result as { document_name: string; initiatives: unknown[] };
    expect(doc.document_name).toBe('Canonical Platform - Initiatives');
    expect(doc.initiatives).toHaveLength(2);
  });

  it('surfaces the D2 non-fatal gitignored-substrate_doc warnings on the whole-doc read', async () => {
    const r = await run(args('show', ['initiatives']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings?.some((w) => w.includes('.user-scratch/'))).toBe(true);
    expect(r.warnings?.some((w) => w.includes('.lavish/'))).toBe(true);
  });

  it('`show initiatives <id>` returns the single top-level initiative', async () => {
    const r = await run(args('show', ['initiatives', '4']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = r.result as {
      id: string;
      linked_tasks?: string[];
      linked_backlog?: string[];
    };
    expect(entry.id).toBe('4');
    // The initiative-4-style off-project links (audit A3) parse through.
    expect(entry.linked_tasks).toEqual(['10', '20']);
    expect(entry.linked_backlog).toEqual(['5']);
  });

  it('unknown top-level id errors record-not-found and names the known ids', async () => {
    const r = await run(args('show', ['initiatives', 'nope']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('record-not-found');
    expect(String(r.detail)).toContain('1');
    expect(String(r.detail)).toContain('4');
  });

  it('an id that only exists at SUB-initiative depth is NOT found at the top-level scope', async () => {
    // Sub-initiative "1" exists under initiative "1" — but `show initiatives`
    // deliberately stays scoped to the top-level array (ids collide across
    // nesting depth in the live ledger).
    const r = await run(args('show', ['initiatives', '1']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const entry = r.result as { id: string; title: string };
    expect(entry.title).toBe('Fixture initiative one');
  });

  it('is read-only — the on-disk file is byte-identical after a show', async () => {
    const before = readFileSync(join(dir, 'initiatives.json'), 'utf8');
    await run(args('show', ['initiatives']));
    await run(args('show', ['initiatives', '4']));
    expect(readFileSync(join(dir, 'initiatives.json'), 'utf8')).toBe(before);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `show project <slug>` — INV-1/INV-2/INV-4
// ──────────────────────────────────────────────────────────────────────────

describe('show project (ID-148.6, INV-1/INV-2/INV-4)', () => {
  beforeEach(() => writeInitiatives(baseFixture()));

  it('finds a project one level deep (under a sub-initiative) and preserves its dirty legacy status', async () => {
    const r = await run(
      args('show', ['project', 'fixture-project-dirty-status']),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = r.result as { id: string; status: string };
    expect(project.id).toBe('fixture-project-dirty-status');
    // INV-1/INV-3 lenient read: an out-of-enum legacy status parses verbatim.
    expect(project.status).toBe('todo');
  });

  it('finds a project TWO levels deep (nested sub-sub-initiative)', async () => {
    const r = await run(args('show', ['project', 'fixture-nested-project']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const project = r.result as { id: string; status: string };
    expect(project.id).toBe('fixture-nested-project');
    expect(project.status).toBe('ready');
  });

  it('unknown project slug errors record-not-found and names known ids', async () => {
    const r = await run(args('show', ['project', 'no-such-project']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('record-not-found');
    expect(String(r.detail)).toContain('fixture-project-dirty-status');
    expect(String(r.detail)).toContain('fixture-nested-project');
  });

  it('rejects `show project` with no slug', async () => {
    const r = await run(args('show', ['project']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('missing-args');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `list initiatives` — INV-4 filters (top-level scope only)
// ──────────────────────────────────────────────────────────────────────────

describe('list initiatives (ID-148.6, INV-4 filters)', () => {
  beforeEach(() => writeInitiatives(richFixture()));

  it('defaults to every top-level initiative as {id,title,status}, unfiltered', async () => {
    const r = await run(args('list', ['initiatives']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as {
      ledger: string;
      total: number;
      shown: number;
      truncated: boolean;
      records: { id: string; title: string; status: string }[];
    };
    expect(res.ledger).toBe('initiatives');
    expect(res.total).toBe(4);
    expect(res.shown).toBe(4);
    expect(res.truncated).toBe(false);
    expect(res.records.map((r2) => r2.id).sort()).toEqual(['1', '4', '7', '9']);
    expect(Object.keys(res.records[0]).sort()).toEqual([
      'id',
      'status',
      'title',
    ]);
  });

  it('--status narrows to the matching top-level initiatives only', async () => {
    const r = await run(args('list', ['initiatives'], { status: 'planned' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id)).toEqual(['9']);
  });

  it('--status csv narrows to the union of the named statuses', async () => {
    const r = await run(
      args('list', ['initiatives'], { status: 'completed,planned' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id).sort()).toEqual(['7', '9']);
  });

  it('--recent n returns the n most-recently-added top-level initiatives (document order)', async () => {
    const r = await run(args('list', ['initiatives'], { recent: '2' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id)).toEqual(['9', '7']);
  });

  it('--limit caps output and reports truncated:true with a total vs shown warning', async () => {
    const r = await run(args('list', ['initiatives'], { limit: '2' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as {
      total: number;
      shown: number;
      truncated: boolean;
    };
    expect(res.total).toBe(4);
    expect(res.shown).toBe(2);
    expect(res.truncated).toBe(true);
    expect(r.warnings?.some((w) => w.includes('showing 2 of 4'))).toBe(true);
  });

  it('--fields projects only the requested top-level fields', async () => {
    const r = await run(args('list', ['initiatives'], { fields: 'id,status' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: Record<string, unknown>[] };
    expect(Object.keys(res.records[0]).sort()).toEqual(['id', 'status']);
  });

  it('--ids-only projects a bare id string[]', async () => {
    const r = await run(args('list', ['initiatives'], { idsOnly: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: unknown[] };
    expect(res.records.sort()).toEqual(['1', '4', '7', '9']);
  });

  it('--initiative is inert on `list initiatives` (already the top-level scope) — warns, does not error', async () => {
    const r = await run(args('list', ['initiatives'], { initiative: '1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { total: number };
    expect(res.total).toBe(4);
    expect(r.warnings?.some((w) => w.startsWith('--initiative ignored'))).toBe(
      true,
    );
  });

  it('rejects a non-integer --recent (reuses the shared coerceCountFlag helper)', async () => {
    const r = await run(args('list', ['initiatives'], { recent: 'abc' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad-flag-value');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// `list projects` — INV-4 filters (flattened, tree-wide)
// ──────────────────────────────────────────────────────────────────────────

describe('list projects (ID-148.6, INV-4 filters)', () => {
  beforeEach(() => writeInitiatives(richFixture()));

  it('flattens every project across the whole initiative/sub-initiative tree', async () => {
    const r = await run(args('list', ['projects']));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { total: number; records: { id: string }[] };
    expect(res.total).toBe(3);
    expect(res.records.map((r2) => r2.id).sort()).toEqual([
      'fixture-nested-project',
      'fixture-project-completed',
      'fixture-project-dirty-status',
    ]);
  });

  it('--initiative <id> scopes to one top-level initiative’s projects (incl. its sub-initiatives)', async () => {
    const r = await run(args('list', ['projects'], { initiative: '1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { total: number; records: { id: string }[] };
    expect(res.total).toBe(2);
    expect(res.records.map((r2) => r2.id).sort()).toEqual([
      'fixture-nested-project',
      'fixture-project-dirty-status',
    ]);
  });

  it('--initiative <id> scoped to a leaf initiative with one direct project', async () => {
    const r = await run(args('list', ['projects'], { initiative: '7' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id)).toEqual([
      'fixture-project-completed',
    ]);
  });

  it('--status narrows across the flattened project set', async () => {
    const r = await run(args('list', ['projects'], { status: 'completed' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id)).toEqual([
      'fixture-project-completed',
    ]);
  });

  it('--recent n returns the n most-recently-flattened projects (document order)', async () => {
    const r = await run(args('list', ['projects'], { recent: '1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: { id: string }[] };
    expect(res.records.map((r2) => r2.id)).toEqual([
      'fixture-project-completed',
    ]);
  });

  it('--limit caps output and reports truncated:true', async () => {
    const r = await run(args('list', ['projects'], { limit: '1' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as {
      total: number;
      shown: number;
      truncated: boolean;
    };
    expect(res.total).toBe(3);
    expect(res.shown).toBe(1);
    expect(res.truncated).toBe(true);
  });

  it('--fields projects only the requested project fields', async () => {
    const r = await run(args('list', ['projects'], { fields: 'id,summary' }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: Record<string, unknown>[] };
    expect(Object.keys(res.records[0]).sort()).toEqual(['id', 'summary']);
  });

  it('--ids-only projects a bare id string[]', async () => {
    const r = await run(args('list', ['projects'], { idsOnly: true }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const res = r.result as { records: unknown[] };
    expect(res.records.sort()).toEqual([
      'fixture-nested-project',
      'fixture-project-completed',
      'fixture-project-dirty-status',
    ]);
  });
});

// ──────────────────────────────────────────────────────────────────────────
// Bad-ledger / not-found envelope parity (INV-10)
// ──────────────────────────────────────────────────────────────────────────

describe('bad-ledger envelope parity (ID-148.6, INV-10)', () => {
  beforeEach(() => writeInitiatives(baseFixture()));

  it('`list nonsense-ledger` still rejects bad-ledger (initiatives/projects did not swallow the generic path)', async () => {
    const r = await run(args('list', ['nonsense-ledger']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad-ledger');
  });

  it('`show nonsense-ledger x` still rejects bad-ledger', async () => {
    const r = await run(args('show', ['nonsense-ledger', 'x']));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe('bad-ledger');
  });
});

// ──────────────────────────────────────────────────────────────────────────
// stdout purity (INV-11) — real subprocess, no `[branding]` bleed
// ──────────────────────────────────────────────────────────────────────────

describe('stdout purity — real CLI subprocess (ID-148.6, INV-11)', () => {
  beforeEach(() => writeInitiatives(baseFixture()));

  it('`show initiatives` emits exactly one JSON-parseable object on stdout, exit 0', () => {
    const r = spawnSync(
      'bun',
      [CLI, 'show', 'initiatives', '--ledger-dir', dir],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    const trimmed = (r.stdout ?? '').trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    expect(parsed.subcommand).toBe('show');
  });

  it('`list projects` emits exactly one JSON-parseable object on stdout, exit 0', () => {
    const r = spawnSync('bun', [CLI, 'list', 'projects', '--ledger-dir', dir], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    const trimmed = (r.stdout ?? '').trim();
    expect(trimmed.split('\n')).toHaveLength(1);
    const parsed = JSON.parse(trimmed);
    expect(parsed.ok).toBe(true);
    expect(parsed.subcommand).toBe('list');
  });

  // ID-156.4: the [branding] WCAG-contrast advisory (lib/client-config.ts,
  // pulled in transitively via lib/validation/schemas.ts) fired on every
  // ledger-cli invocation regardless of subcommand. Assert it is gone from
  // this real subprocess entirely (stdout AND stderr) — a plain `| jq .`
  // pipe never sees stdout noise (console.warn goes to stderr), but the
  // Orchestrator's stdout+stderr-merged capture did.
  it('`list projects` never prints the [branding] advisory (any stream)', () => {
    const r = spawnSync('bun', [CLI, 'list', 'projects', '--ledger-dir', dir], {
      cwd: REPO,
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stdout ?? '').not.toContain('[branding]');
    expect(r.stderr ?? '').not.toContain('[branding]');
  });

  // ID-156.4: `show initiatives` on the base fixture surfaces real
  // gitignored-substrate_doc warnings (see the D2 test above). The envelope
  // already carries them on stdout; `emit()` used to ALSO re-serialise the
  // identical array as a bare trailing `{"warnings":[...]}` line on stderr —
  // a plain `| jq .` pipe never noticed (stdout stayed one line), but any
  // stdout+stderr-merged consumer saw the warnings array twice. Assert
  // `emit()` now emits it exactly once, envelope only.
  it('`show initiatives` emits real warnings exactly once (envelope only, no stderr duplicate)', () => {
    const r = spawnSync(
      'bun',
      [CLI, 'show', 'initiatives', '--ledger-dir', dir],
      {
        cwd: REPO,
        encoding: 'utf8',
      },
    );
    expect(r.status).toBe(0);
    const parsed = JSON.parse((r.stdout ?? '').trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.warnings?.length).toBeGreaterThan(0);
    expect(r.stderr ?? '').not.toContain('"warnings"');
  });
});
