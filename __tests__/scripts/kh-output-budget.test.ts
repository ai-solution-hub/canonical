import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve, join } from 'node:path';

/**
 * Behaviour suite for the kh-output-budget wrapper CLI (ID-92 §A1.W).
 *
 * Per test-philosophy.md these tests assert OBSERVABLE behaviour — the wrapper's
 * stdout, stderr, exit code, and the machine-visible receipt fields — by spawning
 * the real CLI binary. They do not reach into internal byte arithmetic.
 *
 * Spec: docs/specs/id-92-workflow-efficiency-hardening/TECH.md §A1.W.1–A1.W.5.
 */

const REPO = resolve(__dirname, '../..');
const CLI = join(REPO, 'scripts/kh-output-budget.ts');

/**
 * Run the wrapper CLI with the given wrapper-flags, wrapping an inner command
 * that emits a deterministic stdout/stderr/exit-code. We use `node -e` as the
 * wrapped command so the wrapped output is fully controlled by the test.
 */
function runWrapper(
  wrapperFlags: string[],
  wrappedArgv: string[],
): { stdout: string; stderr: string; status: number } {
  const r = spawnSync('bun', [CLI, ...wrapperFlags, '--', ...wrappedArgv], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 64,
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

/** A node `-e` program that prints `count` lines of `prefix<n>` to stdout. */
function emitLinesProgram(prefix: string, count: number): string[] {
  return [
    'node',
    '-e',
    `for (let i = 0; i < ${count}; i++) process.stdout.write('${prefix}' + i + '\\n');`,
  ];
}

describe('kh-output-budget wrapper CLI', () => {
  describe('over-budget diff mode (A1.W.2 + A1.W.3)', () => {
    it('emits a truncated:true receipt with original_length, shown and a --full escape, retaining the --stat summary ahead of the hunks', () => {
      // Build a synthetic git diff: a --stat summary block followed by a large
      // per-file hunk. The wrapper must keep the summary and append leading hunk
      // bytes only, then attach the receipt.
      const summary =
        ' path/to/file.ts | 400 ++++\n 1 file changed, 400 insertions(+)\n';
      const hunkHeader =
        'diff --git a/path/to/file.ts b/path/to/file.ts\n@@ -1,1 +1,400 @@\n';
      const bigBody =
        Array.from({ length: 400 }, (_, i) => `+line ${i}`).join('\n') + '\n';
      const fakeDiff = summary + hunkHeader + bigBody;
      const program = [
        'node',
        '-e',
        `process.stdout.write(${JSON.stringify(fakeDiff)});`,
      ];

      // Force diff mode and a small budget so truncation is guaranteed.
      const { stdout, status } = runWrapper(
        ['--mode', 'diff', '--budget', '256'],
        program,
      );

      expect(status).toBe(0);
      // Receipt is present and machine-parseable.
      expect(stdout).toContain('truncated: true');
      expect(stdout).toMatch(/original_length: \d+/);
      expect(stdout).toMatch(/shown: \d+/);
      // The escape is the exact --full re-invocation.
      expect(stdout).toContain(
        'escape: bun scripts/kh-output-budget.ts --full --mode diff --',
      );

      // Split the wrapper output into the SHOWN diff body and the receipt block;
      // behaviour assertions about truncation must target the shown body only
      // (the escape line legitimately echoes the full original argv).
      const receiptStart = stdout.indexOf(
        '--- kh-output-budget: truncated ---',
      );
      expect(receiptStart).toBeGreaterThan(0);
      const shownBody = stdout.slice(0, receiptStart);

      // The --stat summary is retained ahead of the leading hunks.
      expect(shownBody).toContain('1 file changed, 400 insertions(+)');
      expect(shownBody).toContain('diff --git a/path/to/file.ts');
      // It is genuinely truncated — the tail of the 400-line body is not shown.
      expect(shownBody).not.toContain('+line 399');
      expect(shownBody).toContain('+line 0');
      // original_length reflects the FULL byte count, larger than shown.
      const original = Number(/original_length: (\d+)/.exec(stdout)![1]);
      const shown = Number(/shown: (\d+)/.exec(stdout)![1]);
      expect(original).toBeGreaterThan(shown);
    });
  });

  describe('--full escape (A1.W.2 recovery path)', () => {
    it('re-emits the complete wrapped output with no truncation and no receipt', () => {
      const summary =
        ' path/to/file.ts | 400 ++++\n 1 file changed, 400 insertions(+)\n';
      const hunkHeader =
        'diff --git a/path/to/file.ts b/path/to/file.ts\n@@ -1,1 +1,400 @@\n';
      const bigBody =
        Array.from({ length: 400 }, (_, i) => `+line ${i}`).join('\n') + '\n';
      const fakeDiff = summary + hunkHeader + bigBody;
      const program = [
        'node',
        '-e',
        `process.stdout.write(${JSON.stringify(fakeDiff)});`,
      ];

      // Same small budget, but with --full the budget is disabled.
      const { stdout, status } = runWrapper(
        ['--full', '--mode', 'diff', '--budget', '256'],
        program,
      );

      expect(status).toBe(0);
      // No receipt, no truncation marker.
      expect(stdout).not.toContain('truncated: true');
      expect(stdout).not.toContain('kh-output-budget: truncated');
      // The COMPLETE body is present — including the last line that was elided before.
      expect(stdout).toContain('+line 0');
      expect(stdout).toContain('+line 399');
      expect(stdout).toBe(fakeDiff);
    });
  });

  describe('under-budget pass-through (A1.W.4)', () => {
    it('passes small output through verbatim with no truncation marker or receipt', () => {
      const program = emitLinesProgram('row', 3); // tiny output

      const { stdout, status } = runWrapper(
        ['--mode', 'generic', '--budget', '32768'],
        program,
      );

      expect(status).toBe(0);
      expect(stdout).toBe('row0\nrow1\nrow2\n');
      expect(stdout).not.toContain('truncated: true');
      expect(stdout).not.toContain('kh-output-budget');
    });
  });

  describe('degrade-safe failure (A1.W.4 — KH no-silent-failure)', () => {
    it('propagates the wrapped command real non-zero exit code and surfaces its stderr verbatim, never swallowing the failure', () => {
      // A wrapped command that writes a diagnostic to stderr then exits 17.
      const program = [
        'node',
        '-e',
        "process.stderr.write('boom: the underlying command failed\\n'); process.exit(17);",
      ];

      const { stdout, stderr, status } = runWrapper(
        ['--mode', 'generic'],
        program,
      );

      // Real exit code propagated (not coerced to 0).
      expect(status).toBe(17);
      // stderr surfaced verbatim.
      expect(stderr).toContain('boom: the underlying command failed');
      // The failure is not hidden behind a truncation envelope.
      expect(stdout).not.toContain('truncated: true');
    });

    it('surfaces stderr verbatim even when the wrapped command also produces over-budget stdout', () => {
      // stdout is large (would truncate), but stderr must still pass through and
      // the exit code must be the real one — truncation never masks the error.
      const program = [
        'node',
        '-e',
        "for (let i=0;i<5000;i++) process.stdout.write('out'+i+'\\n'); process.stderr.write('fatal: real error\\n'); process.exit(3);",
      ];

      const { stderr, status } = runWrapper(
        ['--mode', 'generic', '--budget', '256'],
        program,
      );

      expect(status).toBe(3);
      expect(stderr).toContain('fatal: real error');
    });
  });

  describe('over-budget log/generic mode keeps the tail (A1.W.3 — never head-only)', () => {
    it('--mode log retains the LAST lines (where failures live), not only the head', () => {
      // 2000 lines: the failure marker is on the very last line. Head-only would
      // drop it; head+tail must keep it.
      const program = [
        'node',
        '-e',
        "for (let i=0;i<2000;i++) process.stdout.write('logline'+i+'\\n'); process.stdout.write('FINAL_ERROR_MARKER\\n');",
      ];

      const { stdout, status } = runWrapper(
        ['--mode', 'log', '--budget', '512'],
        program,
      );

      expect(status).toBe(0);
      // Receipt present (it was over budget).
      expect(stdout).toContain('truncated: true');
      // Head is kept...
      expect(stdout).toContain('logline0');
      // ...and crucially the TAIL — the final error marker — is retained.
      expect(stdout).toContain('FINAL_ERROR_MARKER');
      // The middle is elided.
      expect(stdout).toContain('elided');
      // It is genuinely truncated (a middle line is gone).
      expect(stdout).not.toContain('logline1000');
    });

    it('--mode generic also keeps the tail under budget pressure', () => {
      const program = [
        'node',
        '-e',
        "for (let i=0;i<2000;i++) process.stdout.write('g'+i+'\\n'); process.stdout.write('TAIL_SENTINEL\\n');",
      ];

      const { stdout } = runWrapper(
        ['--mode', 'generic', '--budget', '512'],
        program,
      );

      expect(stdout).toContain('truncated: true');
      expect(stdout).toContain('TAIL_SENTINEL');
    });
  });

  describe('usage errors (no silent failure on malformed args)', () => {
    it('exits non-zero with a stderr message when no wrapped command is supplied', () => {
      const r = spawnSync('bun', [CLI, '--mode', 'generic', '--'], {
        cwd: REPO,
        encoding: 'utf8',
      });
      expect(r.status).not.toBe(0);
      expect(r.stderr ?? '').toContain('No wrapped command');
    });

    it('exits non-zero with guidance for an invalid --mode', () => {
      const r = spawnSync(
        'bun',
        [CLI, '--mode', 'sideways', '--', 'echo', 'hi'],
        {
          cwd: REPO,
          encoding: 'utf8',
        },
      );
      expect(r.status).not.toBe(0);
      expect(r.stderr ?? '').toContain(
        '--mode must be one of diff|log|generic',
      );
    });
  });

  describe('canonical `-- <command>` invocation with no wrapper flags', () => {
    it('still wraps the command when bun strips the leading `--` separator', () => {
      // `bun scripts/x.ts -- cmd` has its leading `--` consumed by bun itself,
      // so the script never sees it. The wrapper must still treat the remaining
      // argv as the wrapped command rather than erroring on an "unknown flag".
      const r = spawnSync(
        'bun',
        [CLI, '--', 'node', '-e', "process.stdout.write('hello\\n')"],
        {
          cwd: REPO,
          encoding: 'utf8',
        },
      );
      expect(r.status).toBe(0);
      expect(r.stdout ?? '').toBe('hello\n');
    });
  });

  describe('mode inference (A1.W.3 — small allowlist, not a parser)', () => {
    it('infers generic mode for a non-git command so the escape command echoes --mode generic', () => {
      const program = emitLinesProgram('x', 5000);
      const { stdout } = runWrapper(['--budget', '256'], program); // no --mode → infer generic
      expect(stdout).toContain('--mode generic');
    });
  });
});
