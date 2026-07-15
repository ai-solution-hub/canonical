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

// ── stop-worker.sh --archive (ID-48.15) + default-archive + token-rollup (ID-48.17) ──
//
// The script's teardown step `rm -rf "$EVENTS_DIR"` destroys the per-worker
// artefacts the evaluator data layer (ID-48.5 / ID-48.14) depends on. Archive
// copies the four canonical artefacts
// ({events.jsonl, oq-pending.md, final_report.yaml, meta.json}) to
// <dir>/<worker-name>/ BEFORE the rm -rf.
//
// ID-48.17 makes archive the DEFAULT teardown behaviour (opt OUT via
// --no-archive, fixes S280 B1/B2), derives a default archive dir from
// meta.json when no --archive <dir> is given, and at archive time invokes the
// token roll-up (lib/workflow-evaluation/token-rollup.ts) over
// meta.json.session_id to write token_usage_by_role + token_usage_total into
// the archived final_report.yaml.
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

function setupHarness(opts?: {
  omitFiles?: string[];
  meta?: Record<string, unknown>;
}): Harness {
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
    'meta.json': JSON.stringify(
      opts?.meta ?? {
        worker: workerName,
        session_id: sessionId,
      },
    ),
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
  opts?: { cwd?: string; home?: string },
): ReturnType<typeof spawnSync> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    KH_CMUX_EVENTS_DIR: h.eventsBase,
    // ID-68 PC-25 (64c9d72c): the default ARCHIVE_BASE resolves
    // ${KH_PRIVATE_DOCS_DIR:?fail-loud}/src/content/docs/workflow-evaluation/sessions — pin the
    // knob inside the harness tmp tree so default-derivation tests exercise
    // the real contract without touching a live private-docs checkout.
    KH_PRIVATE_DOCS_DIR: join(h.tmp, 'kh-private-docs'),
    // Force the meta-derived worktree path off (no `cwd` in meta), and
    // bypass the launch-worker naming fallback by pointing PROJECT_ROOT at
    // a directory whose `.claude/worktrees/<worker>` does not exist.
    PATH: process.env.PATH ?? '',
  };
  if (opts?.home) env.HOME = opts.home;
  return spawnSync('bash', [SCRIPT, h.workerName, h.sessionId, ...extraArgs], {
    encoding: 'utf8',
    env,
    // Default cwd: h.tmp so `git rev-parse --show-toplevel` fail-softs to `pwd`,
    // pinning PROJECT_ROOT inside the temp tree (archive default lands there).
    cwd: opts?.cwd ?? h.tmp,
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

  it('--no-archive opts OUT — no corpus is archived (the prior opt-in teardown)', () => {
    // ID-48.17: archive is now the DEFAULT; --no-archive restores the old
    // "drop the corpus" behaviour for throwaway workers.
    harness = setupHarness();
    const r = runStopWorker(harness, ['--no-archive']);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    // Teardown rm -rf still runs.
    expect(existsSync(harness.eventsDir)).toBe(false);
    // No archive subdir created — neither the explicit base nor the derived
    // default under PROJECT_ROOT (= h.tmp here).
    expect(existsSync(join(harness.archiveBase, harness.workerName))).toBe(
      false,
    );
    const derivedDefault = join(
      harness.tmp,
      'kh-private-docs/src/content/docs/workflow-evaluation/sessions',
      `session-${harness.sessionId}`,
      harness.workerName,
    );
    expect(existsSync(derivedDefault)).toBe(false);
  });

  it('archives by DEFAULT (no flag) to a dir derived from meta.json', () => {
    // ID-48.17 B1/B2 fix: a bare `stop-worker.sh <name> <sid>` preserves the
    // corpus. PROJECT_ROOT fail-softs to cwd (h.tmp); no session_number in meta
    // => segment falls back to session-<SESSION_ID>.
    harness = setupHarness();
    const r = runStopWorker(harness, []);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(existsSync(harness.eventsDir)).toBe(false);

    const derived = join(
      harness.tmp,
      'kh-private-docs/src/content/docs/workflow-evaluation/sessions',
      `session-${harness.sessionId}`,
      harness.workerName,
    );
    expect(existsSync(join(derived, 'events.jsonl'))).toBe(true);
    expect(existsSync(join(derived, 'final_report.yaml'))).toBe(true);
    expect(existsSync(join(derived, 'meta.json'))).toBe(true);
  });

  it('derives the default dir from meta.session_number when present (S<NNN>)', () => {
    harness = setupHarness({
      meta: {
        worker: 'agent-test-archive-fixture',
        session_id: 'kh-session-archive-fixture',
        session_number: 'S282',
      },
    });
    const r = runStopWorker(harness, []);

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    const derived = join(
      harness.tmp,
      'kh-private-docs/src/content/docs/workflow-evaluation/sessions',
      'S282',
      harness.workerName,
    );
    expect(existsSync(join(derived, 'meta.json'))).toBe(true);
  });

  it('writes token_usage_by_role + token_usage_total into the archived final_report.yaml', () => {
    // ID-48.17 token roll-up. The script resolves token-rollup.ts under
    // PROJECT_ROOT, so run with cwd = REPO_ROOT (git rev-parse resolves the
    // real repo root). Point HOME at a fixture ~/.claude/projects tree whose
    // transcript carries KNOWN message.usage rows; assert the summed total
    // lands in the archived final_report.yaml.
    harness = setupHarness();

    const fakeHome = mkdtempSync(join(tmpdir(), 'kh-stop-worker-home-'));
    const encodedCwd = REPO_ROOT.replace(/[/.]/g, '-');
    const projDir = join(fakeHome, '.claude', 'projects', encodedCwd);
    mkdirSync(projDir, { recursive: true });

    // Two assistant turns: total = (100+20+500+1000) + (50+10+0+2000) = 3680.
    const transcript = [
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 100,
            output_tokens: 20,
            cache_creation_input_tokens: 500,
            cache_read_input_tokens: 1000,
          },
        },
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          usage: {
            input_tokens: 50,
            output_tokens: 10,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 2000,
          },
        },
      }),
      '',
    ].join('\n');
    writeFileSync(join(projDir, `${harness.sessionId}.jsonl`), transcript);

    const r = runStopWorker(harness, ['--archive', harness.archiveBase], {
      cwd: REPO_ROOT,
      home: fakeHome,
    });

    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

    const archivedReport = join(
      harness.archiveBase,
      harness.workerName,
      'final_report.yaml',
    );
    expect(existsSync(archivedReport)).toBe(true);
    const yaml = readFileSync(archivedReport, 'utf8');
    expect(yaml).toContain('token_usage_total: 3680');
    expect(yaml).toContain('token_usage_by_role:');
    expect(yaml).toContain('sub_orchestrator:');
    // Existing keys preserved.
    expect(yaml).toContain('status: ok');

    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('rejects --archive without a directory argument', () => {
    harness = setupHarness();
    const r = runStopWorker(harness, ['--archive']);

    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/--archive/);
  });
});

// ── stop-worker.sh auto-commit (ID-150.1, OQ-2A) ──
//
// S472 found archived corpus sitting uncommitted for days in the docs-site
// checkout because the archive step only ever COPIED artefacts, never
// committed them. These tests git-init a real repo at the harness's
// KH_PRIVATE_DOCS_DIR and exercise the auto-commit path added after the
// artefact copy: SCOPED `git add` (never `-A` / `.`), commit, best-effort
// push, no-op guard, and fail-open push failure (never aborts teardown).

function initDocsSiteRepo(dir: string, opts?: { withRemote?: boolean }): void {
  mkdirSync(dir, { recursive: true });
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'kh-test@example.com'], {
    cwd: dir,
  });
  spawnSync('git', ['config', 'user.name', 'KH Test'], { cwd: dir });
  if (opts?.withRemote) {
    // A real bare remote so `git push` (no args) can succeed — used by the
    // no-op-guard test, which needs a fully clean/committed state after
    // run 1 (no leftover archive-push-FAILED marker) to assert run 2 is a
    // true no-op. `push.autoSetupRemote` lets the script's bare `git push`
    // set the upstream on first push without an explicit `-u`.
    const bareDir = join(dir, '..', 'remote.git');
    mkdirSync(bareDir, { recursive: true });
    spawnSync('git', ['init', '-q', '--bare'], { cwd: bareDir });
    spawnSync('git', ['remote', 'add', 'origin', bareDir], { cwd: dir });
    spawnSync('git', ['config', 'push.autoSetupRemote', 'true'], {
      cwd: dir,
    });
  }
}

describe('stop-worker.sh archive auto-commit', () => {
  let harness: Harness | null = null;

  afterEach(() => {
    if (harness) {
      rmSync(harness.tmp, { recursive: true, force: true });
      harness = null;
    }
  });

  it('auto-commits the archived segment with a SCOPED git add (never -A), and fails open on push', () => {
    harness = setupHarness();
    const docsSiteDir = join(harness.tmp, 'kh-private-docs');
    initDocsSiteRepo(docsSiteDir);

    // A DIFFERENT, unrelated in-flight file elsewhere in the same checkout
    // (another lane's uncommitted work) — proves the scoped `git add` never
    // sweeps it in.
    const unrelatedDir = join(docsSiteDir, 'src/content/docs/unrelated');
    mkdirSync(unrelatedDir, { recursive: true });
    writeFileSync(
      join(unrelatedDir, 'other-lane.md'),
      'unrelated in-flight work\n',
    );

    const r = runStopWorker(harness, []);
    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

    const segmentRel = `src/content/docs/workflow-evaluation/sessions/session-${harness.sessionId}`;

    // The archived segment landed in a real commit.
    const log = spawnSync('git', ['log', '--name-only', '--pretty=%s'], {
      cwd: docsSiteDir,
      encoding: 'utf8',
    });
    expect(log.stdout).toContain('chore(workflow-eval): archive session');
    expect(log.stdout).toContain(harness.workerName);
    expect(log.stdout).toContain(
      `${segmentRel}/${harness.workerName}/meta.json`,
    );
    expect(log.stdout).toContain(
      `${segmentRel}/${harness.workerName}/events.jsonl`,
    );

    // The unrelated in-flight file was NEVER staged or committed — proof
    // the `git add` was scoped to the session segment, not `-A` / `.`.
    expect(log.stdout).not.toContain('other-lane.md');
    const status = spawnSync('git', ['status', '--porcelain'], {
      cwd: docsSiteDir,
      encoding: 'utf8',
    });
    // git collapses an entirely-untracked directory to its dir line rather
    // than expanding every file — either form proves the file was never
    // staged/committed.
    expect(status.stdout).toContain('src/content/docs/unrelated/');

    // Push has no remote configured => fails open: teardown still exits 0
    // (asserted above) and a loud marker is dropped rather than the
    // failure being swallowed or aborting teardown.
    const archived = join(
      docsSiteDir,
      segmentRel,
      harness.workerName,
      'archive-push-FAILED',
    );
    expect(existsSync(archived)).toBe(true);
    expect(r.stderr).toMatch(/PUSH FAILED/);
  });

  it('no-op guards a re-run with nothing new to commit (no error, no empty commit)', () => {
    harness = setupHarness();
    const docsSiteDir = join(harness.tmp, 'kh-private-docs');
    // withRemote: run 1's push must SUCCEED (leaving no archive-push-FAILED
    // marker) so run 2 starts from a fully clean/committed tree — otherwise
    // a leftover marker file would itself be new, untracked content and
    // legitimately produce a second commit, confounding the no-op assertion.
    initDocsSiteRepo(docsSiteDir, { withRemote: true });

    const r1 = runStopWorker(harness, []);
    expect(r1.status, `stderr: ${r1.stderr}\nstdout: ${r1.stdout}`).toBe(0);
    expect(r1.stderr).not.toMatch(/PUSH FAILED/);

    const commitCount = (): number => {
      const log = spawnSync('git', ['log', '--oneline'], {
        cwd: docsSiteDir,
        encoding: 'utf8',
      });
      return log.stdout.trim().length === 0
        ? 0
        : log.stdout.trim().split('\n').length;
    };
    const countAfterFirst = commitCount();
    expect(countAfterFirst).toBeGreaterThan(0);

    // Re-populate the events dir with IDENTICAL content, simulating a
    // re-run over an already-archived + already-committed segment.
    mkdirSync(harness.eventsDir, { recursive: true });
    writeFileSync(
      join(harness.eventsDir, 'events.jsonl'),
      '{"event":"session_start"}\n{"event":"session_end"}\n',
    );
    writeFileSync(
      join(harness.eventsDir, 'oq-pending.md'),
      '# Open questions\n\n- Test OQ entry.\n',
    );
    writeFileSync(
      join(harness.eventsDir, 'final_report.yaml'),
      'status: ok\ncommits: []\n',
    );
    writeFileSync(
      join(harness.eventsDir, 'meta.json'),
      JSON.stringify({
        worker: harness.workerName,
        session_id: harness.sessionId,
      }),
    );

    const r2 = runStopWorker(harness, []);
    expect(r2.status, `stderr: ${r2.stderr}\nstdout: ${r2.stdout}`).toBe(0);
    expect(commitCount()).toBe(countAfterFirst);
    // No push-failure noise on the no-op path — the no-op guard short-
    // circuits before any commit/push attempt.
    expect(r2.stderr).not.toMatch(/PUSH FAILED/);
  });

  it('skips auto-commit (no error) when the archive target is a custom dir outside KH_PRIVATE_DOCS_DIR', () => {
    harness = setupHarness();
    // KH_PRIVATE_DOCS_DIR is set by the harness but never git-initialised
    // here, and --archive points at a sibling dir outside it — the
    // existing explicit-archive-dir test shape (harness.archiveBase).
    const r = runStopWorker(harness, ['--archive', harness.archiveBase]);
    expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);
    expect(
      existsSync(join(harness.archiveBase, harness.workerName, 'meta.json')),
    ).toBe(true);
    expect(r.stderr).toMatch(/outside KH_PRIVATE_DOCS_DIR/);
  });
});
