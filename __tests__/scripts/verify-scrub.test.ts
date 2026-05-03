import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { spawnSyncMock } = vi.hoisted(() => ({
  spawnSyncMock: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  default: { spawnSync: spawnSyncMock },
  spawnSync: spawnSyncMock,
}));

import {
  buildProbeSet,
  evaluateProbe,
  loadConfig,
  parseCli,
  psqlCount,
  reportProbe,
  runProbe,
  runProbeSet,
  EXIT_OK,
  EXIT_PROBE_FAILED,
  EXIT_ENV_ERROR,
  type ProbeDef,
  type ProbeResult,
} from '@/scripts/verify-scrub';

beforeEach(() => {
  spawnSyncMock.mockReset();
});

afterEach(() => {
  delete process.env.STAGING_SUPABASE_DB_URL;
  delete process.env.PROD_SUPABASE_DB_URL;
});

// ── parseCli ──────────────────────────────────────────────────────────────

describe('parseCli', () => {
  it('defaults --env to staging and --baseline-cycle to 1', () => {
    const flags = parseCli([]);
    expect(flags.env).toBe('staging');
    expect(flags.baselineCycle).toBe(1);
    expect(flags.probe).toBeUndefined();
  });

  it('accepts --probe=<name>', () => {
    const flags = parseCli(['--probe=auth-users-pii']);
    expect(flags.probe).toBe('auth-users-pii');
  });

  it('accepts --baseline-cycle=2', () => {
    const flags = parseCli(['--baseline-cycle=2']);
    expect(flags.baselineCycle).toBe(2);
  });

  it('rejects --env values other than staging|prod', () => {
    expect(() => parseCli(['--env=production'])).toThrow(/Invalid --env/);
  });
});

// ── loadConfig ─────────────────────────────────────────────────────────────

describe('loadConfig', () => {
  it('throws when STAGING_SUPABASE_DB_URL is missing', () => {
    expect(() =>
      loadConfig({ probe: undefined, env: 'staging', baselineCycle: 1 }),
    ).toThrow(/STAGING_SUPABASE_DB_URL/);
  });

  it('throws when PROD_SUPABASE_DB_URL is missing in cycle 1', () => {
    process.env.STAGING_SUPABASE_DB_URL = 'postgresql://staging';
    expect(() =>
      loadConfig({ probe: undefined, env: 'staging', baselineCycle: 1 }),
    ).toThrow(/PROD_SUPABASE_DB_URL/);
  });

  it('does NOT require PROD_SUPABASE_DB_URL in cycle 2', () => {
    process.env.STAGING_SUPABASE_DB_URL = 'postgresql://staging';
    const config = loadConfig({
      probe: undefined,
      env: 'staging',
      baselineCycle: 2,
    });
    expect(config.stagingDbUrl).toBe('postgresql://staging');
    expect(config.prodDbUrl).toBeUndefined();
  });

  it('loads both URLs in cycle 1 when present', () => {
    process.env.STAGING_SUPABASE_DB_URL = 'postgresql://staging';
    process.env.PROD_SUPABASE_DB_URL = 'postgresql://prod';
    const config = loadConfig({
      probe: 'auth-users-pii',
      env: 'staging',
      baselineCycle: 1,
    });
    expect(config.stagingDbUrl).toBe('postgresql://staging');
    expect(config.prodDbUrl).toBe('postgresql://prod');
    expect(config.probeFilter).toBe('auth-users-pii');
  });
});

// ── psqlCount ──────────────────────────────────────────────────────────────

describe('psqlCount', () => {
  it('parses single-value count from psql -t -A output', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: '42\n',
      stderr: '',
    });
    const count = psqlCount('postgresql://staging', 'SELECT count(*) FROM x');
    expect(count).toBe(42);
    expect(spawnSyncMock).toHaveBeenCalledWith(
      'psql',
      expect.arrayContaining([
        'postgresql://staging',
        '-t',
        '-A',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        'SELECT count(*) FROM x',
      ]),
      expect.objectContaining({ encoding: 'utf-8' }),
    );
  });

  it('throws on non-zero psql exit', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: 'connection refused\n',
    });
    expect(() => psqlCount('postgresql://x', 'SELECT 1')).toThrow(
      /psql exit=1/,
    );
  });

  it('throws on non-numeric psql output', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: 'not-a-number\n',
      stderr: '',
    });
    expect(() => psqlCount('postgresql://x', 'SELECT 1')).toThrow(
      /non-numeric/,
    );
  });
});

// ── evaluateProbe ──────────────────────────────────────────────────────────

describe('evaluateProbe', () => {
  it('eq-zero: passes only when actual is exactly 0', () => {
    expect(evaluateProbe(0, { kind: 'eq-zero' })).toBe(true);
    expect(evaluateProbe(1, { kind: 'eq-zero' })).toBe(false);
  });

  it('eq-baseline: passes only on exact match', () => {
    expect(evaluateProbe(9, { kind: 'eq-baseline', baseline: 9 })).toBe(true);
    expect(evaluateProbe(10, { kind: 'eq-baseline', baseline: 9 })).toBe(false);
  });

  it('within-tolerance: ±5% of baseline 100 admits 95..105', () => {
    const exp = {
      kind: 'within-tolerance' as const,
      baseline: 100,
      tolerance: 0.05,
    };
    expect(evaluateProbe(95, exp)).toBe(true);
    expect(evaluateProbe(105, exp)).toBe(true);
    expect(evaluateProbe(94, exp)).toBe(false);
    expect(evaluateProbe(106, exp)).toBe(false);
  });

  it('within-tolerance baseline=0 short-circuits to exact zero', () => {
    const exp = {
      kind: 'within-tolerance' as const,
      baseline: 0,
      tolerance: 0.05,
    };
    expect(evaluateProbe(0, exp)).toBe(true);
    expect(evaluateProbe(1, exp)).toBe(false);
  });
});

// ── buildProbeSet ──────────────────────────────────────────────────────────

describe('buildProbeSet', () => {
  it('returns the §3.6 v2 minimal subset of 12 probes', () => {
    const probes = buildProbeSet(9);
    expect(probes).toHaveLength(12);
  });

  it('includes the four canonical probe names from spec', () => {
    const probes = buildProbeSet(9);
    const names = probes.map((p) => p.name);
    expect(names).toContain('auth-users-pii');
    expect(names).toContain('auth-users-last-sign-in');
    expect(names).toContain('auth-users-count-parity');
    expect(names).toContain('fk-orphan-content-items');
  });

  it('parity probe carries the supplied prod baseline', () => {
    const probes = buildProbeSet(42);
    const parity = probes.find((p) => p.name === 'auth-users-count-parity');
    expect(parity?.expectation).toEqual({
      kind: 'within-tolerance',
      baseline: 42,
      tolerance: 0.05,
    });
  });
});

// ── runProbe + runProbeSet ────────────────────────────────────────────────

describe('runProbe', () => {
  it('returns pass=true when count meets expectation', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 0,
      stdout: '0\n',
      stderr: '',
    });
    const probe: ProbeDef = {
      name: 'p1',
      label: 'L1',
      sql: 'SELECT 0',
      expectation: { kind: 'eq-zero' },
    };
    const result = runProbe('postgresql://x', probe);
    expect(result.pass).toBe(true);
    expect(result.actual).toBe(0);
  });

  it('returns pass=false with error message on psql failure', () => {
    spawnSyncMock.mockReturnValueOnce({
      status: 2,
      stdout: '',
      stderr: 'fatal: role missing\n',
    });
    const probe: ProbeDef = {
      name: 'p1',
      label: 'L1',
      sql: 'SELECT 0',
      expectation: { kind: 'eq-zero' },
    };
    const result = runProbe('postgresql://x', probe);
    expect(result.pass).toBe(false);
    expect(result.error).toMatch(/psql exit=2/);
  });
});

describe('runProbeSet', () => {
  it('aggregates pass/fail across multiple probes', () => {
    spawnSyncMock
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '5\n', stderr: '' })
      .mockReturnValueOnce({ status: 0, stdout: '0\n', stderr: '' });
    const probes: ProbeDef[] = [
      {
        name: 'a',
        label: 'A',
        sql: 'SELECT 1',
        expectation: { kind: 'eq-zero' },
      },
      {
        name: 'b',
        label: 'B',
        sql: 'SELECT 1',
        expectation: { kind: 'eq-zero' },
      },
      {
        name: 'c',
        label: 'C',
        sql: 'SELECT 1',
        expectation: { kind: 'eq-zero' },
      },
    ];
    const results = runProbeSet('postgresql://x', probes);
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.pass)).toEqual([true, false, true]);
  });
});

// ── reportProbe (GHA annotation format per §2.9.1) ────────────────────────

describe('reportProbe', () => {
  it('emits GHA `::error file=...,line=...::` annotation on probe failure', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result: ProbeResult = {
      name: 'auth-users-pii',
      label: 'auth.users email PII residue',
      pass: false,
      actual: 7,
      expectation: { kind: 'eq-zero' },
    };
    const annotation = reportProbe(result);
    expect(annotation).toMatch(
      /^::error file=scripts\/scrub-staging-pii\.sql,line=1::/,
    );
    expect(annotation).toContain('auth-users-pii');
    expect(annotation).toContain('count=7');
    expect(annotation).toContain('staging is in mid-state');
    expect(errSpy).toHaveBeenCalledWith(annotation);
    errSpy.mockRestore();
  });

  it('emits [OK] log line on probe pass', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result: ProbeResult = {
      name: 'auth-users-pii',
      label: 'auth.users email PII residue',
      pass: true,
      actual: 0,
      expectation: { kind: 'eq-zero' },
    };
    const out = reportProbe(result);
    expect(out).toMatch(/^\[OK\]/);
    expect(logSpy).toHaveBeenCalledWith(out);
    logSpy.mockRestore();
  });

  it('annotates the within-tolerance baseline detail', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result: ProbeResult = {
      name: 'auth-users-count-parity',
      label: 'parity probe',
      pass: false,
      actual: 200,
      expectation: { kind: 'within-tolerance', baseline: 100, tolerance: 0.05 },
    };
    const annotation = reportProbe(result);
    expect(annotation).toContain('within ±5.0% of baseline 100');
  });
});

// ── Exit-code semantics (sanity guard on EXIT_* exports) ──────────────────

describe('exit-code constants match spec §2.9', () => {
  it('exposes EXIT_OK=0, EXIT_PROBE_FAILED=1, EXIT_ENV_ERROR=3', () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_PROBE_FAILED).toBe(1);
    expect(EXIT_ENV_ERROR).toBe(3);
  });
});
