/**
 * ledger-cli-mirror.test.ts — mirror-staleness signalling over the SERVER
 * TRANSPORT (ID-35.18 / ID-35.32, re-targeted at ID-90.22 R1a); extended
 * under ID-148.9 (TECH §3.3, INV-9) with the KH-native initiatives/retros
 * mirror generators.
 *
 * A mutating command regenerates the affected mirror BY DEFAULT (so
 * docs/reference/{tasks,roadmap,backlog}/ stay in sync); `--no-regen-mirrors`
 * opts out.
 *
 * ID-90.22 R1a: the WRITE path is now the server transport (KH_LEDGER_SERVER
 * unset → ON), so the in-process `__setRegenRunnerForTest` / `regenSpy` seam no
 * longer sits on the write path — REGEN RUNS SERVER-SIDE. The "regen was
 * invoked" and "regen-failed surfaces loud" behaviours are therefore the
 * server's responsibility (covered by task-view's own suite, U11; the
 * client-side response→envelope MAPPING is unit-tested with canned + real-server
 * responses in ledger-server-client.test.ts).
 *
 * What this suite now asserts is the CLIENT-OBSERVABLE mirror-staleness signal
 * over the transport:
 *   - `--no-regen-mirrors` → mirrorStale:true, mirrorStaleReason:'suppressed'
 *     (mapped client-side by transportCommit; no server regen needed).
 *   - a dry-run writes nothing and carries no stale signal.
 *   - a normal write succeeds (ok:true) and leaves no `suppressed` stale signal.
 *
 * ID-148.9 additions (INV-9 — initiatives/retros are KH-native, Option A;
 * NOT server-transported, so tested via a DIRECT generator run against a
 * FIXTURE dir per the TECH §5 test plan — no real docs-site mutation):
 *   - `generateInitiativesMirror` regenerates `initiatives/{id}.md` to the
 *     fixture's current topology and deletes stale `{id}.md` files outside it
 *     (the 11.md-16.md analogue).
 *   - `generateRetrosMirror` creates the (not-yet-existing) `retros/` dir and
 *     emits `retros/{session}.md`.
 *   - `regen-mirrors.sh` is wired to call both generators and its
 *     `MIRROR_DIRS` diff-reporting array carries `initiatives`/`retros`
 *     instead of the retired `roadmap` entry.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  copyFileSync,
  rmSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run, type ParsedArgs } from '@/scripts/ledger-cli';
import { generateInitiativesMirror } from '@/scripts/generate-initiatives-mirror';
import { generateRetrosMirror } from '@/scripts/generate-retros-mirror';

// ID-68.35: repointed from docs/reference/ live ledgers to synthetic fixtures.
const FIXTURES = {
  task: resolve(__dirname, '../fixtures/ledger/task-list.json'),
  roadmap: resolve(__dirname, '../fixtures/ledger/product-roadmap.json'),
  backlog: resolve(__dirname, '../fixtures/ledger/product-backlog.json'),
  initiatives: resolve(__dirname, '../fixtures/ledger/initiatives.json'),
  retros: resolve(__dirname, '../fixtures/ledger/product-retros.json'),
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ledger-cli-mirror-'));
  copyFileSync(FIXTURES.task, join(dir, 'task-list.json'));
  copyFileSync(FIXTURES.roadmap, join(dir, 'product-roadmap.json'));
  copyFileSync(FIXTURES.backlog, join(dir, 'product-backlog.json'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

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
      scoped: false,
      ledgerDir: dir,
      ...extra,
    },
  };
}
function read(name: 'task-list') {
  return JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8'));
}

describe('mirror-staleness signal over transport (ID-35.18 / ID-35.32)', () => {
  it('--no-regen-mirrors result envelope carries mirrorStaleReason: "suppressed"', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], { noRegenMirrors: true }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The transport client maps the client-side regen-suppression to the stale
    // signal — no server-side regen run is needed to observe it.
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
    // The write itself committed through the server.
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('done');
  });

  it('a dry-run with --no-regen-mirrors writes nothing and still reports suppressed', async () => {
    const before = readFileSync(join(dir, 'task-list.json'), 'utf8');
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'done'], {
        dryRun: true,
        noRegenMirrors: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // dryRun honoured server-side: the canonical file is byte-unchanged.
    expect(readFileSync(join(dir, 'task-list.json'), 'utf8')).toBe(before);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });

  it('a normal write with --no-regen-mirrors commits and carries the suppressed signal', async () => {
    const taskId = read('task-list').tasks[0].id;
    const subId = String(read('task-list').tasks[0].subtasks[0].id);
    const r = await run(
      args('flip-subtask', [taskId, subId, 'in_progress'], {
        noRegenMirrors: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(read('task-list').tasks[0].subtasks[0].status).toBe('in_progress');
    // The operator opted out, so the mirror is knowingly stale.
    expect(r.mirrorStale).toBe(true);
    expect(r.mirrorStaleReason).toBe('suppressed');
  });
});

describe('KH-native initiatives/retros mirror generators (ID-148.9, INV-9)', () => {
  let mirrorDir: string;

  beforeEach(() => {
    mirrorDir = mkdtempSync(join(tmpdir(), 'ledger-cli-mirror-initiatives-'));
    copyFileSync(FIXTURES.initiatives, join(mirrorDir, 'initiatives.json'));
    copyFileSync(FIXTURES.retros, join(mirrorDir, 'product-retros.json'));
  });
  afterEach(() => {
    rmSync(mirrorDir, { recursive: true, force: true });
  });

  it('regenerates initiatives/{id}.md to the fixture topology and deletes stale ids', () => {
    // Pre-seed stale mirrors outside the fixture's current topology (ids "1"
    // and "4" only) — the analogue of the real 11.md-16.md leftover theme
    // mirrors this generator retires (INV-9).
    mkdirSync(join(mirrorDir, 'initiatives'), { recursive: true });
    writeFileSync(join(mirrorDir, 'initiatives', '11.md'), 'stale\n');
    writeFileSync(join(mirrorDir, 'initiatives', '16.md'), 'stale\n');
    // A non-numeric filename must survive untouched (not matched by the
    // stale-cleanup regex).
    writeFileSync(join(mirrorDir, 'initiatives', 'README.md'), 'keep\n');

    const result = generateInitiativesMirror(mirrorDir);

    expect(result.written.sort()).toEqual(
      [
        join(mirrorDir, 'initiatives', '1.md'),
        join(mirrorDir, 'initiatives', '4.md'),
      ].sort(),
    );
    expect(result.deleted.sort()).toEqual(
      [
        join(mirrorDir, 'initiatives', '11.md'),
        join(mirrorDir, 'initiatives', '16.md'),
      ].sort(),
    );
    expect(existsSync(join(mirrorDir, 'initiatives', '11.md'))).toBe(false);
    expect(existsSync(join(mirrorDir, 'initiatives', '16.md'))).toBe(false);
    expect(existsSync(join(mirrorDir, 'initiatives', 'README.md'))).toBe(true);

    const initiative1 = readFileSync(
      join(mirrorDir, 'initiatives', '1.md'),
      'utf8',
    );
    expect(initiative1).toContain('type: initiative');
    expect(initiative1).toContain('id: "1"');
    expect(initiative1).toContain('title: Fixture initiative one');
    expect(initiative1).toContain('status: active');
    expect(initiative1).toContain('# 1: Fixture initiative one');
    // Sub-initiative -> project -> linked-tasks/linked-backlog tree renders.
    expect(initiative1).toContain('Sub-initiative without substrate_doc');
    expect(initiative1).toContain('fixture-project-dirty-status');
    expect(initiative1).toContain('Linked tasks: 1');

    // Initiative-4-style transitional off-project links render at the
    // initiative level (audit A3 tolerance, INV-2).
    const initiative4 = readFileSync(
      join(mirrorDir, 'initiatives', '4.md'),
      'utf8',
    );
    expect(initiative4).toContain('Linked tasks: 10, 20');
    expect(initiative4).toContain('Linked backlog: 5');

    // Dirty-data parse still succeeds (INV-1) and surfaces non-fatal
    // gitignored-substrate warnings (D2) rather than rejecting.
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('creates the retros/ dir (does not pre-exist) and emits retros/{session}.md', () => {
    expect(existsSync(join(mirrorDir, 'retros'))).toBe(false);

    const result = generateRetrosMirror(mirrorDir);

    expect(existsSync(join(mirrorDir, 'retros'))).toBe(true);
    expect(result.written).toEqual([join(mirrorDir, 'retros', 'S1.md')]);
    expect(result.deleted).toEqual([]);

    const retroS1 = readFileSync(join(mirrorDir, 'retros', 'S1.md'), 'utf8');
    expect(retroS1).toContain('type: retro');
    expect(retroS1).toContain('id: "S1"');
    expect(retroS1).toContain('session_id: kh-main-S1');
    // Six-category retro narrative body.
    expect(retroS1).toContain('## Bugs discovered');
    expect(retroS1).toContain('Fixture bug finding for test assertions.');
    expect(retroS1).toContain('## Failed assumptions');
    expect(retroS1).toContain('## Architecture decisions');
    expect(retroS1).toContain('## Rejected approaches');
    expect(retroS1).toContain('## Workflow improvements');
    expect(retroS1).toContain('## Unresolved questions');
  });

  it('deletes a stale retros/{session}.md no longer present in the source doc', () => {
    mkdirSync(join(mirrorDir, 'retros'), { recursive: true });
    writeFileSync(join(mirrorDir, 'retros', 'S999.md'), 'stale\n');

    const result = generateRetrosMirror(mirrorDir);

    expect(result.deleted).toEqual([join(mirrorDir, 'retros', 'S999.md')]);
    expect(existsSync(join(mirrorDir, 'retros', 'S999.md'))).toBe(false);
  });

  it('regen-mirrors.sh is wired to the KH-native generators and MIRROR_DIRS drops roadmap for initiatives+retros', () => {
    const script = readFileSync(
      resolve(__dirname, '../../scripts/regen-mirrors.sh'),
      'utf8',
    );
    expect(script).toContain('generate-initiatives-mirror.ts');
    expect(script).toContain('generate-retros-mirror.ts');
    // roadmap retired under ID-148 — no more product-roadmap.json --check.
    expect(script).not.toContain('product-roadmap.json');
    const mirrorDirsLine = script
      .split('\n')
      .find((line) => line.trimStart().startsWith('MIRROR_DIRS='));
    expect(mirrorDirsLine).toBeDefined();
    expect(mirrorDirsLine).toContain('/tasks"');
    expect(mirrorDirsLine).toContain('/backlog"');
    expect(mirrorDirsLine).toContain('/initiatives"');
    expect(mirrorDirsLine).toContain('/retros"');
    expect(mirrorDirsLine).not.toContain('/roadmap"');
  });
});
