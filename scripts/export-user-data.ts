/**
 * GDPR Data Subject Export Script (WP-G6.7)
 *
 * Produces an export bundle containing all personal data Knowledge Hub
 * holds about a single data subject, fulfilling UK GDPR Article 15
 * (right of access) and Article 20 (right to data portability) requests.
 *
 * Per WP-G6.7 spec at:
 *   docs/audits/kh-production-readiness-phase-1/specs/wp-g6.7-gdpr-data-export-spec.md
 *
 * Operator runbook at:
 *   docs/handover/gdpr-data-export.md
 *
 * Usage:
 *   bun run scripts/export-user-data.ts --env=prod --user-id <uuid> --output ./exports/
 *   bun run scripts/export-user-data.ts --env=prod --email <addr>
 *   bun run scripts/export-user-data.ts --env=staging --user-id <uuid> --article=20
 *
 * Required env vars:
 *   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY  (RLS-bypassing read of auth.users + public.*)
 *
 * Exit codes:
 *   0  success — bundle written
 *   1  subject not found (no auth.users row)
 *   2  export error (DB unreachable, write permission, etc.)
 *
 * Sandbox note: this script reads (no writes) but uses supabase-js
 * methods that may pass through bun fetch. If invoked from the Claude
 * Code sandbox and stalls, re-invoke with `dangerouslyDisableSandbox: true`
 * per CLAUDE.md "Bun fetch hangs on HTTP 204" gotcha.
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef, stagingProjectRef } from '@/scripts/lib/project-refs';
import { createHash } from 'crypto';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hard cap on auth.admin.listUsers pagination during email lookup. */
const EMAIL_LOOKUP_MAX_PAGES = 50;
/** Per-page size for auth.admin.listUsers. */
const EMAIL_LOOKUP_PAGE_SIZE = 1000;

/** Exit codes per spec §10 AC3. */
const EXIT_OK = 0;
const EXIT_SUBJECT_NOT_FOUND = 1;
const EXIT_EXPORT_ERROR = 2;

/** UTF-8 BOM for CSV (Excel decodes correctly). */
const UTF8_BOM = '﻿';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

export interface CliArgs {
  /** prod | staging — required, no default. */
  env: 'prod' | 'staging' | '';
  /** UUID of the subject. Mutually exclusive with email. */
  userId: string | null;
  /** Email of the subject. Mutually exclusive with userId. */
  email: string | null;
  /** Output base directory; final dir is `<output>/<uuid>-<timestamp>/`. */
  output: string;
  /** json | both (CSV summaries alongside JSON). */
  format: 'json' | 'both';
  /** 15 (full) | 20 (portability subset). */
  article: '15' | '20';
  /** Help requested. */
  help: boolean;
  /** Parse error, if any. */
  error: string | null;
}

export function parseCliArgs(argv: string[]): CliArgs {
  let env: CliArgs['env'] = '';
  let userId: string | null = null;
  let email: string | null = null;
  let output = './exports/';
  let format: CliArgs['format'] = 'both';
  let article: CliArgs['article'] = '15';
  let help = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--env' && argv[i + 1]) {
      const v = argv[i + 1];
      if (v === 'prod' || v === 'staging') {
        env = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--env must be 'prod' or 'staging', got '${v}'`,
        };
      }
      i++;
    } else if (arg.startsWith('--env=')) {
      const v = arg.slice('--env='.length);
      if (v === 'prod' || v === 'staging') {
        env = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--env must be 'prod' or 'staging', got '${v}'`,
        };
      }
    } else if (arg === '--user-id' && argv[i + 1]) {
      userId = argv[i + 1];
      i++;
    } else if (arg.startsWith('--user-id=')) {
      userId = arg.slice('--user-id='.length);
    } else if (arg === '--email' && argv[i + 1]) {
      email = argv[i + 1];
      i++;
    } else if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
    } else if (arg === '--output' && argv[i + 1]) {
      output = argv[i + 1];
      i++;
    } else if (arg.startsWith('--output=')) {
      output = arg.slice('--output='.length);
    } else if (arg === '--format' && argv[i + 1]) {
      const v = argv[i + 1];
      if (v === 'json' || v === 'both') {
        format = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--format must be 'json' or 'both', got '${v}'`,
        };
      }
      i++;
    } else if (arg.startsWith('--format=')) {
      const v = arg.slice('--format='.length);
      if (v === 'json' || v === 'both') {
        format = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--format must be 'json' or 'both', got '${v}'`,
        };
      }
    } else if (arg === '--article' && argv[i + 1]) {
      const v = argv[i + 1];
      if (v === '15' || v === '20') {
        article = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--article must be '15' or '20', got '${v}'`,
        };
      }
      i++;
    } else if (arg.startsWith('--article=')) {
      const v = arg.slice('--article='.length);
      if (v === '15' || v === '20') {
        article = v;
      } else {
        return {
          ...emptyArgs(),
          error: `--article must be '15' or '20', got '${v}'`,
        };
      }
    }
  }

  if (help) {
    return { env, userId, email, output, format, article, help, error: null };
  }

  if (!env) {
    return {
      ...emptyArgs(),
      error:
        '--env=prod or --env=staging is REQUIRED (no default — fail-fast per WP-S5.3 D-21).',
    };
  }

  if (!userId && !email) {
    return {
      ...emptyArgs(),
      error: 'Either --user-id <uuid> OR --email <addr> is REQUIRED.',
    };
  }

  if (userId && email) {
    return {
      ...emptyArgs(),
      error: '--user-id and --email are mutually exclusive — pass exactly one.',
    };
  }

  if (userId) {
    const uuidResult = z.string().uuid().safeParse(userId);
    if (!uuidResult.success) {
      return {
        ...emptyArgs(),
        error: `--user-id must be a valid v4 UUID, got '${userId}'`,
      };
    }
  }

  return { env, userId, email, output, format, article, help, error: null };
}

function emptyArgs(): CliArgs {
  return {
    env: '',
    userId: null,
    email: null,
    output: './exports/',
    format: 'both',
    article: '15',
    help: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Env loading
// ---------------------------------------------------------------------------

export function loadEnvFile(filePath: string): void {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File missing — fine.
  }
}

// ---------------------------------------------------------------------------
// Env-flag assertion
// ---------------------------------------------------------------------------

export function assertEnvFlag(
  env: CliArgs['env'],
  url: string | undefined,
): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> ` +
        `bun run scripts/export-user-data.ts --env=prod ...`,
    );
    process.exit(EXIT_EXPORT_ERROR);
  }
  if (env === 'staging' && !(url ?? '').includes(stagingProjectRef())) {
    console.error(
      `--env=staging set but SUPABASE_URL does not include '${stagingProjectRef()}'.\n` +
        `.env.local should point at staging by default post-WP-S5.2. ` +
        `Run: cat .env.local | grep SUPABASE_URL to verify.`,
    );
    process.exit(EXIT_EXPORT_ERROR);
  }
}

// ---------------------------------------------------------------------------
// Subject resolution
// ---------------------------------------------------------------------------

/**
 * Auth user payload — narrow shape we use post-redaction. Excludes
 * encrypted_password and other security fields per spec §3.1.
 */
export interface AuthUserExport {
  id: string;
  email: string | null;
  phone: string | null;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  last_sign_in_at: string | null;
  created_at: string;
  updated_at: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  raw_app_meta_data: Record<string, unknown> | null;
  identities_summary: { provider: string; created_at: string | null }[];
}

/**
 * Resolve a subject UUID from `--user-id` or `--email`. For email,
 * paginates auth.admin.listUsers up to EMAIL_LOOKUP_MAX_PAGES.
 *
 * Returns null on no match (caller exits 1) or throws on multiple
 * matches (data corruption — caller exits 2).
 */
export async function resolveSubjectUuid(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  userId: string | null,
  email: string | null,
): Promise<string | null> {
  if (userId) {
    // Confirm the UUID exists via getUserById.
    const { data, error } = await client.auth.admin.getUserById(userId);
    if (error) {
      const status = (error as { status?: number }).status;
      if (status === 404) return null;
      throw new Error(
        `auth.admin.getUserById(${userId}) failed: ${error.message ?? 'unknown'}`,
      );
    }
    if (!data?.user) return null;
    return data.user.id;
  }

  if (email) {
    const matches: { id: string; email: string | null }[] = [];
    for (let page = 1; page <= EMAIL_LOOKUP_MAX_PAGES; page++) {
      const { data, error } = await client.auth.admin.listUsers({
        page,
        perPage: EMAIL_LOOKUP_PAGE_SIZE,
      });
      if (error) {
        throw new Error(
          `auth.admin.listUsers(page=${page}) failed: ${error.message}`,
        );
      }
      const pageMatches = data.users.filter(
        (u: { email?: string | null }) => u.email === email,
      );
      for (const m of pageMatches) {
        matches.push({ id: m.id, email: m.email ?? null });
      }
      if (data.users.length < EMAIL_LOOKUP_PAGE_SIZE) {
        // Last page reached.
        break;
      }
    }
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      throw new Error(
        `Multiple auth.users rows match email '${email}' (data corruption). ` +
          `Matched UUIDs: ${matches.map((m) => m.id).join(', ')}. ` +
          `Escalate to Liam — DO NOT proceed with the export.`,
      );
    }
    return matches[0].id;
  }

  return null;
}

/**
 * Fetch the auth.users payload for the resolved subject, redacted to
 * exclude security-sensitive fields per spec §3.1 D-G6.7-8.
 */
export async function fetchAuthUser(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  subjectUuid: string,
): Promise<AuthUserExport | null> {
  const { data, error } = await client.auth.admin.getUserById(subjectUuid);
  if (error || !data?.user) {
    return null;
  }
  const u = data.user as {
    id: string;
    email?: string | null;
    phone?: string | null;
    email_confirmed_at?: string | null;
    phone_confirmed_at?: string | null;
    last_sign_in_at?: string | null;
    created_at: string;
    updated_at?: string | null;
    user_metadata?: Record<string, unknown>;
    app_metadata?: Record<string, unknown>;
    identities?: { provider?: string; created_at?: string | null }[];
  };

  return {
    id: u.id,
    email: u.email ?? null,
    phone: u.phone ?? null,
    email_confirmed_at: u.email_confirmed_at ?? null,
    phone_confirmed_at: u.phone_confirmed_at ?? null,
    last_sign_in_at: u.last_sign_in_at ?? null,
    created_at: u.created_at,
    updated_at: u.updated_at ?? null,
    raw_user_meta_data: u.user_metadata ?? null,
    raw_app_meta_data: u.app_metadata ?? null,
    identities_summary: (u.identities ?? []).map((i) => ({
      provider: i.provider ?? 'unknown',
      created_at: i.created_at ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Public-schema fetchers
// ---------------------------------------------------------------------------

/**
 * Generic subject-keyed fetcher. Returns the array of matching rows
 * (empty if none — that's normal for audit-trail tables and a brand-new
 * user). Throws on Postgrest error.
 */
export async function fetchByColumn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  table: string,
  column: string,
  subjectUuid: string,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await client
    .from(table)
    .select('*')
    .eq(column, subjectUuid);
  if (error) {
    throw new Error(
      `SELECT * FROM ${table} WHERE ${column} = '${subjectUuid}' failed: ${error.message}`,
    );
  }
  return (data ?? []) as Record<string, unknown>[];
}

/**
 * For tables with multiple subject columns (e.g. form_responses with
 * drafted_by + last_edited_by + approved_by), fetch the union of rows
 * matching ANY of the columns, deduplicated by id.
 */
export async function fetchByAnyColumn(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  table: string,
  columns: string[],
  subjectUuid: string,
): Promise<Record<string, unknown>[]> {
  const seen = new Map<string, Record<string, unknown>>();
  for (const col of columns) {
    const rows = await fetchByColumn(client, table, col, subjectUuid);
    for (const row of rows) {
      const id = row.id as string | undefined;
      if (id) {
        seen.set(id, row);
      } else {
        // Composite-key tables use a synthetic key.
        seen.set(JSON.stringify(row), row);
      }
    }
  }
  return [...seen.values()];
}

// ---------------------------------------------------------------------------
// Bundle types
// ---------------------------------------------------------------------------

export interface SubjectBundle {
  auth_user: AuthUserExport;
  user_profile: Record<string, unknown> | null;
  user_role: Record<string, unknown> | null;
  user_notification_prefs: Record<string, unknown> | null;
}

export interface ActivityBundle {
  // read_marks REMOVED (id-138.19): table dropped at ID-131 M6 GO (S450)
  // alongside content_items — no successor "read" tracking exists post-M6.
  notifications: Record<string, unknown>[];
}

export interface AuditTrailBundle {
  // content_history REMOVED (id-138.19): table dropped at ID-131 M6 GO (S450).
  // Its subject was content_items (also dropped) — no successor row-level
  // audit trail exists for that entity.
  form_response_history: Record<string, unknown>[];
  form_responses: Record<string, unknown>[];
  form_questions: Record<string, unknown>[];
  // form_templates ADDED (id-138.19): created_by + outcome_recorded_by are
  // user-linked but were never bundled (untyped queries — tsc missed the gap).
  form_templates: Record<string, unknown>[];
  verification_history: Record<string, unknown>[];
  classification_disputes: Record<string, unknown>[];
  feed_flags: Record<string, unknown>[];
  tag_morphology_drift_flags: Record<string, unknown>[];
  review_assignments: Record<string, unknown>[];
  source_documents: Record<string, unknown>[];
  taxonomy_domains: Record<string, unknown>[];
  taxonomy_subtopics: Record<string, unknown>[];
  taxonomy_sync_state: Record<string, unknown>[];
  change_reports: Record<string, unknown>[];
  processing_queue: Record<string, unknown>[];
  pipeline_runs: Record<string, unknown>[];
  ingestion_quality_log: Record<string, unknown>[];
  governance_config: Record<string, unknown>[];
  // q_a_pair_history / q_a_pair_dedup_proposals / eval_baselines /
  // eval_baseline_audit ADDED (id-138.19): surfaced by the post-M6
  // user-linked-table re-audit — none was previously bundled.
  q_a_pair_history: Record<string, unknown>[];
  q_a_pair_dedup_proposals: Record<string, unknown>[];
  eval_baselines: Record<string, unknown>[];
  eval_baseline_audit: Record<string, unknown>[];
}

export interface AttributedContentBundle {
  // content_items REMOVED (id-138.19): table dropped at ID-131 M6 GO (S450).
  // record_lifecycle ADDED: confirmed successor of content_items' governance
  // actor columns (content_owner_id/governance_reviewer_id/verified_by) per
  // supabase/migrations/20260706100000_id131_facet_mint.sql backfill notes.
  record_lifecycle: Record<string, unknown>[];
  citations: Record<string, unknown>[];
  feed_prompts: Record<string, unknown>[];
  feed_sources: Record<string, unknown>[];
  coverage_targets: Record<string, unknown>[];
  guides: Record<string, unknown>[];
  // templates REMOVED (id-138.19): queried a table literally named
  // 'templates', which never existed — pre-existing dead code. The real
  // referent (content_templates) was dropped at M6 with no successor domain.
  template_completions: Record<string, unknown>[];
  workspaces: Record<string, unknown>[];
  company_profiles: Record<string, unknown>[];
}

export interface ManifestEntry {
  filename: string;
  size_bytes: number;
  sha256: string;
}

export interface BundleManifest {
  schema_version: '1.0';
  generated_at_iso: string;
  invocation: {
    env: 'prod' | 'staging';
    article: '15' | '20';
    format: 'json' | 'both';
    subject_lookup: 'user-id' | 'email';
  };
  subject_uuid: string;
  files: ManifestEntry[];
  notes: {
    excluded_fields: string[];
    excluded_third_party_pii: boolean;
    article_17_erasure_pending_wp: string;
  };
}

// ---------------------------------------------------------------------------
// Bundle assembly
// ---------------------------------------------------------------------------

export async function assembleSubjectBundle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  subjectUuid: string,
  authUser: AuthUserExport,
): Promise<SubjectBundle> {
  const [profileRows, roleRows, prefsRows] = await Promise.all([
    fetchByColumn(client, 'user_profiles', 'id', subjectUuid),
    fetchByColumn(client, 'user_roles', 'user_id', subjectUuid),
    fetchByColumn(client, 'user_notification_prefs', 'user_id', subjectUuid),
  ]);
  return {
    auth_user: authUser,
    user_profile: profileRows[0] ?? null,
    user_role: roleRows[0] ?? null,
    user_notification_prefs: prefsRows[0] ?? null,
  };
}

export async function assembleActivityBundle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  subjectUuid: string,
): Promise<ActivityBundle> {
  const [notifications] = await Promise.all([
    fetchByColumn(client, 'notifications', 'user_id', subjectUuid),
  ]);
  return { notifications };
}

export async function assembleAuditTrailBundle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  subjectUuid: string,
): Promise<AuditTrailBundle> {
  const [
    procurementRespHistory,
    procurementResponses,
    procurementQuestions,
    formTemplates,
    verificationHistory,
    classificationDisputes,
    feedFlags,
    tagMorphologyDriftFlags,
    reviewAssignments,
    sourceDocuments,
    taxonomyDomains,
    taxonomySubtopics,
    taxonomySyncState,
    changeReports,
    processingQueue,
    pipelineRuns,
    ingestionQualityLog,
    governanceConfig,
    qaPairHistory,
    qaPairDedupProposals,
    evalBaselines,
    evalBaselineAudit,
  ] = await Promise.all([
    fetchByColumn(client, 'form_response_history', 'edited_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'form_responses',
      ['drafted_by', 'last_edited_by', 'approved_by'],
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'form_questions',
      ['assigned_to', 'created_by'],
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'form_templates',
      ['created_by', 'outcome_recorded_by'],
      subjectUuid,
    ),
    fetchByColumn(client, 'verification_history', 'performed_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'classification_disputes',
      ['disputed_by', 'resolved_by'],
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'feed_flags',
      ['flagged_by', 'resolved_by'],
      subjectUuid,
    ),
    fetchByColumn(
      client,
      'tag_morphology_drift_flags',
      'decided_by',
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'review_assignments',
      ['assigned_by', 'reviewer_id'],
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'source_documents',
      ['archived_by', 'uploaded_by', 'updated_by'],
      subjectUuid,
    ),
    fetchByColumn(client, 'taxonomy_domains', 'recommended_by', subjectUuid),
    fetchByColumn(client, 'taxonomy_subtopics', 'recommended_by', subjectUuid),
    fetchByColumn(client, 'taxonomy_sync_state', 'synced_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'change_reports',
      ['created_by', 'generated_by'],
      subjectUuid,
    ),
    fetchByColumn(client, 'processing_queue', 'created_by', subjectUuid),
    fetchByColumn(client, 'pipeline_runs', 'created_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'ingestion_quality_log',
      ['created_by', 'resolved_by'],
      subjectUuid,
    ),
    fetchByAnyColumn(
      client,
      'governance_config',
      ['created_by', 'updated_by', 'reviewer_id'],
      subjectUuid,
    ),
    fetchByColumn(client, 'q_a_pair_history', 'changed_by', subjectUuid),
    fetchByColumn(
      client,
      'q_a_pair_dedup_proposals',
      'resolved_by',
      subjectUuid,
    ),
    fetchByColumn(client, 'eval_baselines', 'promoted_by', subjectUuid),
    fetchByColumn(client, 'eval_baseline_audit', 'actor', subjectUuid),
  ]);
  return {
    form_response_history: procurementRespHistory,
    form_responses: procurementResponses,
    form_questions: procurementQuestions,
    form_templates: formTemplates,
    verification_history: verificationHistory,
    classification_disputes: classificationDisputes,
    feed_flags: feedFlags,
    tag_morphology_drift_flags: tagMorphologyDriftFlags,
    review_assignments: reviewAssignments,
    source_documents: sourceDocuments,
    taxonomy_domains: taxonomyDomains,
    taxonomy_subtopics: taxonomySubtopics,
    taxonomy_sync_state: taxonomySyncState,
    change_reports: changeReports,
    processing_queue: processingQueue,
    pipeline_runs: pipelineRuns,
    ingestion_quality_log: ingestionQualityLog,
    governance_config: governanceConfig,
    q_a_pair_history: qaPairHistory,
    q_a_pair_dedup_proposals: qaPairDedupProposals,
    eval_baselines: evalBaselines,
    eval_baseline_audit: evalBaselineAudit,
  };
}

export async function assembleAttributedContentBundle(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: SupabaseClient<any, any, any, any, any>,
  subjectUuid: string,
): Promise<AttributedContentBundle> {
  const [
    recordLifecycle,
    citations,
    feedPrompts,
    feedSources,
    coverageTargets,
    guides,
    templateCompletions,
    workspaces,
    companyProfiles,
  ] = await Promise.all([
    fetchByAnyColumn(
      client,
      'record_lifecycle',
      ['governance_reviewer_id', 'verified_by', 'content_owner_id'],
      subjectUuid,
    ),
    fetchByColumn(client, 'citations', 'created_by', subjectUuid),
    fetchByColumn(client, 'feed_prompts', 'created_by', subjectUuid),
    fetchByColumn(client, 'feed_sources', 'created_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'coverage_targets',
      ['created_by', 'updated_by'],
      subjectUuid,
    ),
    fetchByColumn(client, 'guides', 'created_by', subjectUuid),
    fetchByColumn(client, 'template_completions', 'created_by', subjectUuid),
    fetchByAnyColumn(
      client,
      'workspaces',
      ['created_by', 'updated_by'],
      subjectUuid,
    ),
    fetchByColumn(client, 'company_profiles', 'created_by', subjectUuid),
  ]);
  return {
    record_lifecycle: recordLifecycle,
    citations,
    feed_prompts: feedPrompts,
    feed_sources: feedSources,
    coverage_targets: coverageTargets,
    guides,
    template_completions: templateCompletions,
    workspaces,
    company_profiles: companyProfiles,
  };
}

// ---------------------------------------------------------------------------
// CSV summaries
// ---------------------------------------------------------------------------

/**
 * Build a single-row CSV summary of subject identifier columns.
 */
export function buildSubjectSummaryCsv(bundle: SubjectBundle): string {
  const rows = [
    ['field', 'value'],
    ['auth_user.id', bundle.auth_user.id],
    ['auth_user.email', bundle.auth_user.email ?? ''],
    ['auth_user.phone', bundle.auth_user.phone ?? ''],
    ['auth_user.created_at', bundle.auth_user.created_at],
    ['auth_user.last_sign_in_at', bundle.auth_user.last_sign_in_at ?? ''],
    ['user_profile.full_name', stringField(bundle.user_profile, 'full_name')],
    ['user_profile.email', stringField(bundle.user_profile, 'email')],
    ['user_role.role', stringField(bundle.user_role, 'role')],
    ['user_role.display_name', stringField(bundle.user_role, 'display_name')],
  ];
  return (
    UTF8_BOM + rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
  );
}

/**
 * Build a per-event CSV of activity (notifications).
 */
export function buildActivitySummaryCsv(activity: ActivityBundle): string {
  const rows: string[][] = [['event_type', 'event_id', 'event_at', 'detail']];
  for (const n of activity.notifications) {
    rows.push([
      'notification',
      String(n.id ?? ''),
      String(n.created_at ?? ''),
      `type=${String(n.type ?? '')};title=${String(n.title ?? '')};read_at=${String(n.read_at ?? '')}`,
    ]);
  }
  return (
    UTF8_BOM + rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n'
  );
}

function stringField(row: Record<string, unknown> | null, key: string): string {
  if (!row) return '';
  const v = row[key];
  return v == null ? '' : String(v);
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

// ---------------------------------------------------------------------------
// README.md (subject-facing)
// ---------------------------------------------------------------------------

export function buildReadme(
  subjectUuid: string,
  authUser: AuthUserExport,
  invocation: BundleManifest['invocation'],
  generatedAtIso: string,
): string {
  const articleLabel =
    invocation.article === '15'
      ? 'Article 15 (right of access — full export)'
      : 'Article 20 (right to data portability — structured data subset)';
  return `# Your Personal Data — Knowledge Hub Export

**Generated:** ${formatUkDate(generatedAtIso)}
**Subject UUID:** \`${subjectUuid}\`
**Subject email:** \`${authUser.email ?? '(not set)'}\`
**Request type:** ${articleLabel}

## What is in this bundle?

This bundle contains the personal data Knowledge Hub holds about you,
as required by the UK General Data Protection Regulation (UK GDPR).

### Files in this bundle

- **\`subject.json\`** — your account record (auth.users), profile
  (user_profiles), assigned role (user_roles), and notification
  preferences (user_notification_prefs).
- **\`activity.json\`** — your in-app activity: notifications you have
  received.
- **\`audit-trail.json\`** — system audit-trail rows attributing actions
  to your account: bid responses and forms you drafted / edited /
  approved, source documents you verified, Q&A pairs you changed or
  deduplicated, classification disputes you raised, feed flags you
  submitted, evaluation baselines you promoted, etc. _(Article 15
  only — omitted from Article 20 portability bundles.)_
- **\`attributed-content.json\`** — source documents and Q&A pairs where
  you are recorded as owner, governance reviewer, or verifier, plus
  other content rows where you are the creator. _(Article 15 only.)_
- **\`subject-summary.csv\`** / **\`activity-summary.csv\`** — human-readable
  CSV summaries of the JSON files above. Open in Excel or any
  spreadsheet tool.
- **\`manifest.json\`** — file inventory with SHA-256 checksums to verify
  bundle integrity.
- **\`README.md\`** — this file.

## What is NOT in this bundle?

Per UK GDPR Article 15 §3 and the Data Protection Act 2018 Schedule 2:

- **Your password** is excluded — disclosing it would compromise your
  account security. We store only an irreversible cryptographic hash,
  not your actual password.
- **Other users' personal data** is excluded — even where another user
  appears in your audit-trail rows (e.g. another user approved a bid
  response you drafted), their identifying details are redacted
  because they have their own UK GDPR rights to control their data.

## Verifying bundle integrity

\`manifest.json\` contains a SHA-256 checksum for every other file in
this bundle. To verify:

\`\`\`bash
# macOS / Linux
shasum -a 256 subject.json
\`\`\`

Compare the output to the value listed under \`subject.json\` in
\`manifest.json\`. If they match, the file is intact.

## Questions?

If anything in this bundle is unclear, contact:

- **Your data controller** — _(operator's organisational contact details)_

You also have the right to:

- **Rectify inaccurate data** (UK GDPR Article 16) — let us know which
  field is wrong and what the correct value is.
- **Erase your data** (UK GDPR Article 17) — let us know you want your
  account closed. Note: some audit-trail data is retained for compliance
  and trust reasons but will be pseudonymised so it no longer identifies
  you.
- **Restrict processing** (UK GDPR Article 18).
- **Lodge a complaint** with the Information Commissioner's Office
  (https://ico.org.uk) if you are unhappy with how we have handled your
  request.

---

_This bundle was generated by \`scripts/export-user-data.ts\` per the
WP-G6.7 procedure documented in \`docs/handover/gdpr-data-export.md\`._
`;
}

function formatUkDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yyyy = d.getUTCFullYear();
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  return `${dd}/${mm}/${yyyy} ${hh}:${mi} UTC`;
}

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------

export function buildManifestEntry(
  filename: string,
  content: string,
): ManifestEntry {
  const buf = Buffer.from(content, 'utf-8');
  const sha = createHash('sha256').update(buf).digest('hex');
  return { filename, size_bytes: buf.byteLength, sha256: sha };
}

// ---------------------------------------------------------------------------
// Output writer
// ---------------------------------------------------------------------------

export interface WriteResult {
  bundleDir: string;
  files: ManifestEntry[];
  totalBytes: number;
}

export function writeBundle(
  outputBaseDir: string,
  subjectUuid: string,
  generatedAtIso: string,
  payload: {
    subject: SubjectBundle;
    activity: ActivityBundle;
    auditTrail: AuditTrailBundle | null;
    attributedContent: AttributedContentBundle | null;
    invocation: BundleManifest['invocation'];
    format: 'json' | 'both';
  },
): WriteResult {
  // Build dir name: <uuid>-<timestamp> with timestamp filesystem-safe.
  const fsTimestamp = generatedAtIso.replace(/[:.]/g, '-');
  const bundleDir = path.join(outputBaseDir, `${subjectUuid}-${fsTimestamp}`);

  fs.mkdirSync(bundleDir, { recursive: true });

  const filesToWrite: { name: string; content: string }[] = [];

  filesToWrite.push({
    name: 'subject.json',
    content: JSON.stringify(payload.subject, null, 2) + '\n',
  });
  filesToWrite.push({
    name: 'activity.json',
    content: JSON.stringify(payload.activity, null, 2) + '\n',
  });
  if (payload.auditTrail) {
    filesToWrite.push({
      name: 'audit-trail.json',
      content: JSON.stringify(payload.auditTrail, null, 2) + '\n',
    });
  }
  if (payload.attributedContent) {
    filesToWrite.push({
      name: 'attributed-content.json',
      content: JSON.stringify(payload.attributedContent, null, 2) + '\n',
    });
  }

  if (payload.format === 'both') {
    filesToWrite.push({
      name: 'subject-summary.csv',
      content: buildSubjectSummaryCsv(payload.subject),
    });
    filesToWrite.push({
      name: 'activity-summary.csv',
      content: buildActivitySummaryCsv(payload.activity),
    });
  }

  filesToWrite.push({
    name: 'README.md',
    content: buildReadme(
      subjectUuid,
      payload.subject.auth_user,
      payload.invocation,
      generatedAtIso,
    ),
  });

  // Write all data files first so the manifest can include them.
  const manifestEntries: ManifestEntry[] = [];
  let totalBytes = 0;
  for (const f of filesToWrite) {
    const entry = buildManifestEntry(f.name, f.content);
    fs.writeFileSync(path.join(bundleDir, f.name), f.content, 'utf-8');
    manifestEntries.push(entry);
    totalBytes += entry.size_bytes;
  }

  // Now build + write the manifest itself.
  const manifest: BundleManifest = {
    schema_version: '1.0',
    generated_at_iso: generatedAtIso,
    invocation: payload.invocation,
    subject_uuid: subjectUuid,
    files: manifestEntries,
    notes: {
      excluded_fields: [
        'auth.users.encrypted_password',
        'auth.users.confirmation_token',
        'auth.users.email_change_token_new',
        'auth.users.email_change_token_current',
        'auth.users.recovery_token',
        'auth.users.reauthentication_token',
      ],
      excluded_third_party_pii: true,
      article_17_erasure_pending_wp:
        'WP-G6.X — see docs/audits/kh-production-readiness-phase-1/specs/wp-g6.7-gdpr-data-export-spec.md §8',
    },
  };
  const manifestContent = JSON.stringify(manifest, null, 2) + '\n';
  const manifestEntry = buildManifestEntry('manifest.json', manifestContent);
  fs.writeFileSync(
    path.join(bundleDir, 'manifest.json'),
    manifestContent,
    'utf-8',
  );
  manifestEntries.push(manifestEntry);
  totalBytes += manifestEntry.size_bytes;

  return { bundleDir, files: manifestEntries, totalBytes };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const HELP_TEXT = `
GDPR Data Subject Export (UK GDPR Articles 15 + 20).

Usage:
  bun run scripts/export-user-data.ts --env=prod --user-id <uuid> [options]
  bun run scripts/export-user-data.ts --env=staging --email <addr> [options]

Required:
  --env=prod | --env=staging       Environment to read from. NO default.
  --user-id <uuid> | --email <addr>  Subject identifier. Mutually exclusive.

Options:
  --output <dir>      Base output directory. Default: ./exports/.
                      Bundle dir: <output>/<uuid>-<ISO8601-timestamp>/.
  --article=15|20     15 = full export (default). 20 = portability subset
                      (excludes audit-trail and attributed-content bundles).
  --format=json|both  json = JSON only. both = JSON + CSV summaries (default).
  --help, -h          Show this help and exit.

Required env vars:
  SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)
  SUPABASE_SERVICE_ROLE_KEY  — RLS-bypassing read of auth.users + public.*

Exit codes:
  0  success — bundle written
  1  subject not found (no auth.users row)
  2  export error (DB unreachable, write permission denied, etc.)

See:
  docs/handover/gdpr-data-export.md  — operator runbook
  docs/audits/kh-production-readiness-phase-1/specs/wp-g6.7-gdpr-data-export-spec.md
                                     — spec (PII inventory + decisions)
`;

async function main(): Promise<number> {
  // Load env from .env.local for local invocations (worktree-friendly via cwd).
  loadEnvFile(path.join(process.cwd(), '.env.local'));

  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    console.log(HELP_TEXT);
    return EXIT_OK;
  }

  if (args.error) {
    console.error(`Error: ${args.error}\n`);
    console.error(HELP_TEXT);
    return EXIT_EXPORT_ERROR;
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in env.',
    );
    return EXIT_EXPORT_ERROR;
  }

  assertEnvFlag(args.env, supabaseUrl);

  const client = createScriptClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Resolve subject UUID.
  let subjectUuid: string | null;
  try {
    subjectUuid = await resolveSubjectUuid(client, args.userId, args.email);
  } catch (err) {
    console.error(
      `Error resolving subject: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_EXPORT_ERROR;
  }

  if (!subjectUuid) {
    const lookupKey = args.userId
      ? `--user-id ${args.userId}`
      : `--email ${args.email}`;
    console.error(`Subject not found: no auth.users row matches ${lookupKey}.`);
    return EXIT_SUBJECT_NOT_FOUND;
  }

  console.log(`Resolved subject: ${subjectUuid}`);
  console.log(`Environment: ${args.env}`);
  console.log(`Article: ${args.article}`);
  console.log(`Format: ${args.format}`);
  console.log(`Output base: ${args.output}`);

  // Fetch the redacted auth user payload.
  let authUser: AuthUserExport | null;
  try {
    authUser = await fetchAuthUser(client, subjectUuid);
  } catch (err) {
    console.error(
      `Error fetching auth user: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_EXPORT_ERROR;
  }
  if (!authUser) {
    console.error(
      `Subject UUID resolved but auth.admin.getUserById returned no user: ${subjectUuid}`,
    );
    return EXIT_EXPORT_ERROR;
  }

  // Assemble bundles.
  let subject: SubjectBundle;
  let activity: ActivityBundle;
  let auditTrail: AuditTrailBundle | null = null;
  let attributedContent: AttributedContentBundle | null = null;

  try {
    subject = await assembleSubjectBundle(client, subjectUuid, authUser);
    activity = await assembleActivityBundle(client, subjectUuid);
    if (args.article === '15') {
      auditTrail = await assembleAuditTrailBundle(client, subjectUuid);
      attributedContent = await assembleAttributedContentBundle(
        client,
        subjectUuid,
      );
    }
  } catch (err) {
    console.error(
      `Error assembling bundle: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_EXPORT_ERROR;
  }

  // Write bundle to disk.
  const generatedAtIso = new Date().toISOString();
  const lookupSource: BundleManifest['invocation']['subject_lookup'] =
    args.userId ? 'user-id' : 'email';
  let writeResult: WriteResult;
  try {
    writeResult = writeBundle(args.output, subjectUuid, generatedAtIso, {
      subject,
      activity,
      auditTrail,
      attributedContent,
      invocation: {
        env: args.env as 'prod' | 'staging',
        article: args.article,
        format: args.format,
        subject_lookup: lookupSource,
      },
      format: args.format,
    });
  } catch (err) {
    console.error(
      `Error writing bundle: ${err instanceof Error ? err.message : String(err)}`,
    );
    return EXIT_EXPORT_ERROR;
  }

  console.log('');
  console.log(`Bundle written: ${writeResult.bundleDir}`);
  console.log(`Files (${writeResult.files.length}):`);
  for (const f of writeResult.files) {
    console.log(
      `  ${f.filename}  (${f.size_bytes} bytes, sha256=${f.sha256.slice(0, 16)}…)`,
    );
  }
  console.log(`Total bundle size: ${writeResult.totalBytes} bytes`);

  // Operator-side audit trail via recordPipelineRun.
  // Uses dynamic import so unit tests can mock the bundle without
  // requiring full Sentry initialisation.
  try {
    const { recordPipelineRun } = await import('../lib/pipeline/record-run');
    await recordPipelineRun({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      supabase: client as any,
      pipelineName: 'dsar_export',
      status: 'completed',
      itemsProcessed: writeResult.files.length,
      result: {
        subject_uuid: subjectUuid,
        env: args.env,
        article: args.article,
        format: args.format,
        bundle_dir: writeResult.bundleDir,
        total_bytes: writeResult.totalBytes,
        file_count: writeResult.files.length,
      },
    });
  } catch (err) {
    // Best-effort — do not fail the export on audit-log failure.
    console.warn(
      `Warning: recordPipelineRun audit-log failed (export still succeeded): ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return EXIT_OK;
}

// Only invoke main when run directly (not when imported by tests).
if (import.meta.main) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error('Fatal error:', err);
      process.exit(EXIT_EXPORT_ERROR);
    });
}
