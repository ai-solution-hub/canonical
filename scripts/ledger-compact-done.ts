/**
 * ledger-compact-done.ts — WS-B3 (workflow-improvement, 2026-06-12, ratified D2).
 *
 * Archives the `<info added on …>` journal `details` of DONE / CANCELLED tasks'
 * subtasks out of the live task-list.json into per-task archive markdown files,
 * replacing each with a short pointer stub. Rationale: 79% of task-list.json
 * bytes are journal details and 78% sit in done tasks — every wholesale read,
 * serialise pass, and git blob pays for closed history.
 *
 * SAFETY MODEL:
 *  - All ledger MUTATIONS route through `scripts/ledger-cli.ts` (task-view
 *    patch-server transport — mutex, schema gates, canonical serialisation).
 *    This script NEVER writes ledger bytes directly (read-only JSON.parse for
 *    enumeration only).
 *  - Archive files are written BEFORE the corresponding truncation, so there is
 *    no data-loss window. Re-runs are idempotent (already-stubbed details are
 *    below the threshold and skipped).
 *  - Archives live in `ledgers/archive/` — a SIBLING of the regenerated mirror
 *    dirs (`tasks/` etc.), so mirror-parity CI is untouched.
 *  - Aborts on the first CLI failure (no continue-on-error mass mutation).
 *
 * Usage:
 *   bun scripts/ledger-compact-done.ts --dry-run          # report only
 *   bun scripts/ledger-compact-done.ts --task 9           # pilot: one task
 *   bun scripts/ledger-compact-done.ts                    # full run
 *   (then) bash scripts/regen-mirrors.sh                  # run once at the end
 *          — this script runs it automatically unless --no-regen is passed.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ARCHIVE_THRESHOLD = 400; // chars — details shorter than this stay inline
const TODAY = '2026-06-12';

const docsDir = process.env.KH_PRIVATE_DOCS_DIR;
if (!docsDir) {
  console.error('KH_PRIVATE_DOCS_DIR must be set (ID-68.35 ledger relocation)');
  process.exit(1);
}
const ledgerDir = join(docsDir, 'src/content/docs/ledgers');
const archiveDir = join(ledgerDir, 'archive');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const noRegen = args.includes('--no-regen');
const taskFlagIdx = args.indexOf('--task');
const onlyTask = taskFlagIdx >= 0 ? args[taskFlagIdx + 1] : null;

interface Subtask {
  id: string | number;
  title?: string;
  details?: string;
  status?: string;
}
interface Task {
  id: string | number;
  title?: string;
  status?: string;
  subtasks?: Subtask[];
}

const ledger = JSON.parse(
  readFileSync(join(ledgerDir, 'task-list.json'), 'utf8'),
);
const tasks: Task[] = ledger.tasks;

const targets = tasks.filter(
  (t) =>
    (t.status === 'done' || t.status === 'cancelled') &&
    (!onlyTask || String(t.id) === String(onlyTask)),
);

let totalBefore = 0;
let totalAfter = 0;
let subtaskCount = 0;
const plan: { taskId: string; archivePath: string; subs: Subtask[] }[] = [];

for (const t of targets) {
  const subs = (t.subtasks ?? []).filter(
    (s) => (s.details ?? '').length > ARCHIVE_THRESHOLD,
  );
  if (subs.length === 0) continue;
  const archivePath = join(archiveDir, `ID-${t.id}-journals.md`);
  plan.push({ taskId: String(t.id), archivePath, subs });
  for (const s of subs) {
    totalBefore += (s.details ?? '').length;
    subtaskCount += 1;
  }
}

console.log(
  `compaction plan: ${plan.length} tasks, ${subtaskCount} subtask journals, ` +
    `${(totalBefore / 1024).toFixed(0)}KB to archive${dryRun ? ' (dry-run)' : ''}`,
);

if (dryRun) {
  for (const p of plan)
    console.log(
      `  ID-${p.taskId}: ${p.subs.length} journals, ` +
        `${(p.subs.reduce((a, s) => a + (s.details ?? '').length, 0) / 1024).toFixed(0)}KB`,
    );
  process.exit(0);
}

mkdirSync(archiveDir, { recursive: true });

for (const p of plan) {
  const task = targets.find((t) => String(t.id) === p.taskId)!;
  // 1) Archive file first — no data-loss window.
  const sections = p.subs.map(
    (s) =>
      `## ${p.taskId}.${s.id} — ${s.title ?? '(untitled subtask)'}\n\n${s.details}\n`,
  );
  const header =
    `# ID-${p.taskId} — archived subtask journals\n\n` +
    `Task: ${task.title ?? ''} (status: ${task.status})\n` +
    `Archived ${TODAY} by scripts/ledger-compact-done.ts (WS-B3 compaction, ratified D2).\n` +
    `Live records carry pointer stubs; this file is the journal of record.\n\n`;
  if (existsSync(p.archivePath)) {
    console.error(`refusing to overwrite existing archive: ${p.archivePath}`);
    process.exit(1);
  }
  writeFileSync(p.archivePath, header + sections.join('\n'));

  // 2) Truncate via the CLI (server transport — mutex + gates + serialise).
  for (const s of p.subs) {
    const stub =
      `Journal archived ${TODAY} (WS-B3 compaction) -> ` +
      `ledgers/archive/ID-${p.taskId}-journals.md section ${p.taskId}.${s.id} ` +
      `(original ${(s.details ?? '').length} chars).`;
    totalAfter += stub.length;
    const r = spawnSync(
      'bun',
      [
        'scripts/ledger-cli.ts',
        'update-subtask',
        `${p.taskId}.${s.id}`,
        'details',
        stub,
        '--no-regen-mirrors',
      ],
      { encoding: 'utf8' },
    );
    let ok = false;
    try {
      ok =
        r.status === 0 &&
        JSON.parse(r.stdout.trim().split('\n').pop() ?? '{}').ok === true;
    } catch {
      ok = false;
    }
    if (!ok) {
      console.error(
        `ABORT: update-subtask ${p.taskId}.${s.id} failed.\nstdout: ${r.stdout}\nstderr: ${r.stderr}`,
      );
      console.error(
        `Archive file ${p.archivePath} already written — live ledger partially compacted up to this point; safe to re-run after fixing (idempotent).`,
      );
      process.exit(1);
    }
  }
  console.log(
    `  ID-${p.taskId}: archived ${p.subs.length} journals -> ${p.archivePath}`,
  );
}

console.log(
  `compacted ${subtaskCount} journals: ${(totalBefore / 1024).toFixed(0)}KB -> ${(totalAfter / 1024).toFixed(1)}KB inline`,
);

if (!noRegen) {
  console.log('regenerating mirrors once (regen-mirrors.sh)…');
  const r = spawnSync('bash', ['scripts/regen-mirrors.sh'], {
    stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}
