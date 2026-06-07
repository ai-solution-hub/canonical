/**
 * Unit tests for scripts/quality-gate.ts — pure-logic functions only.
 * DB-facing checks are smoke-tested live against the current NEW project
 * as the WP-A acceptance step; they aren't unit-testable without a heavy
 * mock harness and the spec explicitly calls out integration smoke tests
 * against the real corpus.
 */

import { describe, it, expect } from 'vitest';

import {
  parseCli,
  resolveProfile,
  severityFor,
  selectChecks,
  overallVerdict,
  matchFileGroup,
  defaultOutputPath,
  extractProjectId,
  renderMarkdown,
  renderJson,
  loadJson,
  excludeArtefacts,
  type CheckResult,
  type CheckFn,
  type ProfilesConfig,
  type AuditContentFileGroup,
  type GateEnvelope,
} from '../../scripts/quality-gate';

// ---------------------------------------------------------------------------
// parseCli
// ---------------------------------------------------------------------------

describe('parseCli', () => {
  it('defaults threshold + format + fail-on when flags omitted', () => {
    const a = parseCli([]);
    expect(a.threshold).toBeNull();
    expect(a.profile).toBeNull();
    expect(a.format).toBe('markdown');
    expect(a.failOn).toBe('must-pass');
    expect(a.includeChecks).toEqual([]);
    expect(a.excludeChecks).toEqual([]);
    expect(a.help).toBe(false);
  });

  it('parses --threshold and --format', () => {
    const a = parseCli(['--threshold=batch', '--format=json']);
    expect(a.threshold).toBe('batch');
    expect(a.format).toBe('json');
  });

  it('parses --profile', () => {
    const a = parseCli(['--profile=audit-content']);
    expect(a.profile).toBe('audit-content');
  });

  it('collects multiple --include-check flags', () => {
    const a = parseCli([
      '--include-check=corpus_counts',
      '--include-check=embedding_coverage',
    ]);
    expect(a.includeChecks).toEqual(['corpus_counts', 'embedding_coverage']);
  });

  it('collects multiple --exclude-check flags', () => {
    const a = parseCli([
      '--exclude-check=suspected_duplicate_backlog',
      '--exclude-check=history_v1_present',
    ]);
    expect(a.excludeChecks).toEqual([
      'suspected_duplicate_backlog',
      'history_v1_present',
    ]);
  });

  it('accepts --output=-', () => {
    const a = parseCli(['--output=-']);
    expect(a.output).toBe('-');
  });

  it('rejects invalid --format', () => {
    expect(() => parseCli(['--format=xml'])).toThrow(/Invalid --format/);
  });

  it('rejects invalid --fail-on', () => {
    expect(() => parseCli(['--fail-on=maybe'])).toThrow(/Invalid --fail-on/);
  });

  it('accepts all three --fail-on values', () => {
    expect(parseCli(['--fail-on=must-pass']).failOn).toBe('must-pass');
    expect(parseCli(['--fail-on=any']).failOn).toBe('any');
    expect(parseCli(['--fail-on=never']).failOn).toBe('never');
  });

  it('parses --help', () => {
    const a = parseCli(['--help']);
    expect(a.help).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resolveProfile
// ---------------------------------------------------------------------------

const TEST_PROFILES: ProfilesConfig = {
  profiles: {
    're-ingest': {
      description: 're-ingest',
      check_severities: {
        corpus_counts: 'must-pass',
        history_v1_present: 'should-pass',
      },
    },
    batch: {
      description: 'batch',
      check_severities: { corpus_counts: 'should-pass' },
    },
    'audit-content': {
      description: 'audit',
      invokes_profile: 're-ingest',
      audit_content_checks: { audit_per_file_qa_count: 'must-pass' },
    },
  },
};

describe('resolveProfile', () => {
  it('returns the named profile def', () => {
    const def = resolveProfile(TEST_PROFILES, 're-ingest');
    expect(def.description).toBe('re-ingest');
  });

  it('throws with available list when profile missing', () => {
    expect(() => resolveProfile(TEST_PROFILES, 'ghost')).toThrow(
      /Profile 'ghost' not found.*re-ingest, batch, audit-content/,
    );
  });
});

// ---------------------------------------------------------------------------
// severityFor
// ---------------------------------------------------------------------------

describe('severityFor', () => {
  it('returns check_severities entry when defined', () => {
    const def = TEST_PROFILES.profiles['re-ingest'];
    expect(severityFor(def, 'corpus_counts')).toBe('must-pass');
    expect(severityFor(def, 'history_v1_present')).toBe('should-pass');
  });

  it('returns audit_content_checks entry when defined', () => {
    const def = TEST_PROFILES.profiles['audit-content'];
    expect(severityFor(def, 'audit_per_file_qa_count')).toBe('must-pass');
  });

  it('falls back to should-pass when check not in profile', () => {
    const def = TEST_PROFILES.profiles['re-ingest'];
    expect(severityFor(def, 'unknown_check')).toBe('should-pass');
  });

  it('respects explicit fallback override', () => {
    const def = TEST_PROFILES.profiles['re-ingest'];
    expect(severityFor(def, 'unknown_check', 'must-pass')).toBe('must-pass');
  });
});

// ---------------------------------------------------------------------------
// selectChecks
// ---------------------------------------------------------------------------

const DUMMY_FN: CheckFn = async () =>
  ({
    name: 'x',
    severity: 'must-pass',
    status: 'pass',
    threshold: '',
    observed: '',
    diagnostic: '',
    duration_ms: 0,
  }) as CheckResult;

const ALL_CHECKS = [
  { name: 'a', fn: DUMMY_FN },
  { name: 'b', fn: DUMMY_FN },
  { name: 'c', fn: DUMMY_FN },
  { name: 'd', fn: DUMMY_FN },
];

describe('selectChecks', () => {
  it('returns all when no include/exclude', () => {
    expect(selectChecks(ALL_CHECKS, [], []).map((c) => c.name)).toEqual([
      'a',
      'b',
      'c',
      'd',
    ]);
  });

  it('filters to include set only', () => {
    expect(selectChecks(ALL_CHECKS, ['a', 'c'], []).map((c) => c.name)).toEqual(
      ['a', 'c'],
    );
  });

  it('excludes named checks', () => {
    expect(selectChecks(ALL_CHECKS, [], ['b']).map((c) => c.name)).toEqual([
      'a',
      'c',
      'd',
    ]);
  });

  it('include then exclude: exclude still applied', () => {
    expect(
      selectChecks(ALL_CHECKS, ['a', 'b', 'c'], ['b']).map((c) => c.name),
    ).toEqual(['a', 'c']);
  });

  it('empty include list treated as "all"', () => {
    expect(selectChecks(ALL_CHECKS, [], []).length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// overallVerdict
// ---------------------------------------------------------------------------

function r(
  name: string,
  severity: 'must-pass' | 'should-pass',
  status: CheckResult['status'],
): CheckResult {
  return {
    name,
    severity,
    status,
    threshold: '',
    observed: '',
    diagnostic: '',
    duration_ms: 0,
  };
}

describe('overallVerdict', () => {
  it('returns pass when all pass and fail-on=must-pass', () => {
    const v = overallVerdict(
      [r('a', 'must-pass', 'pass'), r('b', 'should-pass', 'pass')],
      'must-pass',
    );
    expect(v).toBe('pass');
  });

  it('returns fail when must-pass check fails and fail-on=must-pass', () => {
    const v = overallVerdict(
      [r('a', 'must-pass', 'fail'), r('b', 'should-pass', 'pass')],
      'must-pass',
    );
    expect(v).toBe('fail');
  });

  it('returns warn when only should-pass fails and fail-on=must-pass', () => {
    const v = overallVerdict(
      [r('a', 'must-pass', 'pass'), r('b', 'should-pass', 'fail')],
      'must-pass',
    );
    expect(v).toBe('warn');
  });

  it('returns fail for any failure when fail-on=any', () => {
    const v = overallVerdict(
      [r('a', 'must-pass', 'pass'), r('b', 'should-pass', 'fail')],
      'any',
    );
    expect(v).toBe('fail');
  });

  it('never returns fail when fail-on=never', () => {
    const v = overallVerdict([r('a', 'must-pass', 'fail')], 'never');
    expect(v).toBe('warn');
  });

  it('fail-on=never with no failures returns pass', () => {
    const v = overallVerdict([r('a', 'must-pass', 'pass')], 'never');
    expect(v).toBe('pass');
  });

  it('warn status counts as warn when fail-on=must-pass', () => {
    const v = overallVerdict(
      [r('a', 'must-pass', 'pass'), r('b', 'should-pass', 'warn')],
      'must-pass',
    );
    expect(v).toBe('warn');
  });
});

// ---------------------------------------------------------------------------
// matchFileGroup
// ---------------------------------------------------------------------------

const GROUPS: Record<string, AuditContentFileGroup> = {
  faqs: {
    description: 'FAQs',
    filename_matchers: { contains_all: ['FAQs'] },
    qa_count: { min: 54, max: 74 },
    chunks_per_item_estimate: [1.0, 1.0],
    chunk_count: { min: 54, max: 74 },
  },
  security_compliance: {
    description: 'S&C',
    filename_matchers: { contains_all: ['Security', 'Compliance'] },
    qa_count: { min: 105, max: 142 },
    chunks_per_item_estimate: [1.0, 1.3],
    chunk_count: { min: 105, max: 185 },
  },
  implementation_support: {
    description: 'I&S',
    filename_matchers: { contains_all: ['Implementation', 'Support'] },
    qa_count: { min: 25, max: 35 },
    chunks_per_item_estimate: [1.0, 1.0],
    chunk_count: { min: 25, max: 35 },
  },
  functionality: {
    description: 'Functionality',
    filename_matchers: { contains_all: ['Funtionality'] },
    qa_count: { min: 4, max: 8 },
    chunks_per_item_estimate: [1.0, 1.0],
    chunk_count: { min: 4, max: 8 },
  },
};

describe('matchFileGroup', () => {
  it('matches exact filenames from audit-content spec §2.1', () => {
    expect(
      matchFileGroup(
        'DRAFT 2026 Tender and Procurement Library Template for Example Client - FAQs - Copy (1).docx',
        GROUPS,
      ),
    ).toBe('faqs');
    expect(
      matchFileGroup(
        '2026 Audit - Tender and Procurement Library Template - FAQs .docx',
        GROUPS,
      ),
    ).toBe('faqs');
  });

  it('matches Security and Compliance via both needles', () => {
    expect(
      matchFileGroup(
        'DRAFT 2026 Tender and Procurement Library Template for Example Client - Security and Compliance  - Copy.docx',
        GROUPS,
      ),
    ).toBe('security_compliance');
    expect(
      matchFileGroup(
        '2026 Audit - Tender and Procurement Library Template - Security & Compliance.docx',
        GROUPS,
      ),
    ).toBe('security_compliance');
  });

  it('matches Implementation & Support', () => {
    expect(
      matchFileGroup(
        'DRAFT 2026 Example Client - Tender and Procurement Library - Implementation & Support .docx',
        GROUPS,
      ),
    ).toBe('implementation_support');
  });

  it('preserves the Funtionality source typo', () => {
    expect(
      matchFileGroup(
        '2026 Audit - Tender and Procurement Library Template - Funtionality.docx',
        GROUPS,
      ),
    ).toBe('functionality');
    // "Functionality" (correctly spelt) should NOT match (spec requires mirror)
    expect(
      matchFileGroup('2026 Audit - Functionality.docx', GROUPS),
    ).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchFileGroup('DRAFT faqs file.docx', GROUPS)).toBe('faqs');
    expect(matchFileGroup('SECURITY AND COMPLIANCE notes.docx', GROUPS)).toBe(
      'security_compliance',
    );
  });

  it('returns null for non-matching filenames', () => {
    expect(matchFileGroup('random-report.pdf', GROUPS)).toBeNull();
    expect(matchFileGroup('', GROUPS)).toBeNull();
  });

  it('requires ALL needles in contains_all to match', () => {
    expect(matchFileGroup('Security overview.docx', GROUPS)).toBeNull();
    expect(matchFileGroup('Compliance register.docx', GROUPS)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// defaultOutputPath
// ---------------------------------------------------------------------------

describe('defaultOutputPath', () => {
  it('uses quality-gate prefix for generic profiles', () => {
    const p = defaultOutputPath(
      're-ingest',
      'markdown',
      '2026-04-21T21:00:00.000Z',
    );
    expect(p).toMatch(/quality-gate-re-ingest-2026-04-21T21-00-00-000Z\.md$/);
    expect(p).toMatch(/data\/reports\//);
  });

  it('uses audit-content-gate prefix for audit-content', () => {
    const p = defaultOutputPath(
      'audit-content',
      'markdown',
      '2026-04-21T21:00:00.000Z',
    );
    expect(p).toMatch(/audit-content-gate-2026-04-21T21-00-00-000Z\.md$/);
  });

  it('swaps extension per format', () => {
    const md = defaultOutputPath(
      'batch',
      'markdown',
      '2026-04-21T21:00:00.000Z',
    );
    const js = defaultOutputPath('batch', 'json', '2026-04-21T21:00:00.000Z');
    expect(md).toMatch(/\.md$/);
    expect(js).toMatch(/\.json$/);
  });

  it('replaces colons and dots in timestamp for filesystem safety', () => {
    const p = defaultOutputPath('batch', 'json', '2026-04-21T21:00:00.000Z');
    expect(p).not.toMatch(/:/);
    expect(p.split('/').pop()).not.toContain(':');
  });
});

// ---------------------------------------------------------------------------
// extractProjectId
// ---------------------------------------------------------------------------

describe('extractProjectId', () => {
  it('extracts project id from a typical supabase URL', () => {
    expect(extractProjectId('https://mgrmucazfiibsomdmndh.supabase.co')).toBe(
      'mgrmucazfiibsomdmndh',
    );
    expect(extractProjectId('https://rovrymhhffssilaftdwd.supabase.co')).toBe(
      'rovrymhhffssilaftdwd',
    );
  });

  it('returns "unknown" for unrecognised URLs', () => {
    expect(extractProjectId('postgres://localhost:5432')).toBe('unknown');
    expect(extractProjectId('')).toBe('unknown');
  });
});

// ---------------------------------------------------------------------------
// loadJson — missing file handling
// ---------------------------------------------------------------------------

describe('loadJson', () => {
  it('throws with descriptive error when file missing', () => {
    expect(() => loadJson('nonexistent-file.json')).toThrow(
      /Failed to load config file.*nonexistent-file\.json/,
    );
  });
});

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

const SAMPLE_ENVELOPE: GateEnvelope = {
  run_id: 'abc-123',
  git_sha: 'deadbeef',
  timestamp: '2026-04-21T21:00:00.000Z',
  profile: 're-ingest',
  workspace_id: 'mgrmucazfiibsomdmndh',
  overall: 'fail',
  run_duration_ms: 2500,
  checks: [
    {
      name: 'corpus_counts',
      severity: 'must-pass',
      status: 'fail',
      threshold: 'per-type ranges',
      observed: 'q_a_pair=381∈[190,255]✗',
      diagnostic: 'content_type=q_a_pair observed=381 expected=[190,255]',
      duration_ms: 800,
    },
    {
      name: 'embedding_coverage',
      severity: 'must-pass',
      status: 'pass',
      threshold: 'missing=0',
      observed: 'missing=0',
      diagnostic: '',
      duration_ms: 200,
    },
    {
      name: 'suspected_duplicate_backlog',
      severity: 'should-pass',
      status: 'warn',
      threshold: '≤10',
      observed: 'count=12',
      diagnostic: 'Backlog above 10',
      duration_ms: 100,
    },
  ],
};

describe('renderMarkdown', () => {
  it('includes header with profile + project + verdict', () => {
    const md = renderMarkdown(SAMPLE_ENVELOPE, 're-ingest');
    expect(md).toMatch(/# Quality Gate Report/);
    expect(md).toContain('**Profile:** re-ingest');
    expect(md).toContain('**Project:** mgrmucazfiibsomdmndh');
    expect(md).toContain('**Overall:** FAIL');
    expect(md).toContain('**Run ID:** abc-123');
    expect(md).toContain('**Git SHA:** deadbeef');
  });

  it('lists failed checks with their diagnostics', () => {
    const md = renderMarkdown(SAMPLE_ENVELOPE, 're-ingest');
    expect(md).toContain('## Failed Checks');
    expect(md).toContain('`corpus_counts`');
    expect(md).toContain('content_type=q_a_pair observed=381');
  });

  it('lists warning checks separately', () => {
    const md = renderMarkdown(SAMPLE_ENVELOPE, 're-ingest');
    expect(md).toContain('## Warnings');
    expect(md).toContain('`suspected_duplicate_backlog`');
  });

  it('lists passed checks last', () => {
    const md = renderMarkdown(SAMPLE_ENVELOPE, 're-ingest');
    expect(md).toContain('## Passed Checks');
    expect(md).toContain('`embedding_coverage`');
  });

  it('renders fallback for missing git sha', () => {
    const env = { ...SAMPLE_ENVELOPE, git_sha: '' };
    const md = renderMarkdown(env, 're-ingest');
    expect(md).toContain('(not in git worktree)');
  });
});

describe('renderJson', () => {
  it('emits parseable JSON with required envelope fields', () => {
    const json = renderJson(SAMPLE_ENVELOPE);
    const parsed = JSON.parse(json);
    expect(parsed.run_id).toBe('abc-123');
    expect(parsed.profile).toBe('re-ingest');
    expect(parsed.workspace_id).toBe('mgrmucazfiibsomdmndh');
    expect(parsed.overall).toBe('fail');
    expect(parsed.checks).toHaveLength(3);
    expect(parsed.checks[0].name).toBe('corpus_counts');
  });

  it('preserves numeric fields as numbers (not strings)', () => {
    const json = renderJson(SAMPLE_ENVELOPE);
    const parsed = JSON.parse(json);
    expect(typeof parsed.run_duration_ms).toBe('number');
    expect(typeof parsed.checks[0].duration_ms).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// excludeArtefacts (OPS-21)
// ---------------------------------------------------------------------------

describe('excludeArtefacts', () => {
  it('chains two .not() calls for [E2E% and [SUPERSEDE% title prefixes', () => {
    const calls: Array<{ col: string; op: string; val: string }> = [];
    const mockQuery = {
      not(col: string, op: string, val: string) {
        calls.push({ col, op, val });
        return mockQuery;
      },
    };
    const result = excludeArtefacts(mockQuery);
    expect(result).toBe(mockQuery);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({ col: 'title', op: 'like', val: '[E2E%' });
    expect(calls[1]).toEqual({ col: 'title', op: 'like', val: '[SUPERSEDE%' });
  });

  it('is idempotent — calling twice adds 4 .not() calls total', () => {
    const calls: Array<{ col: string; op: string; val: string }> = [];
    const mockQuery = {
      not(col: string, op: string, val: string) {
        calls.push({ col, op, val });
        return mockQuery;
      },
    };
    excludeArtefacts(excludeArtefacts(mockQuery));
    expect(calls).toHaveLength(4);
  });
});
