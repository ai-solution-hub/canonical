#!/usr/bin/env bun
/**
 * One-shot renderer for S69 WP1 — T1-T6 retro Task records.
 *
 * Emits 6 JSON files under $TMPDIR/s69-retro-tasks/, one per Task.
 * Each file contains:
 *   { task: <full Task object>, task_id: "NN" }
 *
 * Orchestrator reads each, splices into task-list.json + umbrellas.json,
 * commits per Task (PRODUCT inv 17 commit-coupling).
 *
 * Per PRODUCT P-OQ-4 A2 EXPANDED: NO T0 retro Task.
 * Per PRODUCT inv 11-12: Subtasks per shipping cadence; each Subtask carries a
 * <info added on …> journal block via formatRetrospectiveJournalBlock helper.
 */

import { formatRetrospectiveJournalBlock } from '../lib/validation/umbrellas-helpers';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

interface SubtaskInput {
  id: number;
  title: string;
  description: string;
  testStrategy: string;
  block: {
    original_session: string;
    original_branch: string;
    continuation_prompt_path: string;
    commits: Array<{ sha8: string; message_line: string }>;
    migration_files?: string[];
    plan_md_section: string;
    followup_flags?: string[];
  };
}

interface RetroTaskInput {
  task_id: string;
  t_label: string;
  title: string;
  description: string;
  plan_md_section: string;
  commit_refs: string[];
  session_refs: string[];
  subtasks: SubtaskInput[];
}

const UMBRELLA_ID = 'canonical-pipeline';
const SESSION = 'kh-prod-readiness-S69';

const PROMPT_PATH_PRE_S62 =
  'docs/continuation-prompts/.archive/pre-s62/.placeholder';
const PROMPT_MAIN_S242 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s242.md';
const PROMPT_MAIN_S246 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s246.md';
const PROMPT_MAIN_S247 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s247.md';
const PROMPT_MAIN_S248 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s248.md';
const PROMPT_MAIN_S249 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s249.md';
const PROMPT_MAIN_S250 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s250.md';
const PROMPT_MAIN_S251 =
  'docs/continuation-prompts/.archive/main-track/continuation-prompt-kh-s251.md';

const PLAN_PATH = 'docs/specs/canonical-pipeline-implementation-plan/PLAN.md';

const RETROS: RetroTaskInput[] = [
  // ────────────────────────────────────────────────────────────────────
  // T1 — Gating spec drafting (PLAN §4.1)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '36',
    t_label: 'T1',
    title: 'T1 — Gating spec drafting (Q-EX2 + cocoindex ledger + Q1.3-Q1.N)',
    description:
      'Three independent specs drafted ahead of pipeline implementation: cocoindex-extraction-contract (Q-EX2 Pydantic discriminated union for ExtractByLlm), cocoindex-ledger-api (TS API over per-flow-run ledger), and content-model-invariants (Q1.3-Q1.N extension). All three landed on main S242 with verifier reports. Implementation tasks T8 (cocoindex flow) and T10 (question_matches) consume these specs.',
    plan_md_section: '4.1',
    commit_refs: ['85c71b38', '1b086b56', 'c6091e96', 'f324fe93'],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S242'],
    subtasks: [
      {
        id: 1,
        title: 'cocoindex-extraction-contract PRODUCT + TECH drafting',
        description:
          'Q-EX2 discriminated-union spec pair for ExtractByLlm typed output (extracted Q&A vs entity mention vs classification).',
        testStrategy:
          'Spec files exist at docs/specs/cocoindex-extraction-contract/{PRODUCT,TECH}.md with verifier report.',
        block: {
          original_session: 'S242',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S242,
          commits: [
            {
              sha8: '85c71b38',
              message_line:
                'docs(spec): cocoindex-extraction-contract — S242 W3 fix-pass',
            },
            {
              sha8: '935354a3',
              message_line:
                'docs(verify): cocoindex-extraction-contract verifier report — S242 WP1.1',
            },
          ],
          plan_md_section: '4.1',
        },
      },
      {
        id: 2,
        title: 'cocoindex-ledger-api TECH drafting',
        description:
          'TS-facing API over cocoindex per-flow-run ledger; partial-resolve framing per 02-data-flow.md §7.2.',
        testStrategy:
          'Spec file exists at docs/specs/cocoindex-ledger-api/TECH.md with verifier report.',
        block: {
          original_session: 'S242',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S242,
          commits: [
            {
              sha8: '1b086b56',
              message_line:
                'docs(spec): cocoindex-ledger-api TECH — S242 W3 fix-pass per verifier findings',
            },
            {
              sha8: '096fbef5',
              message_line:
                'docs(verify): cocoindex-ledger-api verifier report — S242 WP1.2',
            },
          ],
          plan_md_section: '4.1',
          followup_flags: [
            'Cocoindex ledger API surface DEFERRED-v1.1 per S243 Item 11 ratification — v1 ships only pipeline_runs rollup.',
          ],
        },
      },
      {
        id: 3,
        title: 'content-model-invariants PRODUCT drafting (Q1.3-Q1.N)',
        description:
          'Q1.3-Q1.N content-model invariants beyond P-1 + P-2 (content_items row shape post-ingest, chunking-boundary invariants, field population rules).',
        testStrategy:
          'Spec file exists at docs/specs/content-model-invariants/PRODUCT.md.',
        block: {
          original_session: 'S242',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S242,
          commits: [
            {
              sha8: 'c6091e96',
              message_line:
                'docs(spec): content-model-invariants PRODUCT — S242 T1.4',
            },
            {
              sha8: 'f324fe93',
              message_line:
                'docs(spec): content-model-invariants PRODUCT — S242 W3 fix-pass per verifier findings',
            },
          ],
          plan_md_section: '4.1',
        },
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────
  // T2 — Q-OQR1-16 combined PR migration (PLAN §4.2)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '37',
    t_label: 'T2',
    title: 'T2 — Q-OQR1-16 combined PR migration (10-item canonical + 5 reserved seats)',
    description:
      'Single migration landing 10 Q-OQR1-16 items + 5 reserved satellite seats + intelligence_workspaces Shape B promotion + form_type 3-tier split. WP2a helper-first hybrid (S245); WP2b combined SQL drafting + staging apply (S246); WP2c production apply with sync_bid_status trigger drop inline (S247). Helper-swap pattern preserves CI green during transition (JSONB read → typed-column JOIN read).',
    plan_md_section: '4.2',
    commit_refs: ['38242fef', '2f98c8cf'],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S245', 'kh-main-S246', 'kh-main-S247'],
    subtasks: [
      {
        id: 1,
        title: 'WP2a pre-T2 helper + 23-site code sweep',
        description:
          'lib/intelligence/workspace-context.ts ships getIntelligenceWorkspaceContext() + extractContextFromDomainMetadata() reading JSONB (behaviour-preserving). 23 read sites migrated; IntelligenceWorkspace interface migrated to typed top-level.',
        testStrategy:
          'CI green pre-migration; verifier sub-agent PASS; UI smoke validated end-to-end against staging.',
        block: {
          original_session: 'S245',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S246,
          commits: [
            {
              sha8: 'f6a13f4e',
              message_line:
                'feat(s245-wp2a): intelligence workspace-context helper + 23-site read-path migration',
            },
            {
              sha8: 'c8cf4e8f',
              message_line:
                'feat(s245-wp2a): IntelligenceWorkspace typed top-level interface + fixture alignment',
            },
          ],
          plan_md_section: '4.2',
          followup_flags: [
            'scripts/batch-rescore-articles.ts:157-158 deferred with TODO(T2-followup) per spec.',
          ],
        },
      },
      {
        id: 2,
        title: 'WP2b combined PR T2 migration drafting + staging apply',
        description:
          '10 Q-OQR1-16 items + 5 reserved seats + Shape B promotion + form_type 3-tier split rolled into single migration. Staging apply via supabase db push; NOTICEs verified clean (env-agnostic invariants 0/0/0/0 + 96/96 crosswalk + entity_aliases 24/24 + 6 application_types + 6 reserved seats + 8 form_types + 3 procurement_vehicles).',
        testStrategy:
          'Migration applies to staging cleanly; types regen byte-identical; full bun run test PASS post-migration.',
        block: {
          original_session: 'S246',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S246,
          commits: [
            {
              sha8: '38242fef',
              message_line:
                'feat(s246-wp2b): T2 migration + intel helper/route swap to satellite',
            },
          ],
          migration_files: [
            'supabase/migrations/20260515*_q_oqr1_16_combined_pr.sql',
          ],
          plan_md_section: '4.2',
        },
      },
      {
        id: 3,
        title: 'WP2c production apply + sync_bid_status trigger drop',
        description:
          'Production apply hit `record "new" has no field "type"` SQLSTATE 42703 on first attempt — staging-apply S246 bypassed because greenfield 0 intel rows w/ JSONB keys; prod has 3 such rows. Audit confirmed no prod path writes workspaces.status for bid workspaces — trigger was dead-code. Re-applied clean; staging trigger drop applied manually via MCP for state parity.',
        testStrategy:
          'Prod migration applies clean; env-agnostic invariants 4/3/2/0 + 96/96 + 24/24 + 6/6/8/3 verified; types regen byte-identical to staging-generated.',
        block: {
          original_session: 'S247',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S247,
          commits: [
            {
              sha8: '2f98c8cf',
              message_line:
                'fix(s247-wp1): drop sync_bid_status trigger inline in T2 migration',
            },
          ],
          plan_md_section: '4.2',
          followup_flags: [
            'Recurring gotcha: schema-parity validation against staging must include trigger inventory not just table DDL.',
          ],
        },
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────
  // T3 — RLS-pattern combined migration apply (PLAN §4.3)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '38',
    t_label: 'T3',
    title: 'T3 — RLS-pattern combined migration apply + observability validation',
    description:
      'Apply enable_rls_auto_event_trigger_and_grants_pattern migration to staging then production per RLS-PATTERN T-3. Validates RLS-PATTERN P-1..P-5 invariants. P-5 observability via RAISE LOG shipping per S240 ratification (option (c)). DONE-S239; verified S243.',
    plan_md_section: '4.3',
    commit_refs: ['8e1a25af'],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S239', 'kh-main-S243'],
    subtasks: [
      {
        id: 1,
        title: 'RLS-pattern PRODUCT + TECH spec drafting',
        description:
          'Spec pair authored covering auto-enable event trigger, grant_standard_public_table_access helper, P-1..P-5 invariants, fail-loud Data API on missing grants.',
        testStrategy:
          'Spec files exist at docs/specs/rls-pattern/{PRODUCT,TECH}.md.',
        block: {
          original_session: 'S239',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_PATH_PRE_S62,
          commits: [
            {
              sha8: '8e1a25af',
              message_line:
                'docs(spec): docs/specs/rls-pattern/{PRODUCT,TECH}.md — NEW',
            },
          ],
          plan_md_section: '4.3',
        },
      },
      {
        id: 2,
        title: 'RLS-pattern migration apply to staging + production',
        description:
          'Migration 20260514150238_enable_rls_auto_event_trigger_and_grants_pattern.sql applied to staging then prod. pg_event_trigger shows ensure_rls; CREATE TABLE auto-enables RLS; grant_standard_public_table_access callable. Negative-case test (CREATE table WITHOUT grants helper → PostgREST returns 42501 permission denied) verified per implementation-readiness audit P4.',
        testStrategy:
          'RLS-PATTERN T-1 + T-2 + T-3 validation tests PASS on both envs; SCHEMA-QUICK-REFERENCE.md §32 updated; skip-doc-freshness marker dropped.',
        block: {
          original_session: 'S239',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_PATH_PRE_S62,
          commits: [
            {
              sha8: 'aa417aab',
              message_line:
                'docs(plan): mark PLAN.md §8 Wave 1 T3 DONE-S239 (verified S243)',
            },
          ],
          migration_files: [
            'supabase/migrations/20260514150238_enable_rls_auto_event_trigger_and_grants_pattern.sql',
          ],
          plan_md_section: '4.3',
          followup_flags: [
            'Gap C2 (implementation-readiness audit P9): pre-existing public-schema tables created BEFORE trigger applies do NOT retroactively get RLS — per-table audit + decide enable-or-document.',
          ],
        },
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────
  // T4 — Procurement umbrella rename (PLAN §4.4)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '39',
    t_label: 'T4',
    title: 'T4 — Procurement umbrella rename (lib/bid → lib/procurement + state machine + 44-file sweep)',
    description:
      'P-42 procurement rename code-side: lib/bid → lib/procurement; BID_STATES → PROCUREMENT_WORKFLOW_STATES; components/bid → components/procurement; MCP tool names per 06-mcp-tooling.md §6.3; 44-file sweep for project_id → workspace_id; CI regression guard. Shipped S248 over 4 atomic commits.',
    plan_md_section: '4.4',
    commit_refs: ['2105404f', '99dfc5fd', '51b6cc8c', 'c0515339'],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S248'],
    subtasks: [
      {
        id: 1,
        title: 'lib/bid → lib/procurement directory rename',
        description:
          'git mv preserving history; lib/bid/bid-state-machine.ts → lib/procurement/procurement-workflow.ts; imports updated codebase-wide.',
        testStrategy:
          '`grep -rn "lib/bid" lib/ scripts/ app/ components/` returns zero hits; bun run test full regression PASS.',
        block: {
          original_session: 'S248',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S248,
          commits: [
            {
              sha8: '2105404f',
              message_line:
                'refactor(s248-wp2-t4): rename lib/bid → lib/procurement (paths + imports)',
            },
          ],
          plan_md_section: '4.4',
        },
      },
      {
        id: 2,
        title: 'Symbol + DB string + URL path + MCP tool renames',
        description:
          'BID_STATES → PROCUREMENT_WORKFLOW_STATES; types/bid.ts → types/procurement.ts; components/bid → components/procurement; MCP tool list_active_bids → list_active_procurement per 06-mcp-tooling.md §6.3.',
        testStrategy:
          '`grep -rn "BID_STATES\\|bid_workspaces" lib/ types/ components/` returns zero hits; state machine moved + tested.',
        block: {
          original_session: 'S248',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S248,
          commits: [
            {
              sha8: '99dfc5fd',
              message_line:
                'refactor(s248-wp2-t4): rename Bid* symbols + DB strings + URL paths + MCP tools',
            },
          ],
          plan_md_section: '4.4',
        },
      },
      {
        id: 3,
        title: 'project_id → workspace_id 44-file sweep + dead-code + CI guard',
        description:
          'Per Q5.5 sweep across 44 files (lib/, scripts/, app/, components/, __tests__/); dead-code removed; CI guard added preventing bid regressions per TECH.md P-40 validation.',
        testStrategy:
          '`grep -rn "project_id" lib/ scripts/ app/ components/` returns zero hits; CI guard test PASS.',
        block: {
          original_session: 'S248',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S248,
          commits: [
            {
              sha8: '51b6cc8c',
              message_line:
                'refactor(s248-wp2-t4): project_id → workspace_id sweep + dead-code + CI guard',
            },
          ],
          plan_md_section: '4.4',
        },
      },
      {
        id: 4,
        title: 'Prettier format pass on rename-touched files',
        description:
          'Format pass closes the wave; bun run knip shows no orphaned lib/bid/* files; full regression PASS.',
        testStrategy:
          'bun run format:check clean; bun run knip clean (or baseline acknowledged); bun run test full regression PASS.',
        block: {
          original_session: 'S248',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S248,
          commits: [
            {
              sha8: 'c0515339',
              message_line:
                'style(s248-wp2-t4): prettier format pass on rename-touched files',
            },
          ],
          plan_md_section: '4.4',
        },
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────
  // T5 — digests → change_reports code rename (PLAN §4.5)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '40',
    t_label: 'T5',
    title: 'T5 — digests → change_reports code rename (S248 initial + S251 W1B Phases A-H residual sweep)',
    description:
      'P-41 code-side rename: lib/digest/* → lib/change-reports/*; lib/ai/digest.ts → lib/ai/change-reports.ts; queryKeys; hook internals; types file; component dir; URL paths; DB columns (digest_type → frequency); notifications enum (digest_ready → change_report_ready); plugin marketplace command; ~40 symbol renames + 49 URL literals across ~14 test files. Shipped S248 initial code rename + S251 W1B Phases A-H residual sweep.',
    plan_md_section: '4.5',
    commit_refs: [
      '44ff65c7',
      'af216dc4',
      '03fcfa8f',
      '31fbff30',
      'f74eb3cc',
      'd9d42c86',
      'e15febb3',
      '61ea6dd9',
      '45317dc6',
      'd9be817b',
      '80e1bded',
      '2cb8064a',
    ],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S248', 'kh-main-S251'],
    subtasks: [
      {
        id: 1,
        title: 'S248 initial code rename (lib/digest → lib/change-reports)',
        description:
          'lib/digest/* → lib/change-reports/*; lib/ai/digest.ts → lib/ai/change-reports.ts; queryKeys + hook internals updated; scripts/export-user-data DB ref updated.',
        testStrategy:
          'bun run test full regression PASS; symbol-level grep clean for digest in renamed surface.',
        block: {
          original_session: 'S248',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S248,
          commits: [
            {
              sha8: '44ff65c7',
              message_line:
                'refactor(s248-wp3-t5): digests → change_reports code rename (PLAN.md §4.5)',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 2,
        title: 'S251 W1B Phases B+C — symbol renames + URL string-literal sweep',
        description:
          'Symbol-level renames across app/api/digest/* → app/api/change-reports/*; URL string literals updated; partial sweep with Phase A-fix follow-up for residual.',
        testStrategy:
          'Symbol grep clean; URL grep clean.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: 'af216dc4',
              message_line:
                'chore(s251-w1b-a): phases B+C — symbol renames + URL string-literal sweep (partial)',
            },
            {
              sha8: '03fcfa8f',
              message_line:
                'chore(s251-w1b-a-fix): complete Phase B/C residual sweep + ast-dataflow doc-string updates',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 3,
        title: 'S251 W1B Phase D — DB column + notifications enum + theme_clusters elimination',
        description:
          'digest_type → frequency column; notifications enum digest_ready → change_report_ready + entity_type "digest" → "change_report"; ThemeCluster + theme_clusters elimination as IMS-fork legacy.',
        testStrategy:
          'Migration applies clean; notifications query returns new enum values.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: '31fbff30',
              message_line:
                'chore(s251-w1b-d): phase D — digest_type→frequency + digest_ready→change_report_ready + theme_clusters elimination',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 4,
        title: 'S251 W1B Phase E — migration file + types regen (staging + prod)',
        description:
          'Migration authored (NOT applied by author; orchestrator applies CLI staging then prod). database.types.ts regen post-migration apply.',
        testStrategy:
          'Migration applies clean to staging + prod; types regen byte-identical.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: 'f74eb3cc',
              message_line:
                'chore(s251-w1b-e): phase E — migration file authored (NOT applied; orchestrator applies CLI staging then prod)',
            },
            {
              sha8: 'd9d42c86',
              message_line:
                'chore(s251-w1b-e): regen database.types.ts post-migration apply (staging + prod green)',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 5,
        title: 'S251 W1B Phase F — reference-doc cascade (2 batches)',
        description:
          'CLAUDE.md + SCHEMA-QUICK-REFERENCE.md cascade (batch 1) + cascade across reference + product-functionality + ast-dataflow docs (batch 2).',
        testStrategy:
          'Doc-freshness guard PASS; cross_doc_links clean.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: 'e15febb3',
              message_line:
                'docs(s251-w1b-f): Phase F batch 1 — CLAUDE.md + SCHEMA-QUICK-REFERENCE.md cascade',
            },
            {
              sha8: '61ea6dd9',
              message_line:
                'docs(s251-w1b-f): Phase F batch 2 — cascade digest→change-reports across reference + product-functionality + ast-dataflow docs',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 6,
        title: 'S251 W1B Phase G — verification fixes + stats regen',
        description:
          'Phase G verification surface fixes; codebase stats regen post-rename.',
        testStrategy:
          'docs/generated/codebase-stats.md regen byte-identical; verification axes PASS.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: '45317dc6',
              message_line:
                'chore(s251-w1b-g): Phase G verification fixes + stats regen',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 7,
        title: 'S251 W1B Phase H — vercel.json + plugin marketplace + skill/check files',
        description:
          'vercel.json glob + ast-dataflow doc-strings + skill/check files; plugin marketplace /kb:digest → /kb:change-report + bundle regen.',
        testStrategy:
          'Plugin bundle byte-identical post-regen; vercel.json cron rename applied.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: 'd9be817b',
              message_line:
                'chore(s251-w1b-h): phase H — vercel.json glob + ast-dataflow doc-strings + skill/check files',
            },
            {
              sha8: '80e1bded',
              message_line:
                'chore(s251-w1b-h): plugin marketplace command rename + bundle regen',
            },
          ],
          plan_md_section: '4.5',
        },
      },
      {
        id: 8,
        title: 'S251 W1B Phase F+G closure — final residual sweep',
        description:
          'Final residual sweep: ontology + PLAN.md T5 closure + ast-dataflow CLI + misc. CLAUDE.md gotcha + no-digest-import-regression CI guard DELETED per Liam ratification (single-dev repo).',
        testStrategy:
          'PLAN.md §4.5 T5 closure marked SHIPPED; full regression PASS; bun run knip clean.',
        block: {
          original_session: 'S251',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S251,
          commits: [
            {
              sha8: '2cb8064a',
              message_line:
                'docs(s251-w1b-f+g): final residual sweep — ontology, PLAN.md T5 closure, ast-dataflow CLI, misc',
            },
          ],
          plan_md_section: '4.5',
          followup_flags: [
            'CI guard __tests__/validation/no-digest-import-regression.test.ts DELETED per Liam ratification (single-dev repo); regression discipline replaced by knip + grep + lint.',
          ],
        },
      },
    ],
  },
  // ────────────────────────────────────────────────────────────────────
  // T6 — Q&A two-tier model migration + RPCs (PLAN §4.6)
  // ────────────────────────────────────────────────────────────────────
  {
    task_id: '41',
    t_label: 'T6',
    title: 'T6 — Q&A two-tier model migration + RPCs (q_a_pairs + q_a_extractions + q_a_pair_history + q_a_search RPC)',
    description:
      'P-20 Q&A two-tier model: q_a_pairs (corpus-level shape per 05-qa-flow.md §2); q_a_extractions derived cache (§3) — cocoindex UPSERT target compatibility; q_a_pair_history trigger-driven version table (§3.3). q_a_search RPC (separate embedding_score + fulltext_score per N9). Shipped S249 (WP1+WP2+WP3) + S250 W1b followup (anon EXECUTE leak fix via PUBLIC inheritance).',
    plan_md_section: '4.6',
    commit_refs: ['2f3428c7', 'f7ce9754', '6614d8c3', 'a20786f5', '275bc9e5', 'b3a4f792'],
    session_refs: ['kh-prod-readiness-S69', 'kh-main-S249', 'kh-main-S250'],
    subtasks: [
      {
        id: 1,
        title: 'WP1 — q_a_pairs full schema + extractions + history trigger',
        description:
          'q_a_pairs table with full column set (question_text + alternate_question_phrasings + answer_standard/advanced + scope_tag + anti_scope_tag + source_workspace_id NULL + origin_kind + question_embedding vector(1024) + publication_status + superseded_by + valid_from + valid_to). q_a_extractions with extractor_kind enum + promoted_to_pair_id + invalidated_at. q_a_pair_history trigger writes version transitions on UPDATE.',
        testStrategy:
          'Migration applies clean to staging + prod; GIN indexes on scope_tag + anti_scope_tag present; idx_q_a_pairs_workspace explicitly NOT built (RATIFIED-DO-NOT-BUILD per §11 anti-patterns).',
        block: {
          original_session: 'S249',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S249,
          commits: [
            {
              sha8: '2f3428c7',
              message_line:
                'feat(s249-wp1): q_a_pairs full schema + extractions + history trigger (T6.1-3)',
            },
            {
              sha8: 'f7ce9754',
              message_line:
                'chore(s249-wp1): regen database.types.ts post T6 WP1 staging apply',
            },
          ],
          migration_files: [
            'supabase/migrations/20260520225456_t6_q_a_pairs_full_schema.sql',
          ],
          plan_md_section: '4.6',
        },
      },
      {
        id: 2,
        title: 'WP2 — q_a_search + q_a_get_verbatim RPCs',
        description:
          'q_a_search RPC (hybrid embedding + fulltext rank, separate embedding_score + fulltext_score per N9 RESOLVED-S236). q_a_get_verbatim RPC. Both SECURITY DEFINER, REVOKE anon, GRANT authenticated/service_role.',
        testStrategy:
          'RPC signatures present on staging + prod; types regen surfaces both Functions; grants verified.',
        block: {
          original_session: 'S249',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S249,
          commits: [
            {
              sha8: '6614d8c3',
              message_line:
                'feat(s249-wp2): q_a_search + q_a_get_verbatim RPCs (T6.4)',
            },
            {
              sha8: 'a20786f5',
              message_line:
                'chore(s249-wp2): regen database.types.ts post T6 WP2 staging apply',
            },
          ],
          migration_files: [
            'supabase/migrations/20260520231524_t6_q_a_search_rpcs.sql',
          ],
          plan_md_section: '4.6',
        },
      },
      {
        id: 3,
        title: 'WP3 — Integration test for two-step retrieval pattern',
        description:
          'Integration test covering q_a_search separate-score columns + q_a_get_verbatim embedding-exclusion + history-trigger version transitions + CASCADE delete.',
        testStrategy:
          '4 integration tests PASS against staging w/ KH_RUN_INTEGRATION=1.',
        block: {
          original_session: 'S249',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S249,
          commits: [
            {
              sha8: '275bc9e5',
              message_line:
                'test(s249-wp3): integration test for q_a_pairs two-step retrieval + history trigger (T6.7)',
            },
          ],
          plan_md_section: '4.6',
        },
      },
      {
        id: 4,
        title: 'S250 W1b followup — anon EXECUTE leak via PUBLIC inheritance fix',
        description:
          'Discovered during S250 W1 acceptance audit: REVOKE EXECUTE FROM anon does not block anon access because Postgres PUBLIC inherits EXECUTE on functions by default. Fix REVOKEs EXECUTE FROM PUBLIC before re-granting to specific roles. Applied to BOTH staging + prod via CLI db push.',
        testStrategy:
          'Prod smoke green (insert → UPDATE → history trigger → q_a_get_verbatim → CASCADE cleanup); types regen byte-identical post-W1b.',
        block: {
          original_session: 'S250',
          original_branch: 'content-items-investigation',
          continuation_prompt_path: PROMPT_MAIN_S250,
          commits: [
            {
              sha8: 'b3a4f792',
              message_line:
                'fix(s250-wp1b): T6 anon EXECUTE leak via PUBLIC inheritance + CLAUDE.md gotcha refinement',
            },
          ],
          migration_files: [
            'supabase/migrations/20260521095209_t6_followup_revoke_public_execute_anon_inherit_fix.sql',
          ],
          plan_md_section: '4.6',
          followup_flags: [
            'CLAUDE.md gotcha added: REVOKE EXECUTE FROM anon insufficient on Supabase — must REVOKE FROM PUBLIC first.',
          ],
        },
      },
    ],
  },
];

// ────────────────────────────────────────────────────────────────────
// Render + emit
// ────────────────────────────────────────────────────────────────────

const OUT_DIR = join(process.env.TMPDIR ?? '/tmp', 's69-retro-tasks');
mkdirSync(OUT_DIR, { recursive: true });

// DocLinkSchema (lib/validation/roadmap-schema.ts) is `.strict()`:
// {path, anchor, raw} — no `type` or `section`.

for (const retro of RETROS) {
  const subtasks = retro.subtasks.map((s) => {
    const journal = formatRetrospectiveJournalBlock({
      retro_open_session: SESSION,
      original_session: s.block.original_session,
      original_branch: s.block.original_branch,
      continuation_prompt_path: s.block.continuation_prompt_path,
      commits: s.block.commits,
      migration_files: s.block.migration_files,
      plan_md_section: s.block.plan_md_section,
      followup_flags: s.block.followup_flags,
      umbrella_id: UMBRELLA_ID,
    });

    return {
      id: s.id,
      title: s.title,
      description: s.description,
      details: journal,
      status: 'done',
      dependencies: [],
      testStrategy: s.testStrategy,
    };
  });

  const task = {
    id: retro.task_id,
    title: retro.title,
    description: retro.description,
    status: 'done',
    priority: 'must',
    dependencies: [],
    subtasks,
    updatedAt: new Date().toISOString(),
    effort_estimate: null,
    owner: null,
    priority_note: null,
    status_note: `Retrospective Task — work shipped main-track per PLAN.md ${retro.plan_md_section}`,
    capability_theme: null,
    cross_doc_links: [
      {
        path: PLAN_PATH,
        anchor: `§${retro.plan_md_section}`,
        raw: `PLAN.md §${retro.plan_md_section} ${retro.t_label} acceptance criteria substrate`,
      },
    ],
    session_refs: retro.session_refs,
    commit_refs: retro.commit_refs,
  };

  const outFile = join(OUT_DIR, `${retro.task_id}-${retro.t_label}.json`);
  writeFileSync(outFile, JSON.stringify(task, null, 2) + '\n', 'utf8');
  console.log(`wrote ${outFile} (${task.title})`);
}

console.log(`\nAll 6 retro Tasks rendered to ${OUT_DIR}`);
console.log(`Total Subtasks: ${RETROS.reduce((a, r) => a + r.subtasks.length, 0)}`);
