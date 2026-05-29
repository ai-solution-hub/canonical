import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import {
  encodeCwd,
  patchReportWithRollup,
  resolveTranscriptPath,
  rollupSessionTokens,
  sumUsageFromTranscript,
} from '@/lib/workflow-evaluation/token-rollup';

// ── token-rollup (ID-48.17) ────────────────────────────────────────────────
//
// The roll-up joins a worker `meta.json.session_id` to its Claude Code session
// transcript (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`) and sums
// the real `message.usage` carried on every assistant row. Tests pin a fixture
// transcript with KNOWN usage rows and assert the summed totals, plus the
// durability contract (missing transcript → null + note, never throw).

// A fixture transcript with deterministic, hand-summable usage rows. Two
// assistant turns + a user row + a non-JSON noise line that must be tolerated.
const TURN_ONE = {
  type: 'assistant',
  message: {
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 500,
      cache_read_input_tokens: 1000,
    },
  },
};
const TURN_TWO = {
  type: 'assistant',
  message: {
    usage: {
      input_tokens: 50,
      output_tokens: 10,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 2000,
    },
  },
};
const USER_ROW = { type: 'user', message: { content: 'hello' } };

// Hand-computed expected sums.
const EXPECTED = {
  input: 150, // 100 + 50
  output: 30, // 20 + 10
  cache_creation: 500, // 500 + 0
  cache_read: 3000, // 1000 + 2000
  total: 3680, // 150 + 30 + 500 + 3000
};

function fixtureJsonl(): string {
  return [
    JSON.stringify(USER_ROW),
    JSON.stringify(TURN_ONE),
    JSON.stringify(USER_ROW),
    JSON.stringify(TURN_TWO),
    'this is a torn / non-JSON line and must be skipped',
    '', // trailing blank line
  ].join('\n');
}

describe('encodeCwd', () => {
  it('replaces every / and . with - (matches Claude Code projects dir naming)', () => {
    expect(encodeCwd('/Users/x/dev/.claude/worktrees/w')).toBe(
      '-Users-x-dev--claude-worktrees-w',
    );
  });
});

describe('sumUsageFromTranscript', () => {
  it('sums message.usage across assistant turns and tolerates noise', () => {
    const { totals, turns } = sumUsageFromTranscript(fixtureJsonl());
    expect(totals).toEqual(EXPECTED);
    expect(turns).toHaveLength(2);
    expect(turns[0]).toEqual({
      index: 0,
      input: 100,
      output: 20,
      cache_creation: 500,
      cache_read: 1000,
      total: 1620,
    });
    expect(turns[1].index).toBe(1);
    expect(turns[1].total).toBe(2060);
  });

  it('returns zero totals + empty turns for a transcript with no assistant usage', () => {
    const { totals, turns } = sumUsageFromTranscript(
      `${JSON.stringify(USER_ROW)}\n`,
    );
    expect(turns).toHaveLength(0);
    expect(totals.total).toBe(0);
  });
});

describe('rollupSessionTokens', () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it('resolves an explicit transcript path and returns summed totals', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kh-token-rollup-'));
    const transcript = join(tmp, 'session-abc.jsonl');
    writeFileSync(transcript, fixtureJsonl());

    const result = rollupSessionTokens({
      sessionId: 'session-abc',
      transcriptPath: transcript,
    });

    expect(result.totals).toEqual(EXPECTED);
    expect(result.turn_count).toBe(2);
    expect(result.transcript_path).toBe(transcript);
    expect(result.note).toBeNull();
  });

  it('resolves via encoded-cwd + projects-dir convention', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kh-token-rollup-'));
    const projectsDir = join(tmp, 'projects');
    const encoded = encodeCwd('/Users/test/dev/knowledge-hub');
    mkdirSync(join(projectsDir, encoded), { recursive: true });
    writeFileSync(join(projectsDir, encoded, 'sid-xyz.jsonl'), fixtureJsonl());

    const result = rollupSessionTokens({
      sessionId: 'sid-xyz',
      encodedCwd: encoded,
      projectsDir,
    });
    expect(result.totals?.total).toBe(EXPECTED.total);
  });

  it('emits null totals + a note when the transcript is missing (purged), never throws', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kh-token-rollup-'));
    const result = rollupSessionTokens({
      sessionId: 'does-not-exist',
      projectsDir: join(tmp, 'empty-projects'),
    });
    expect(result.totals).toBeNull();
    expect(result.turns).toHaveLength(0);
    expect(result.note).toMatch(/transcript not found/i);
  });
});

describe('resolveTranscriptPath', () => {
  it('returns null for an explicit path that does not exist', () => {
    expect(
      resolveTranscriptPath({
        sessionId: 's',
        transcriptPath: '/no/such/file.jsonl',
      }),
    ).toBeNull();
  });
});

describe('patchReportWithRollup', () => {
  let tmp: string | null = null;

  afterEach(() => {
    if (tmp) {
      rmSync(tmp, { recursive: true, force: true });
      tmp = null;
    }
  });

  it('patches token_usage_by_role + token_usage_total into a final_report.yaml', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kh-token-rollup-'));
    const report = join(tmp, 'final_report.yaml');
    writeFileSync(report, 'status: ok\ncommits: []\n');
    const transcript = join(tmp, 'session-abc.jsonl');
    writeFileSync(transcript, fixtureJsonl());

    const rollup = rollupSessionTokens({
      sessionId: 'session-abc',
      transcriptPath: transcript,
    });
    const wrote = patchReportWithRollup(report, rollup);
    expect(wrote).toBe(true);

    const doc = parseYaml(readFileSync(report, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(doc.status).toBe('ok'); // preserves existing keys
    expect(doc.token_usage_total).toBe(EXPECTED.total);
    const byRole = doc.token_usage_by_role as Record<
      string,
      Record<string, number>
    >;
    expect(byRole.sub_orchestrator.total).toBe(EXPECTED.total);
    expect(byRole.sub_orchestrator.cache_read).toBe(EXPECTED.cache_read);
  });

  it('writes null role entry + token_usage_note when totals are null (missing transcript)', () => {
    tmp = mkdtempSync(join(tmpdir(), 'kh-token-rollup-'));
    const report = join(tmp, 'final_report.yaml');
    writeFileSync(report, 'status: ok\n');

    const rollup = rollupSessionTokens({
      sessionId: 'missing',
      projectsDir: join(tmp, 'empty'),
    });
    const wrote = patchReportWithRollup(report, rollup);
    expect(wrote).toBe(true);

    const doc = parseYaml(readFileSync(report, 'utf8')) as Record<
      string,
      unknown
    >;
    expect(doc.token_usage_total).toBeNull();
    const byRole = doc.token_usage_by_role as Record<string, unknown>;
    expect(byRole.sub_orchestrator).toBeNull();
    expect(doc.token_usage_note).toMatch(/transcript not found/i);
  });

  it('returns false when the report path does not exist', () => {
    const rollup = rollupSessionTokens({
      sessionId: 'x',
      projectsDir: '/no/such/dir',
    });
    expect(patchReportWithRollup('/no/such/report.yaml', rollup)).toBe(false);
  });
});
