import { describe, it, expect } from 'vitest';
import {
  parseCliArgs,
  buildSubjectSummaryCsv,
  buildActivitySummaryCsv,
  buildReadme,
  buildManifestEntry,
  assembleActivityBundle,
  assembleAuditTrailBundle,
  assembleAttributedContentBundle,
  type AuthUserExport,
  type SubjectBundle,
  type ActivityBundle,
  type BundleManifest,
} from '../../scripts/export-user-data';
import { createMockSupabaseTableDispatch } from '../helpers/mock-supabase';

// Test UUID — v4-compliant per CLAUDE.md "Zod UUID validation is strict".
const VALID_UUID_A = 'a3b1c2d4-1111-4222-8333-444444444444';
const VALID_UUID_B = 'b3b1c2d4-2222-4333-8444-555555555555';

// ---------------------------------------------------------------------------
// parseCliArgs
// ---------------------------------------------------------------------------

describe('parseCliArgs', () => {
  it('errors when --env is missing', () => {
    const args = parseCliArgs(['--user-id', VALID_UUID_A]);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('--env');
  });

  it('errors when --env value is invalid', () => {
    const args = parseCliArgs(['--env=dev', '--user-id', VALID_UUID_A]);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain("'prod' or 'staging'");
  });

  it('accepts --env=prod and --env=staging', () => {
    expect(parseCliArgs(['--env=prod', '--user-id', VALID_UUID_A]).env).toBe(
      'prod',
    );
    expect(parseCliArgs(['--env=staging', '--user-id', VALID_UUID_A]).env).toBe(
      'staging',
    );
  });

  it('accepts space form: --env prod', () => {
    const args = parseCliArgs(['--env', 'prod', '--user-id', VALID_UUID_A]);
    expect(args.error).toBeNull();
    expect(args.env).toBe('prod');
  });

  it('errors when neither --user-id nor --email is provided', () => {
    const args = parseCliArgs(['--env=staging']);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('--user-id');
    expect(args.error).toContain('--email');
  });

  it('errors when both --user-id and --email are provided (mutually exclusive)', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      VALID_UUID_A,
      '--email',
      'test@example.com',
    ]);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('mutually exclusive');
  });

  it('rejects malformed --user-id (not a v4 UUID)', () => {
    const args = parseCliArgs(['--env=staging', '--user-id', 'not-a-uuid']);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('valid v4 UUID');
  });

  it('rejects v4-shaped but invalid UUID like 00000000-...0001', () => {
    // Per CLAUDE.md gotcha: zod UUID enforces RFC 4122 strictly.
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      '00000000-0000-0000-0000-000000000001',
    ]);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain('valid v4 UUID');
  });

  it('accepts --email as the subject identifier', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--email',
      'subject@example.com',
    ]);
    expect(args.error).toBeNull();
    expect(args.email).toBe('subject@example.com');
    expect(args.userId).toBeNull();
  });

  it('defaults --output, --article, --format', () => {
    const args = parseCliArgs(['--env=staging', '--user-id', VALID_UUID_A]);
    expect(args.output).toBe('./exports/');
    expect(args.article).toBe('15');
    expect(args.format).toBe('both');
  });

  it('parses --article=20', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      VALID_UUID_A,
      '--article=20',
    ]);
    expect(args.error).toBeNull();
    expect(args.article).toBe('20');
  });

  it('rejects invalid --article values', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      VALID_UUID_A,
      '--article=99',
    ]);
    expect(args.error).not.toBeNull();
    expect(args.error).toContain("'15' or '20'");
  });

  it('parses --format=json', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      VALID_UUID_A,
      '--format=json',
    ]);
    expect(args.error).toBeNull();
    expect(args.format).toBe('json');
  });

  it('parses --output to a custom directory', () => {
    const args = parseCliArgs([
      '--env=staging',
      '--user-id',
      VALID_UUID_A,
      '--output',
      '/tmp/dsar-test',
    ]);
    expect(args.error).toBeNull();
    expect(args.output).toBe('/tmp/dsar-test');
  });

  it('honours --help short form', () => {
    const args = parseCliArgs(['-h']);
    expect(args.help).toBe(true);
    expect(args.error).toBeNull();
  });

  it('honours --help long form', () => {
    const args = parseCliArgs(['--help']);
    expect(args.help).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// CSV builders
// ---------------------------------------------------------------------------

const FIXTURE_AUTH_USER: AuthUserExport = {
  id: VALID_UUID_A,
  email: 'subject@example.com',
  phone: null,
  email_confirmed_at: '2026-01-15T10:00:00.000Z',
  phone_confirmed_at: null,
  last_sign_in_at: '2026-04-28T09:30:00.000Z',
  created_at: '2026-01-15T10:00:00.000Z',
  updated_at: '2026-04-28T09:30:00.000Z',
  raw_user_meta_data: { full_name: 'Jane Doe' },
  raw_app_meta_data: null,
  identities_summary: [
    { provider: 'email', created_at: '2026-01-15T10:00:00.000Z' },
  ],
};

const FIXTURE_SUBJECT_BUNDLE: SubjectBundle = {
  auth_user: FIXTURE_AUTH_USER,
  user_profile: {
    id: VALID_UUID_A,
    email: 'subject@example.com',
    full_name: 'Jane Doe',
  },
  user_role: { user_id: VALID_UUID_A, role: 'editor', display_name: 'Jane D.' },
  user_notification_prefs: {
    user_id: VALID_UUID_A,
    email_review_assigned: true,
    auto_generate_change_reports: false,
  },
};

describe('buildSubjectSummaryCsv', () => {
  it('produces a UTF-8 BOM CSV with subject identifier columns', () => {
    const csv = buildSubjectSummaryCsv(FIXTURE_SUBJECT_BUNDLE);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('field,value');
    expect(csv).toContain(`auth_user.id,${VALID_UUID_A}`);
    expect(csv).toContain('auth_user.email,subject@example.com');
    expect(csv).toContain('user_profile.full_name,Jane Doe');
    expect(csv).toContain('user_role.role,editor');
  });

  it('handles missing user_profile / user_role / prefs (all-null bundle)', () => {
    const minimal: SubjectBundle = {
      auth_user: FIXTURE_AUTH_USER,
      user_profile: null,
      user_role: null,
      user_notification_prefs: null,
    };
    const csv = buildSubjectSummaryCsv(minimal);
    expect(csv).toContain('user_profile.full_name,');
    expect(csv).toContain('user_role.role,');
  });

  it('escapes commas and quotes in field values per RFC 4180', () => {
    const tricky: SubjectBundle = {
      ...FIXTURE_SUBJECT_BUNDLE,
      user_role: {
        ...FIXTURE_SUBJECT_BUNDLE.user_role!,
        display_name: 'Jane "JD" Doe, Esq.',
      },
    };
    const csv = buildSubjectSummaryCsv(tricky);
    expect(csv).toContain('user_role.display_name,"Jane ""JD"" Doe, Esq."');
  });
});

describe('buildActivitySummaryCsv', () => {
  it('builds CSV with notifications', () => {
    // read_marks REMOVED (id-138.19): table dropped at ID-131 M6 GO (S450) —
    // see the export-user-data.ts ActivityBundle comment for provenance.
    const activity: ActivityBundle = {
      notifications: [
        {
          id: 'n-1',
          type: 'review_assigned',
          title: 'New review',
          read_at: '2026-04-21T11:00:00.000Z',
          created_at: '2026-04-20T11:00:00.000Z',
        },
      ],
    };
    const csv = buildActivitySummaryCsv(activity);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('event_type,event_id,event_at,detail');
    expect(csv).toContain('notification,n-1,');
    expect(csv).toContain('type=review_assigned');
  });

  it('builds an empty CSV (header-only) when activity is empty', () => {
    const empty: ActivityBundle = { notifications: [] };
    const csv = buildActivitySummaryCsv(empty);
    expect(csv).toContain('event_type,event_id,event_at,detail');
    // Only header row plus trailing newline.
    expect(csv.split('\n').filter((l) => l.length > 0).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// buildReadme
// ---------------------------------------------------------------------------

describe('buildReadme', () => {
  it('produces a markdown README with subject metadata', () => {
    const invocation: BundleManifest['invocation'] = {
      env: 'staging',
      article: '15',
      format: 'both',
      subject_lookup: 'email',
    };
    const md = buildReadme(
      VALID_UUID_A,
      FIXTURE_AUTH_USER,
      invocation,
      '2026-04-28T12:00:00.000Z',
    );
    expect(md).toMatch(/^# Your Personal Data/);
    expect(md).toContain(`Subject UUID:** \`${VALID_UUID_A}\``);
    expect(md).toContain('Subject email:** `subject@example.com`');
    expect(md).toContain('Article 15');
    // UK date format DD/MM/YYYY in narrative
    expect(md).toContain('28/04/2026');
    // Excluded password disclosure
    expect(md).toContain('password');
    expect(md).toContain('UK GDPR');
  });

  it('shows Article 20 label when invocation is article=20', () => {
    const invocation: BundleManifest['invocation'] = {
      env: 'prod',
      article: '20',
      format: 'json',
      subject_lookup: 'user-id',
    };
    const md = buildReadme(
      VALID_UUID_A,
      FIXTURE_AUTH_USER,
      invocation,
      '2026-04-28T12:00:00.000Z',
    );
    expect(md).toContain('Article 20');
    expect(md).toContain('portability');
  });
});

// ---------------------------------------------------------------------------
// buildManifestEntry
// ---------------------------------------------------------------------------

describe('buildManifestEntry', () => {
  it('produces a SHA-256 checksum (64 hex chars)', () => {
    const entry = buildManifestEntry('subject.json', '{"hello":"world"}');
    expect(entry.filename).toBe('subject.json');
    expect(entry.size_bytes).toBe(17);
    expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces stable hashes for identical content (idempotent)', () => {
    const a = buildManifestEntry('a.json', 'identical');
    const b = buildManifestEntry('b.json', 'identical');
    expect(a.sha256).toBe(b.sha256);
    expect(a.size_bytes).toBe(b.size_bytes);
  });

  it('produces different hashes for different content', () => {
    const a = buildManifestEntry('a.json', 'one');
    const b = buildManifestEntry('a.json', 'two');
    expect(a.sha256).not.toBe(b.sha256);
  });

  it('counts bytes as UTF-8 (multi-byte chars)', () => {
    // £ is 2 bytes in UTF-8
    const entry = buildManifestEntry('a.json', '£');
    expect(entry.size_bytes).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// User-linked-table bundle reconciliation (id-138.19)
//
// Pins the exact table set each assemble*Bundle fetches against a live
// enumeration of user-linked tables/columns re-audited from staging
// information_schema post ID-131 M6 GO (S450). If a future migration drops
// or renames one of these tables without updating the export tool, the
// live query throws (fetchByColumn/fetchByAnyColumn re-throw the Postgrest
// error) and this suite's expected-table-set assertions fall out of sync
// with export-user-data.ts — both fail loudly instead of silently omitting
// a data subject's personal data from a GDPR Article 15 export.
// ---------------------------------------------------------------------------

describe('user-linked-table bundle reconciliation (id-138.19)', () => {
  const EXPECTED_ACTIVITY_TABLES = ['notifications'];

  const EXPECTED_AUDIT_TRAIL_TABLES = [
    'form_response_history',
    'form_responses',
    'form_questions',
    'form_templates',
    'verification_history',
    'classification_disputes',
    'feed_flags',
    'tag_morphology_drift_flags',
    'review_assignments',
    'source_documents',
    'taxonomy_domains',
    'taxonomy_subtopics',
    'taxonomy_sync_state',
    'change_reports',
    'processing_queue',
    'pipeline_runs',
    'ingestion_quality_log',
    'governance_config',
    'q_a_pair_history',
    'q_a_pair_dedup_proposals',
    'eval_baselines',
    'eval_baseline_audit',
  ];

  const EXPECTED_ATTRIBUTED_CONTENT_TABLES = [
    'record_lifecycle',
    'citations',
    'feed_prompts',
    'feed_sources',
    'coverage_targets',
    'guides',
    'template_completions',
    'workspaces',
    'company_profiles',
  ];

  it('assembleActivityBundle queries exactly the expected table set post-M6', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleActivityBundle(mock as never, VALID_UUID_A);
    const queried = [...new Set(mock.from.mock.calls.map((c) => c[0]))];
    expect(queried.sort()).toEqual([...EXPECTED_ACTIVITY_TABLES].sort());
  });

  it('assembleAuditTrailBundle queries exactly the expected table set post-M6', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleAuditTrailBundle(mock as never, VALID_UUID_A);
    const queried = [...new Set(mock.from.mock.calls.map((c) => c[0]))];
    expect(queried.sort()).toEqual([...EXPECTED_AUDIT_TRAIL_TABLES].sort());
  });

  it('assembleAttributedContentBundle queries exactly the expected table set post-M6', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleAttributedContentBundle(mock as never, VALID_UUID_A);
    const queried = [...new Set(mock.from.mock.calls.map((c) => c[0]))];
    expect(queried.sort()).toEqual(
      [...EXPECTED_ATTRIBUTED_CONTENT_TABLES].sort(),
    );
  });

  it('form_templates fetch checks created_by and outcome_recorded_by (gap-fill: never bundled pre-id-138.19)', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleAuditTrailBundle(mock as never, VALID_UUID_A);
    const columns = mock._chains['form_templates'].eq.mock.calls.map(
      (c) => c[0],
    );
    expect(columns).toEqual(['created_by', 'outcome_recorded_by']);
  });

  it('record_lifecycle fetch checks governance_reviewer_id, verified_by, content_owner_id (content_items successor)', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleAttributedContentBundle(mock as never, VALID_UUID_A);
    const columns = mock._chains['record_lifecycle'].eq.mock.calls.map(
      (c) => c[0],
    );
    expect(columns).toEqual([
      'governance_reviewer_id',
      'verified_by',
      'content_owner_id',
    ]);
  });

  it('source_documents fetch includes updated_by alongside archived_by and uploaded_by (gap-fill)', async () => {
    const mock = createMockSupabaseTableDispatch();
    await assembleAuditTrailBundle(mock as never, VALID_UUID_A);
    const columns = mock._chains['source_documents'].eq.mock.calls.map(
      (c) => c[0],
    );
    expect(columns).toEqual(['archived_by', 'uploaded_by', 'updated_by']);
  });
});

// ---------------------------------------------------------------------------
// VALID_UUID_B referenced just to keep the import warning-free should
// future tests use a second UUID for relationship rows.
// ---------------------------------------------------------------------------

describe('test fixtures', () => {
  it('provides two distinct valid v4 UUIDs', () => {
    expect(VALID_UUID_A).not.toBe(VALID_UUID_B);
    expect(VALID_UUID_A).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(VALID_UUID_B).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
