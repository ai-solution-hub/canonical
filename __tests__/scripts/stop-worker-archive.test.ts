import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  existsSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── stop-worker.sh --archive flag (ID-48.15) ──────────────────────────────
//
// The script's existing teardown step `rm -rf "$EVENTS_DIR"` destroys the
// per-worker artefacts the evaluator data layer (ID-48.5 / ID-48.14) depends on.
// The --archive <dir> flag must copy the four canonical artefacts
// ({events.jsonl, oq-pending.md, final_report.yaml, meta.json}) to
// <dir>/<worker-name>/ BEFORE the rm -rf, leaving the rest of the teardown
// path untouched.
//
// Driven via spawnSync — no cmux, no live worktree. The script's guard rails
// (`command -v cmux`, `[ -d "$WORKTREE_PATH" ]`) gracefully no-op when those
// surfaces are absent, so we exercise only the archival + teardown branches.

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT = join(
  REPO_ROOT,
  '.claude/skills/session-driver-cmux/scripts/stop-worker.sh',
);

interface Harness {
  tmp: string;
  eventsBase: string;
  eventsDir: string;
  archiveBase: string;
  workerName: string;
  sessionId: string;
}

function setupHarness(opts?: { omitFiles?: string[] }): Harness {
  const tmp = mkdtempSync(join(tmpdir(), 'kh-stop-worker-archive-'));
  const workerName = 'agent-test-archive-fixture';
  const sessionId = 'kh-session-archive-fixture';
  const eventsBase = join(tmp, 'cmux-events');
  const eventsDir = join(eventsBase, sessionId);
  const archiveBase = join(tmp, 'sessions', 'S999');
  mkdirSync(eventsDir, { recursive: true });
  mkdirSync(archiveBase, { recursive: true });

  const files: Record<string, string> = {
    'events.jsonl': '{"event":"session_start"}\n{"event":"session_end"}\n',
    'oq-pending.md': '# Open questions\n\n- Test OQ entry.\n',
    'final_report.yaml': 'status: ok\ncommits: []\n',
    'meta.json': JSON.stringify({
      worker: workerName,
      session_id: sessionId,
    }),
  };
  const omit = new Set(opts?.omitFiles ?? []);
  for (const [name, body] of Object.entries(files)) {
    if (omit.has(name)) continue;
    writeFileSync(join(eventsDir, name), body);
  }

  return { tmp, eventsBase, eventsDir, archiveBase, workerName, sessionId };
}

function runStopWorker(
  h: Harness,
  extraArgs: string[] = [],
): ReturnType<typeof spawnSync> {
  return spawnSync('bash', [SCRIPT, h.workerName, h.sessionId, ...extraArgs], {
    encoding: 'utf8',
    env: {
      ...process.env,
      KH_CMUX_EVENTS_DIR: h.eventsBase,
      // Force the meta-derived worktree path off (no `cwd` in meta), and
      // bypass the launch-worker naming fallback by pointing PROJECT_ROOT at
      // a directory whose `.claude/worktrees/<worker>` does not exist.
      PATH: process.env.PATH ?? '',
    },
    cwd: h.tmp, // make `git rev-parse --show-toplevel` fail-soft to `pwd`
  });
}

describe('stop-worker.sh --archive', () => {
  let harness: Harness | null = null;

  afterEach(() => {
    if (harness) {
      rmSync(harness.tmp, { recursive: true, force: true });
      harness = null;
    }
  });

  it('copies the 4 canonical artefacts under <archive-dir>/<worker>/ BEFORE teardown rm -rf', () => {
    harness = setupHarness();
    const r = runStopWorker(harness, ['--archive', harness.archiveBase]);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

    const archived = join(harness.archiveBase, harness.workerName);
    expect(existsSync(join(archived, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(archived, 'oq-pending.md'))).toBe(true);
    expect(existsSync(join(archived, 'final_report.yaml'))).toBe(true);
    expect(existsSync(join(archived, 'meta.json'))).toBe(true);

    // Round-trip the events payload to confirm we copied, not truncated.
    expect(readFileSync(join(archived, 'events.jsonl'), 'utf8')).toContain(
      'session_end',
    );

    // Teardown rm -rf must still have completed.
    expect(existsSync(harness.eventsDir)).toBe(false);
  });

  it('tolerates missing artefacts (logs + continues, no error)', () => {
    harness = setupHarness({
      omitFiles: ['oq-pending.md', 'final_report.yaml'],
    });
    const r = runStopWorker(harness, ['--archive', harness.archiveBase]);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

    const archived = join(harness.archiveBase, harness.workerName);
    expect(existsSync(join(archived, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(archived, 'meta.json'))).toBe(true);
    // Absent files must NOT materialise — archive is best-effort.
    expect(existsSync(join(archived, 'oq-pending.md'))).toBe(false);
    expect(existsSync(join(archived, 'final_report.yaml'))).toBe(false);

    expect(existsSync(harness.eventsDir)).toBe(false);
  });

  it('without --archive leaves prior teardown behaviour unchanged', () => {
    harness = setupHarness();
    const r = runStopWorker(harness, []);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // No archive base mutation expected — files only live in eventsDir,
    // which has been rm -rf'd.
    expect(existsSync(harness.eventsDir)).toBe(false);

    // The archive base remains empty (no <worker>/ subdir created).
    const archived = join(harness.archiveBase, harness.workerName);
    expect(existsSync(archived)).toBe(false);
  });

  it('rejects --archive without a directory argument', () => {
    harness = setupHarness();
    const r = runStopWorker(harness, ['--archive']);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--archive/);
  });
});
