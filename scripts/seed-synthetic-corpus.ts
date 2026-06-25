#!/usr/bin/env bun
/**
 * ID-127.4 / ID-130 {130.8} (T-B22) — seed the synthetic procurement corpus.
 *
 * Creates SIX clearly-synthetic `workspaces` (each carrying a full
 * `ProcurementMetadataSchema`-valid `domain_metadata`) plus ~5 SQ-style
 * `form_questions` per workspace (~30 rows) on a Platform Supabase DB. The six
 * workspaces are deliberately shaped to span every {130.8}/T-B22 `form_templates`
 * mint branch so the data migration can be validated on the data-sparse staging
 * DB (where the 12 live workspaces all carry NULL outcome/status — a degenerate
 * snapshot per the {130.8} TECH "Risks" note). It ALSO emits the mandatory root
 * `.kh-workspace-map.json` manifest (ID-127.4 BI-7) binding the `forms/procurement/`
 * walk prefix to the BI-8 `Platform — Procurement` workspace.
 *
 * **What it seeds (and what it deliberately does NOT).** workspaces +
 * domain_metadata + form_questions ONLY. It does NOT seed `form_responses` /
 * `citations` — the {130.8} win-rate parity test owns its own citing fixture
 * (resolved Q-2). It does NOT seed the feed slice — `seed-platform-feed.ts`
 * already covers that and the corpus reuses it. It does NOT author the local-fs
 * `corpus/` file tree — that is an operator task outside this script.
 *
 * **The six synthetic workspaces (PROPOSAL §A1) — {130.8} mint branches:**
 *   1. `Synthetic — First-Client Open Tender (won)`      → won lift (numerator+denominator)
 *   2. `Synthetic — First-Client Framework Bid (lost)`   → lost lift (denominator only)
 *   3. `Synthetic — First-Client RFP (withdrawn)`        → withdrawn transform (workflow_state='withdrawn', outcome=NULL)
 *   4. `Synthetic — First-Client SQ (in progress)`       → COALESCE-status fallback (questions_extracted; no outcome)
 *   5. `Synthetic — First-Client Tender (draft, null status)` → COALESCE(NULL,'draft') edge (status key OMITTED from stored JSONB)
 *   6. `Synthetic — First-Client PSQ shortlist (not_shortlisted)` → psq shortlist case (intent carried by name/notes)
 *
 * Every `domain_metadata` carries an INVENTED generic UK public-body buyer
 * (never a real client name), a `SYN-00n` reference, an estimated value, and a
 * `notes` marker (`Synthetic corpus row …; safe to delete.`) so the whole corpus
 * is trivially identifiable and removable via `--clean`.
 *
 * **Row #5 reconciliation (status required vs COALESCE edge).**
 * `ProcurementMetadataSchema.status` is a REQUIRED enum, but the {130.8}
 * COALESCE(domain_metadata->>'status','draft') edge needs a row whose stored
 * JSONB has NO `status` key. We honour both: every seed's full (status-bearing)
 * `metadata` is `ProcurementMetadataSchema.parse`-validated to prove its shape,
 * then row #5's STORED payload drops the `status` key (`omitStatusKey`). All
 * other rows store the validated object verbatim.
 *
 * **Target-parameterised (mirrors `seed-platform-workspaces.ts`).** Runs against
 * EITHER Platform DB — prod (`zjqbrdctesqvouboziae`) or staging
 * (`rbwqewalexrzgxtvcqrh`) — via `--target=prod|staging` (or `SEED_PLATFORM_TARGET`).
 * Reuses the target resolution + project-ref guard from `seed-platform-workspaces.ts`.
 * One DB per run; no "both at once" (credential fat-finger guard). Synthetic data
 * in prod is intended — the Platform exists for E2E/dogfooding (resolved R-2).
 *
 * **Idempotency:** lookup-then-insert. Workspaces are matched by their stable
 * `name` (no unique constraint — the BI-8 seed pattern); form_questions by
 * `(workspace_id, question_text)` (a UNIQUE constraint exists). A re-run is a
 * clean no-op.
 *
 * **Safety:** dry-run by default; a live write requires `--apply`. The dry-run
 * path plans + prints intent and performs NO writes. Reads/writes go through
 * `sb()` from `@/lib/supabase/safe`.
 *
 * Usage:
 *   bun run scripts/seed-synthetic-corpus.ts --target=staging                       # dry-run plan
 *   bun run scripts/seed-synthetic-corpus.ts --target=staging --apply               # live seed
 *   bun run scripts/seed-synthetic-corpus.ts --target=prod --apply                  # live seed (prod)
 *   bun run scripts/seed-synthetic-corpus.ts --target=staging --clean --apply       # remove the corpus
 *   bun run scripts/seed-synthetic-corpus.ts --target=staging --emit-manifest       # print .kh-workspace-map.json
 *   bun run scripts/seed-synthetic-corpus.ts --target=staging --emit-manifest --manifest-out=/path/.kh-workspace-map.json
 *
 * Spec: specs/synthetic-platform-corpus/PROPOSAL.md §(a) §(c); resolved Q-1/Q-2/R-2.
 */
import { sb, type PostgrestLike } from '@/lib/supabase/safe';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  PIPELINE_SYSTEM_USER_ID,
  parseSeedArgs,
  resolveTarget,
  type EnvLike,
  type PlatformTarget,
} from '@/scripts/seed-platform-workspaces';
import { ProcurementMetadataSchema } from '@/lib/validation/schemas';
import { writeFileSync } from 'node:fs';

// ── Constants ───────────────────────────────────────────────────────────────

/** Stable name prefix for every synthetic workspace — `--clean`'s LIKE key. */
export const SYNTHETIC_WORKSPACE_PREFIX = 'Synthetic — ';

/** Literal marker stamped into every `domain_metadata.notes` (PROPOSAL §A1). */
export const SYNTHETIC_NOTES_MARKER =
  'Synthetic corpus row — ID-127.4/ID-130 validation; safe to delete.';

/** Provenance description on every synthetic workspace row. */
export const SYNTHETIC_WORKSPACE_DESCRIPTION =
  'Synthetic — First-Client procurement corpus row (ID-127.4 / ID-130 {130.8} ' +
  'validation). Safe to delete via seed-synthetic-corpus.ts --clean.';

/**
 * The workspace the `forms/procurement/` manifest prefix binds to. Resolved
 * Q-1: this is the BI-8 `Platform — Procurement` workspace (looked up by exact
 * name), NOT a synthetic workspace — keeping walk-minted forms disjoint from the
 * {130.8} synthetic mint subjects.
 */
export const FORMS_MANIFEST_WORKSPACE_NAME = 'Platform — Procurement';

/** The single mapped walk prefix in the root manifest (PROPOSAL §B). */
export const FORMS_PATH_PREFIX = 'forms/procurement/';

// ── Metadata fixtures (the six {130.8} mint subjects) ────────────────────────

/** Post-parse shape of a `ProcurementMetadataSchema` object. */
export type SyntheticMetadata = ReturnType<
  typeof ProcurementMetadataSchema.parse
>;

export interface SyntheticWorkspaceSeed {
  readonly name: string;
  /**
   * A FULL `ProcurementMetadataSchema`-valid object. Always carries `status`
   * (the schema requires it); `omitStatusKey` controls whether `status` is
   * dropped from the STORED JSONB.
   */
  readonly metadata: SyntheticMetadata;
  /**
   * Row #5 only: store `domain_metadata` WITHOUT the `status` key to exercise
   * the {130.8} `COALESCE(domain_metadata->>'status','draft')` edge. The full
   * (status-bearing) `metadata` is still schema-validated to prove every other
   * field is correct; only the stored JSONB drops `status`.
   */
  readonly omitStatusKey?: boolean;
}

/**
 * Six synthetic procurement workspaces, one per {130.8}/T-B22 mint branch.
 * Buyers are INVENTED generic UK public bodies — never a real client name.
 * Rows 1/2/6 carry `outcome_recorded_at` + `outcome_recorded_by` (the audit
 * fields that lift alongside a `{won,lost}` outcome).
 */
export const SYNTHETIC_WORKSPACES: ReadonlyArray<SyntheticWorkspaceSeed> = [
  // 1 — won lift (numerator + denominator).
  {
    name: 'Synthetic — First-Client Open Tender (won)',
    metadata: {
      buyer: 'Northgate Borough Council',
      status: 'won',
      deadline: '2025-08-15T00:00:00Z',
      reference_number: 'SYN-001',
      estimated_value: '250000',
      tender_source: 'upload',
      tender_document_ids: [],
      submission_date: '2025-08-10T00:00:00Z',
      outcome: 'won',
      outcome_notes: 'Awarded — strongest technical score.',
      notes: SYNTHETIC_NOTES_MARKER,
      outcome_recorded_at: '2025-09-01T00:00:00Z',
      outcome_recorded_by: PIPELINE_SYSTEM_USER_ID,
    },
  },
  // 2 — lost lift (denominator only).
  {
    name: 'Synthetic — First-Client Framework Bid (lost)',
    metadata: {
      buyer: 'Westmere NHS Trust',
      status: 'lost',
      deadline: '2025-07-20T00:00:00Z',
      reference_number: 'SYN-002',
      estimated_value: '480000',
      tender_source: 'upload',
      tender_document_ids: [],
      submission_date: '2025-07-15T00:00:00Z',
      outcome: 'lost',
      outcome_notes: 'Not selected onto the framework.',
      notes: SYNTHETIC_NOTES_MARKER,
      outcome_recorded_at: '2025-08-05T00:00:00Z',
      outcome_recorded_by: PIPELINE_SYSTEM_USER_ID,
    },
  },
  // 3 — withdrawn transform (workflow_state='withdrawn', outcome → NULL).
  {
    name: 'Synthetic — First-Client RFP (withdrawn)',
    metadata: {
      buyer: 'Brackenmoor Combined Authority',
      status: 'withdrawn',
      deadline: '2025-06-30T00:00:00Z',
      reference_number: 'SYN-003',
      estimated_value: '120000',
      tender_source: 'manual',
      tender_document_ids: [],
      submission_date: '2025-06-25T00:00:00Z',
      outcome: 'withdrawn',
      outcome_notes: 'Withdrawn before award.',
      notes: SYNTHETIC_NOTES_MARKER,
    },
  },
  // 4 — COALESCE-status fallback (in-progress; no outcome).
  {
    name: 'Synthetic — First-Client SQ (in progress)',
    metadata: {
      buyer: 'Eastfield District Council',
      status: 'questions_extracted',
      deadline: '2025-12-01T00:00:00Z',
      reference_number: 'SYN-004',
      estimated_value: '95000',
      tender_source: 'upload',
      tender_document_ids: [],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: SYNTHETIC_NOTES_MARKER,
    },
  },
  // 5 — COALESCE(NULL,'draft') edge. `status` is OMITTED from the stored JSONB
  //     (validated as 'draft' to prove the rest of the shape is correct).
  {
    name: 'Synthetic — First-Client Tender (draft, null status)',
    omitStatusKey: true,
    metadata: {
      buyer: 'Harlowdale Borough Council',
      status: 'draft',
      deadline: '2026-01-15T00:00:00Z',
      reference_number: 'SYN-005',
      estimated_value: '60000',
      tender_source: 'manual',
      tender_document_ids: [],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: SYNTHETIC_NOTES_MARKER,
    },
  },
  // 6 — psq shortlist case (not_shortlisted). The "psq" intent is carried by
  //     the name/notes only — {130.8} derives form_type downstream.
  {
    name: 'Synthetic — First-Client PSQ shortlist (not_shortlisted)',
    metadata: {
      buyer: 'Southvale County Council',
      status: 'lost',
      deadline: '2025-05-10T00:00:00Z',
      reference_number: 'SYN-006',
      estimated_value: '320000',
      tender_source: 'upload',
      tender_document_ids: [],
      submission_date: '2025-05-05T00:00:00Z',
      outcome: 'lost',
      outcome_notes: 'PSQ shortlist stage — not shortlisted.',
      notes:
        SYNTHETIC_NOTES_MARKER +
        " PSQ shortlist case (not_shortlisted) — {130.8} derives form_type='psq' downstream.",
      outcome_recorded_at: '2025-06-01T00:00:00Z',
      outcome_recorded_by: PIPELINE_SYSTEM_USER_ID,
    },
  },
];

// ── Question fixtures (~5 SQ-style questions per workspace) ───────────────────

export interface SyntheticQuestion {
  readonly section_name: string;
  readonly section_sequence: number;
  readonly question_text: string;
  readonly question_sequence: number;
  readonly word_limit: number | null;
  readonly evaluation_weight: number | null;
}

/**
 * Five SQ-style questions (PPN 03/24 structure), reused verbatim across all six
 * workspaces → ~30 rows, matching the {130.8} ~30-row backfill scale. Drawn from
 * `seed-procurement-test-data.ts`'s fixture set (Economic/Financial,
 * Technical/Professional, Health & Safety, Data Protection sections). Keyed to
 * `workspace_id` ONLY — the current schema has no `form_template_id` column
 * ({130.8} T-B4 adds it later).
 */
export const SYNTHETIC_QUESTIONS: ReadonlyArray<SyntheticQuestion> = [
  {
    section_name: 'Economic and Financial Standing',
    section_sequence: 1,
    question_text:
      'Please provide your most recent annual turnover figure and confirm it exceeds the minimum threshold of £500,000 for the last two financial years.',
    question_sequence: 1,
    word_limit: 200,
    evaluation_weight: null,
  },
  {
    section_name: 'Technical and Professional Ability',
    section_sequence: 2,
    question_text:
      'Please provide two examples of contracts you have delivered in the last three years that are similar in scope and scale to this requirement. Include the client name, contract value, duration, and a brief description of the services provided.',
    question_sequence: 2,
    word_limit: 500,
    evaluation_weight: 25,
  },
  {
    section_name: 'Technical and Professional Ability',
    section_sequence: 2,
    question_text:
      'Describe your approach to quality management, including any relevant accreditations (e.g. ISO 9001) and how you monitor and improve service quality.',
    question_sequence: 3,
    word_limit: 400,
    evaluation_weight: 15,
  },
  {
    section_name: 'Health and Safety',
    section_sequence: 3,
    question_text:
      'What health and safety accreditations does your organisation hold? Please provide details of your health and safety management system and any relevant certifications.',
    question_sequence: 4,
    word_limit: 300,
    evaluation_weight: 10,
  },
  {
    section_name: 'Data Protection and Modern Slavery',
    section_sequence: 4,
    question_text:
      'Describe your approach to data protection and GDPR compliance. Include details of your Data Protection Officer, data processing agreements, and how you handle data breaches.',
    question_sequence: 5,
    word_limit: 400,
    evaluation_weight: 15,
  },
];

// ── Manifest ─────────────────────────────────────────────────────────────────

export interface WorkspaceMapManifest {
  readonly schema_version: 1;
  readonly mappings: ReadonlyArray<{
    readonly path_prefix: string;
    readonly workspace_id: string;
    readonly route: string;
  }>;
}

/** Build the root `.kh-workspace-map.json` manifest for a resolved workspace id. */
export function buildManifest(workspaceId: string): WorkspaceMapManifest {
  return {
    schema_version: 1,
    mappings: [
      {
        path_prefix: FORMS_PATH_PREFIX,
        workspace_id: workspaceId,
        route: 'forms',
      },
    ],
  };
}

// ── DB client surface (service-role; narrowed for typing) ────────────────────

/**
 * A filter builder that is itself awaitable AND chainable via
 * `.eq()`/`.in()`/`.like()`/`.maybeSingle()`. Mirrors the subset of the Supabase
 * builder this seed uses (the same posture as `seed-platform-workspaces.ts`).
 */
export interface CorpusFilterBuilder extends PostgrestLike<unknown> {
  eq: (column: string, value: unknown) => CorpusFilterBuilder;
  in: (column: string, values: readonly unknown[]) => CorpusFilterBuilder;
  like: (column: string, pattern: string) => CorpusFilterBuilder;
  maybeSingle: () => PostgrestLike<unknown>;
}

/** Minimal client surface the seed needs (the script client, narrowed). */
export interface CorpusDbClient {
  from(table: string): {
    select: (columns?: string) => CorpusFilterBuilder;
    insert: (values: unknown) => {
      select: (columns?: string) => { single: () => PostgrestLike<unknown> };
    };
    delete: () => CorpusFilterBuilder;
  };
}

// ── Arg parsing (extends the shared harness) ─────────────────────────────────

export interface CorpusArgs {
  readonly target: PlatformTarget;
  /** True unless `--apply` is given. Dry-run never writes. */
  readonly dryRun: boolean;
  /** Delete all `Synthetic — %` workspaces + cascade their questions. */
  readonly clean: boolean;
  /** Resolve the forms-route workspace uuid and emit the root manifest. */
  readonly emitManifest: boolean;
  /** Optional path to write the manifest to (else printed to stdout). */
  readonly manifestOut: string | null;
}

/**
 * Parse the CLI flags. Target selection is REQUIRED (reuses the shared
 * `parseSeedArgs` guard — `--target=prod|staging` or `SEED_PLATFORM_TARGET`).
 * Dry-run is the SAFE default unless `--apply` is given. Adds `--clean`,
 * `--emit-manifest`, and `--manifest-out=<path>`.
 */
export function parseCorpusArgs(
  argv: readonly string[],
  env: EnvLike = process.env,
): CorpusArgs {
  const base = parseSeedArgs(argv, env);
  const manifestFlag = argv.find((a) => a.startsWith('--manifest-out='));
  return {
    target: base.target,
    dryRun: base.dryRun,
    clean: argv.includes('--clean'),
    emitManifest: argv.includes('--emit-manifest'),
    manifestOut: manifestFlag
      ? manifestFlag.slice('--manifest-out='.length)
      : null,
  };
}

// ── Pure helpers (DB-free — the printable "intent") ──────────────────────────

/**
 * Validate every synthetic `domain_metadata` against `ProcurementMetadataSchema`.
 * FAILS LOUD on the first invalid fixture (a build-time guard reachable without
 * any DB connectivity). Validates the FULL status-bearing object even for row #5
 * (whose stored JSONB later drops `status`).
 */
export function validateSyntheticMetadata(): void {
  for (const seed of SYNTHETIC_WORKSPACES) {
    ProcurementMetadataSchema.parse(seed.metadata);
  }
}

/**
 * Build the JSONB to store for a seed. Verbatim for rows 1–4/6; for row #5
 * (`omitStatusKey`) the `status` key is dropped to create the {130.8}
 * `COALESCE(domain_metadata->>'status','draft')` edge.
 */
export function buildStoredMetadata(
  seed: SyntheticWorkspaceSeed,
): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...seed.metadata };
  if (seed.omitStatusKey) {
    delete stored.status;
  }
  return stored;
}

// ── Lookups ──────────────────────────────────────────────────────────────────

/**
 * Resolve the procurement `application_type` id by its stable cross-DB `key`.
 * FAILS LOUD if absent — the seed never creates an application_type (that is
 * canonical-baseline territory, seeded by `seed-platform-from-staging.ts`).
 */
export async function requireApplicationTypeId(
  client: CorpusDbClient,
  key: string,
): Promise<string> {
  const row = await sb<{ id: string } | null>(
    client
      .from('application_types')
      .select('id')
      .eq('key', key)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-synthetic-corpus.application_types.byKey',
  );
  if (!row) {
    throw new Error(
      `Seed aborted: baseline application_type key "${key}" is absent on the ` +
        'target DB. The application_types are a canonical-baseline prerequisite ' +
        '(seed-platform-from-staging) — this seed asserts them, never creates them.',
    );
  }
  return row.id;
}

/** Look up a workspace by its stable `name`. Returns the id if present, else null. */
async function findWorkspaceByName(
  client: CorpusDbClient,
  name: string,
): Promise<string | null> {
  const row = await sb<{ id: string } | null>(
    client
      .from('workspaces')
      .select('id')
      .eq('name', name)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-synthetic-corpus.workspaces.byName',
  );
  return row?.id ?? null;
}

/**
 * Look up a question by its UNIQUE `(workspace_id, question_text)` key. Returns
 * the id if present, else null.
 */
async function findQuestionId(
  client: CorpusDbClient,
  workspaceId: string,
  questionText: string,
): Promise<string | null> {
  const row = await sb<{ id: string } | null>(
    client
      .from('form_questions')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('question_text', questionText)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-synthetic-corpus.form_questions.byKey',
  );
  return row?.id ?? null;
}

/**
 * Resolve the `Platform — Procurement` workspace id (the forms-route manifest
 * binding, resolved Q-1). FAILS LOUD if absent — the BI-8 workspace seed
 * (`seed-platform-workspaces.ts`) must run first.
 */
export async function resolveFormsWorkspaceId(
  client: CorpusDbClient,
): Promise<string> {
  const row = await sb<{ id: string } | null>(
    client
      .from('workspaces')
      .select('id')
      .eq('name', FORMS_MANIFEST_WORKSPACE_NAME)
      .maybeSingle() as PostgrestLike<{ id: string } | null>,
    'seed-synthetic-corpus.workspaces.formsManifest',
  );
  if (!row) {
    throw new Error(
      `Seed aborted: the manifest binding workspace "${FORMS_MANIFEST_WORKSPACE_NAME}" ` +
        'is absent on the target DB. Run seed-platform-workspaces.ts (same target) ' +
        'FIRST — this seed never creates the BI-8 workspaces.',
    );
  }
  return row.id;
}

// ── Core seed logic (client-injected, testable) ──────────────────────────────

export type SeedAction = 'created' | 'already-exists' | 'would-create';

export interface WorkspaceSeedResult {
  readonly name: string;
  readonly id: string | null;
  readonly action: SeedAction;
}

export interface QuestionSeedResult {
  readonly workspaceName: string;
  readonly created: number;
  readonly alreadyExists: number;
  readonly wouldCreate: number;
}

export interface CleanResult {
  readonly matched: ReadonlyArray<{ id: string; name: string }>;
  readonly dryRun: boolean;
}

/**
 * Seed (or verify) the six synthetic workspaces. Idempotent: an existing row
 * (matched by `name`) is left untouched; an absent row is inserted with its
 * procurement `application_type_id`, the pipeline `created_by`, and its
 * (status-aware) stored `domain_metadata`.
 *
 * @param client   Service-role Platform DB client (RLS-bypassing).
 * @param dryRun   When true, plans the inserts but performs no write.
 */
export async function seedSyntheticWorkspaces(
  client: CorpusDbClient,
  dryRun: boolean,
): Promise<WorkspaceSeedResult[]> {
  const applicationTypeId = await requireApplicationTypeId(
    client,
    'procurement',
  );
  const results: WorkspaceSeedResult[] = [];

  for (const seed of SYNTHETIC_WORKSPACES) {
    const existingId = await findWorkspaceByName(client, seed.name);
    if (existingId) {
      results.push({
        name: seed.name,
        id: existingId,
        action: 'already-exists',
      });
      continue;
    }
    if (dryRun) {
      results.push({ name: seed.name, id: null, action: 'would-create' });
      continue;
    }

    const created = await sb<{ id: string }>(
      client
        .from('workspaces')
        .insert({
          name: seed.name,
          description: SYNTHETIC_WORKSPACE_DESCRIPTION,
          application_type_id: applicationTypeId,
          created_by: PIPELINE_SYSTEM_USER_ID,
          domain_metadata: buildStoredMetadata(seed),
        })
        .select('id')
        .single() as PostgrestLike<{ id: string }>,
      'seed-synthetic-corpus.workspaces.insert',
    );
    results.push({ name: seed.name, id: created.id, action: 'created' });
  }

  return results;
}

/**
 * Seed (or verify) the ~5 SQ-style questions for each seeded workspace.
 * Idempotent per `(workspace_id, question_text)`. A workspace with no id (a
 * dry-run `would-create`) reports all questions as `would-create` (the FK target
 * does not exist yet — no lookup is possible).
 *
 * @param client            Service-role Platform DB client.
 * @param workspaceResults  The output of `seedSyntheticWorkspaces`.
 * @param dryRun            When true, plans the inserts but performs no write.
 */
export async function seedSyntheticQuestions(
  client: CorpusDbClient,
  workspaceResults: ReadonlyArray<WorkspaceSeedResult>,
  dryRun: boolean,
): Promise<QuestionSeedResult[]> {
  const results: QuestionSeedResult[] = [];

  for (const ws of workspaceResults) {
    if (!ws.id) {
      results.push({
        workspaceName: ws.name,
        created: 0,
        alreadyExists: 0,
        wouldCreate: SYNTHETIC_QUESTIONS.length,
      });
      continue;
    }

    let created = 0;
    let alreadyExists = 0;
    let wouldCreate = 0;

    for (const q of SYNTHETIC_QUESTIONS) {
      const existing = await findQuestionId(client, ws.id, q.question_text);
      if (existing) {
        alreadyExists += 1;
        continue;
      }
      if (dryRun) {
        wouldCreate += 1;
        continue;
      }
      await sb<{ id: string }>(
        client
          .from('form_questions')
          .insert({
            workspace_id: ws.id,
            section_name: q.section_name,
            section_sequence: q.section_sequence,
            question_text: q.question_text,
            question_sequence: q.question_sequence,
            word_limit: q.word_limit,
            evaluation_weight: q.evaluation_weight,
          })
          .select('id')
          .single() as PostgrestLike<{ id: string }>,
        'seed-synthetic-corpus.form_questions.insert',
      );
      created += 1;
    }

    results.push({
      workspaceName: ws.name,
      created,
      alreadyExists,
      wouldCreate,
    });
  }

  return results;
}

/**
 * Remove the synthetic corpus: every `Synthetic — %` workspace and its
 * form_questions (FK order: questions first, then workspaces). Idempotent — a
 * re-run with nothing to delete is a no-op. Respects dry-run (matches only).
 */
export async function cleanSyntheticCorpus(
  client: CorpusDbClient,
  dryRun: boolean,
): Promise<CleanResult> {
  const matched = await sb<Array<{ id: string; name: string }>>(
    client
      .from('workspaces')
      .select('id, name')
      .like('name', `${SYNTHETIC_WORKSPACE_PREFIX}%`) as PostgrestLike<
      Array<{ id: string; name: string }>
    >,
    'seed-synthetic-corpus.workspaces.synthetic',
  );

  if (dryRun || matched.length === 0) {
    return { matched, dryRun };
  }

  const ids = matched.map((m) => m.id);
  // Questions first (FK on workspace_id), then the workspaces themselves.
  await sb<unknown>(
    client
      .from('form_questions')
      .delete()
      .in('workspace_id', ids) as PostgrestLike<unknown>,
    'seed-synthetic-corpus.form_questions.cleanDelete',
  );
  await sb<unknown>(
    client.from('workspaces').delete().in('id', ids) as PostgrestLike<unknown>,
    'seed-synthetic-corpus.workspaces.cleanDelete',
  );

  return { matched, dryRun };
}

// ── CLI bootstrap ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseCorpusArgs(process.argv.slice(2));

  // Build-time fixture guard — fails loud on a malformed metadata object before
  // touching any credential or DB (the printable intent is provably valid).
  validateSyntheticMetadata();

  const resolved = resolveTarget(args.target, process.env);
  const client = createScriptClient(resolved.url, resolved.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as CorpusDbClient;

  // ── --emit-manifest: read-only; resolve the forms workspace + emit manifest. ──
  if (args.emitManifest) {
    const formsWorkspaceId = await resolveFormsWorkspaceId(client);
    const manifest = buildManifest(formsWorkspaceId);
    const json = JSON.stringify(manifest, null, 2);
    if (args.manifestOut) {
      writeFileSync(args.manifestOut, `${json}\n`);
      console.log(
        `📝 Wrote .kh-workspace-map.json → ${args.manifestOut} ` +
          `(forms/procurement/ → ${formsWorkspaceId})`,
      );
    } else {
      console.log(json);
    }
    return;
  }

  console.log(
    `🌱 Synthetic procurement corpus → ${resolved.target} ` +
      `(${resolved.projectRef})` +
      (args.clean ? ' [CLEAN]' : '') +
      (args.dryRun ? ' [dry-run — no writes]' : ' [LIVE --apply]'),
  );

  // ── --clean: remove the corpus. ──
  if (args.clean) {
    const result = await cleanSyntheticCorpus(client, args.dryRun);
    for (const m of result.matched) {
      console.log(`  ${args.dryRun ? '·' : '🧹'} ${m.name} (${m.id})`);
    }
    console.log(
      args.dryRun
        ? `✅ ${result.matched.length} synthetic workspace(s) would be removed (+ their questions).`
        : `✅ Removed ${result.matched.length} synthetic workspace(s) + their questions.`,
    );
    return;
  }

  // ── Seed: workspaces, then questions. ──
  const wsResults = await seedSyntheticWorkspaces(client, args.dryRun);
  for (const r of wsResults) {
    const icon =
      r.action === 'created' ? '✨' : r.action === 'would-create' ? '·' : '➖';
    console.log(`  ${icon} ${r.name} → ${r.action}`);
  }

  const qResults = await seedSyntheticQuestions(client, wsResults, args.dryRun);
  const qCreated = qResults.reduce((n, q) => n + q.created, 0);
  const qExists = qResults.reduce((n, q) => n + q.alreadyExists, 0);
  const qWould = qResults.reduce((n, q) => n + q.wouldCreate, 0);
  console.log(
    `  questions: ${qCreated} created, ${qExists} already present, ${qWould} would-create.`,
  );

  console.log(
    `✅ workspaces: ${wsResults.filter((r) => r.action === 'created').length} created, ` +
      `${wsResults.filter((r) => r.action === 'would-create').length} would-create, ` +
      `${wsResults.filter((r) => r.action === 'already-exists').length} already present.`,
  );
}

// Run only when invoked directly (never on import — tests import the functions).
if (
  typeof process !== 'undefined' &&
  process.argv[1] &&
  process.argv[1].endsWith('seed-synthetic-corpus.ts')
) {
  main().catch((err) => {
    console.error(
      err instanceof Error ? (err.stack ?? err.message) : String(err),
    );
    process.exitCode = 1;
  });
}
