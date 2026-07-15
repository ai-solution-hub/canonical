import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

// ── launch-worker.sh session_number conditional-omit (ID-150.3, OQ-3) ──
//
// Coverage note (what this covers, and why NOT full end-to-end):
// launch-worker.sh hard-requires a live cmux daemon + a real `claude`
// binary on PATH (the `command -v cmux/claude`, `cmux list-workspaces`
// daemon-probe, and `cmux --json list-workspaces` collision checks at the
// top of the script) before it ever reaches EITHER `jq -n` emission site,
// and then polls up to 30s for a `session_start` event that nothing in a
// bare test environment would emit (that event only appears once a live
// Claude session's hooks fire). Driving the full script end-to-end would
// mean either standing up a fake cmux daemon or accepting a 30s-per-branch
// timeout with the meta.json it wrote then deleted by the failure-path
// teardown before assertions could run — impractical, per this Subtask's
// documented fallback.
//
// Instead this test EXTRACTS the two literal `jq -n ...` snippets straight
// out of the REAL script text (never a hand-copied duplicate of the
// filter — a future edit to either snippet is picked up automatically,
// so this test cannot silently drift from the source it verifies) and
// executes each extracted snippet directly via `bash -c` with the handful
// of shell variables it references pre-seeded. This proves the actual
// conditional jq filter for BOTH emission sites:
//   - site 1 (~L292): the meta.json file write.
//   - site 2 (~L409): the stdout "Output result JSON" (kept in sync with
//     site 1 per the same edit).
// Both branches are exercised for both sites: KH_SESSION_NUMBER set =>
// `session_number` key present with the verbatim value; KH_SESSION_NUMBER
// unset => the key is entirely ABSENT (asserted via `hasOwnProperty` and a
// raw-string `not.toContain`, not merely "falsy" — a fabricated
// `session_number: null` would pass a weaker check but violates the
// brief's "never write null" requirement).

const REPO_ROOT = resolve(__dirname, '../..');
const SCRIPT_PATH = join(
  REPO_ROOT,
  '.claude/skills/session-driver-cmux/scripts/launch-worker.sh',
);
const SCRIPT_SRC = readFileSync(SCRIPT_PATH, 'utf8');

function extractSnippet(source: string, site: 1 | 2): string {
  const marker = 'jq -n \\';
  const firstIdx = source.indexOf(marker);
  if (firstIdx === -1) {
    throw new Error('launch-worker.sh: no "jq -n \\" emission site found');
  }
  if (site === 1) {
    const endMarker = '> "$META_FILE"';
    const endIdx = source.indexOf(endMarker, firstIdx);
    if (endIdx === -1) {
      throw new Error(
        'launch-worker.sh: site-1 jq snippet has no "> \\"$META_FILE\\"" redirect — extraction marker stale?',
      );
    }
    return source.slice(firstIdx, endIdx + endMarker.length);
  }
  const secondIdx = source.indexOf(marker, firstIdx + marker.length);
  if (secondIdx === -1) {
    throw new Error(
      'launch-worker.sh: only one "jq -n \\" emission site found — expected two',
    );
  }
  return source.slice(secondIdx).trim();
}

const SITE1_SNIPPET = extractSnippet(SCRIPT_SRC, 1);
const SITE2_SNIPPET = extractSnippet(SCRIPT_SRC, 2);

function runBash(prelude: string, snippet: string) {
  return spawnSync(
    'bash',
    ['-c', `set -euo pipefail\n${prelude}\n${snippet}\n`],
    { encoding: 'utf8' },
  );
}

describe('launch-worker.sh meta emission — session_number (ID-150.3)', () => {
  it('sanity: both extracted snippets reference KH_SESSION_NUMBER (guards against a silent extraction miss)', () => {
    expect(SITE1_SNIPPET).toContain('KH_SESSION_NUMBER');
    expect(SITE1_SNIPPET).toContain('> "$META_FILE"');
    expect(SITE2_SNIPPET).toContain('KH_SESSION_NUMBER');
  });

  describe('site 1 — meta.json write', () => {
    it('includes session_number verbatim when KH_SESSION_NUMBER is set', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'kh-launch-worker-meta-'));
      const metaFile = join(tmp, 'meta.json');
      const prelude = [
        'WORKER_NAME="test-worker"',
        'SESSION_ID="test-session-id"',
        'WORKTREE_PATH="/tmp/fixture-worktree"',
        'PROJECT_ROOT="/tmp/fixture-project"',
        'BRANCH_NAME="cmux-worker-test-abc123"',
        'BRIEF_DEST=""',
        `META_FILE="${metaFile}"`,
        'export KH_SESSION_NUMBER="S999"',
      ].join('\n');

      const r = runBash(prelude, SITE1_SNIPPET);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

      const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
      expect(meta.session_number).toBe('S999');
      // Existing fields preserved alongside the new key.
      expect(meta.worker_name).toBe('test-worker');
      expect(meta.branch).toBe('cmux-worker-test-abc123');

      rmSync(tmp, { recursive: true, force: true });
    });

    it('omits the session_number key entirely when KH_SESSION_NUMBER is unset', () => {
      const tmp = mkdtempSync(join(tmpdir(), 'kh-launch-worker-meta-'));
      const metaFile = join(tmp, 'meta.json');
      const prelude = [
        'WORKER_NAME="test-worker"',
        'SESSION_ID="test-session-id"',
        'WORKTREE_PATH="/tmp/fixture-worktree"',
        'PROJECT_ROOT="/tmp/fixture-project"',
        'BRANCH_NAME="cmux-worker-test-abc123"',
        'BRIEF_DEST=""',
        `META_FILE="${metaFile}"`,
        'unset KH_SESSION_NUMBER || true',
      ].join('\n');

      const r = runBash(prelude, SITE1_SNIPPET);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

      const raw = readFileSync(metaFile, 'utf8');
      const meta = JSON.parse(raw);
      expect(Object.prototype.hasOwnProperty.call(meta, 'session_number')).toBe(
        false,
      );
      expect(raw).not.toContain('session_number');
      // Existing fields still land with no session_number in the mix.
      expect(meta.worker_name).toBe('test-worker');

      rmSync(tmp, { recursive: true, force: true });
    });
  });

  describe('site 2 — stdout result JSON', () => {
    it('includes session_number verbatim when KH_SESSION_NUMBER is set', () => {
      const prelude = [
        'SESSION_ID="test-session-id"',
        'WORKER_NAME="test-worker"',
        'WS_REF="workspace:1"',
        'WORKTREE_PATH="/tmp/fixture-worktree"',
        'EVENT_FILE="/tmp/fixture-events/events.jsonl"',
        'EVENTS_DIR="/tmp/fixture-events"',
        'BRANCH_NAME="cmux-worker-test-abc123"',
        'BRIEF_DEST=""',
        'export KH_SESSION_NUMBER="S999"',
      ].join('\n');

      const r = runBash(prelude, SITE2_SNIPPET);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

      const result = JSON.parse(r.stdout);
      expect(result.session_number).toBe('S999');
      expect(result.session_id).toBe('test-session-id');
    });

    it('omits the session_number key entirely when KH_SESSION_NUMBER is unset', () => {
      const prelude = [
        'SESSION_ID="test-session-id"',
        'WORKER_NAME="test-worker"',
        'WS_REF="workspace:1"',
        'WORKTREE_PATH="/tmp/fixture-worktree"',
        'EVENT_FILE="/tmp/fixture-events/events.jsonl"',
        'EVENTS_DIR="/tmp/fixture-events"',
        'BRANCH_NAME="cmux-worker-test-abc123"',
        'BRIEF_DEST=""',
        'unset KH_SESSION_NUMBER || true',
      ].join('\n');

      const r = runBash(prelude, SITE2_SNIPPET);
      expect(r.status, `stderr: ${r.stderr}\nstdout: ${r.stdout}`).toBe(0);

      const stdout = r.stdout;
      const result = JSON.parse(stdout);
      expect(
        Object.prototype.hasOwnProperty.call(result, 'session_number'),
      ).toBe(false);
      expect(stdout).not.toContain('session_number');
    });
  });
});
