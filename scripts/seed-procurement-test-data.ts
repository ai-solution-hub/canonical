#!/usr/bin/env bun
/**
 * Seed realistic procurement test data for manual and automated testing.
 *
 * Creates a test bid workspace with Standard Selection Questionnaire-style
 * questions across multiple sections, plus some draft responses. Idempotent:
 * checks for existing test bid before creating.
 *
 * `--reset` (bl-361): globally wipe ALL form_responses + form_response_history
 * (every workspace) then re-seed a fresh fixture. Folded from the retired
 * scripts/wipe-procurement-responses.ts — destructive, so it carries the same
 * --env fail-fast + prod confirmation + 5s safety delay as the original.
 *
 * Usage:
 *   bun run scripts/seed-procurement-test-data.ts                        # create test bid
 *   bun run scripts/seed-procurement-test-data.ts --dry-run              # preview without writing
 *   bun run scripts/seed-procurement-test-data.ts --clean                # remove existing test bid first
 *   bun run scripts/seed-procurement-test-data.ts --reset --env=staging  # global wipe + fresh seed (staging)
 *   bun run scripts/seed-procurement-test-data.ts --reset --env=prod     # global wipe + fresh seed (prod, interactive confirm)
 */

import {
  createScriptClient,
  createLooseScriptClient,
} from '@/scripts/lib/supabase-script-client';
import { prodProjectRef, stagingProjectRef } from '@/scripts/lib/project-refs';
import { parseArgs } from 'util';
import { createInterface } from 'readline';
import path from 'path';
import fs from 'fs';

// ── Env loading (handles worktrees) ────────────────────────────────────────

function loadEnv() {
  let dir = process.cwd();
  while (dir !== '/') {
    for (const file of ['.env.local', '.env']) {
      const p = path.join(dir, file);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq === -1) continue;
          const key = trimmed.slice(0, eq).trim();
          let value = trimmed.slice(eq + 1).trim();
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
      }
    }
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── CLI args ───────────────────────────────────────────────────────────────

const { values } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    clean: { type: 'boolean', default: false },
    reset: { type: 'boolean', default: false },
    env: { type: 'string', default: '' },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`
Seed realistic procurement test data for testing.

Usage:
  bun run scripts/seed-procurement-test-data.ts                        # create test bid
  bun run scripts/seed-procurement-test-data.ts --dry-run              # preview without writing
  bun run scripts/seed-procurement-test-data.ts --clean                # remove existing test bid first
  bun run scripts/seed-procurement-test-data.ts --reset --env=staging  # global response wipe + fresh seed
  bun run scripts/seed-procurement-test-data.ts --reset --env=prod     # global wipe + fresh seed (interactive confirm)

Options:
  --dry-run   Preview without writing (also previews --reset wipe counts)
  --clean     Remove the existing test bid first
  --reset     Globally wipe ALL form responses + history, then re-seed (requires --env)
  --env       <staging|prod> target assertion for --reset (fail-fast if URL mismatch)
  --yes       Skip the 5-second safety delay before the --reset wipe

Creates:
  - 1 bid workspace (Test Council -- Office Supplies 2026)
  - 10 questions across 4 sections (SQ-style)
  - 3 draft responses for questions with strong posture
`);
  process.exit(0);
}

const dryRun = values['dry-run'] ?? false;
const reset = values.reset ?? false;
// --reset implies a full test-bid clean: the global response wipe below removes
// responses but leaves the workspace + questions, so re-seed must recreate them.
const clean = (values.clean ?? false) || reset;
const envFlag = values.env ?? '';
const skipDelay = values.yes ?? false;

// ── Supabase client ────────────────────────────────────────────────────────

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error(
    'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
  );
  process.exit(1);
}

// Narrowed copies (string, not string | undefined) for use inside the seed +
// reset helpers below — the guard above guarantees both are set.
const SUPABASE_URL: string = supabaseUrl;
const SUPABASE_KEY: string = supabaseKey;

const supabase = createScriptClient(SUPABASE_URL, SUPABASE_KEY);

// ── Reset helpers (folded from the retired wipe-procurement-responses.ts; bl-361) ──

/**
 * Validate the --reset destructive target. --reset globally deletes ALL form
 * responses, so it requires an explicit --env=<staging|prod> that matches the
 * resolved SUPABASE target — the same D-22 fail-fast the standalone wipe script
 * enforced. FAILS FAST otherwise (the env flag does NOT swap env values; it only
 * ASSERTS the env-resolved URL points at the expected project).
 */
function assertResetEnv(): void {
  if (envFlag !== 'staging' && envFlag !== 'prod') {
    console.error(
      'ERROR: --reset requires --env=<staging|prod>. It globally wipes ALL form\n' +
        'responses; refusing to run without an explicit env flag to prevent\n' +
        'accidental destruction.\n\n' +
        'Examples:\n' +
        '  bun run scripts/seed-procurement-test-data.ts --reset --env=staging\n' +
        '  bun run scripts/seed-procurement-test-data.ts --reset --env=prod   # interactive confirm\n',
    );
    process.exit(1);
  }
  if (envFlag === 'staging' && !SUPABASE_URL.includes(stagingProjectRef())) {
    console.error(
      `ERROR: --env=staging set but the resolved Supabase URL does not include '${stagingProjectRef()}'.\n` +
        `Current target: ${SUPABASE_URL}`,
    );
    process.exit(1);
  }
  if (envFlag === 'prod' && !SUPABASE_URL.includes(prodProjectRef())) {
    console.error(
      `ERROR: --env=prod set but the resolved Supabase URL does not include '${prodProjectRef()}'.\n` +
        `Current target: ${SUPABASE_URL}`,
    );
    process.exit(1);
  }
}

/**
 * For --reset --env=prod, require the operator to type "wipe prod" verbatim
 * before any destructive call. Anything else exits 0 (cancelled). Skipped in
 * dry-run (no destructive side effects).
 */
async function confirmProdWipe(): Promise<void> {
  if (dryRun) return;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question(
      'WARNING: Wiping prod form_responses. Type "wipe prod" to confirm: ',
      (input) => {
        rl.close();
        resolveAnswer(input);
      },
    );
  });
  if (answer.trim() !== 'wipe prod') {
    console.error('Confirmation phrase did not match. Aborting.');
    process.exit(0);
  }
}

async function countRows(
  client: ReturnType<typeof createLooseScriptClient>,
  table: string,
): Promise<number> {
  const { count, error } = await client
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) {
    console.error(`ERROR counting ${table}: ${error.message}`);
    process.exit(1);
  }
  return count ?? 0;
}

/**
 * Globally delete ALL form_response_history then form_responses (FK order).
 * Both FKs are ON DELETE CASCADE, but explicit ordering gives accurate counts
 * and is defensive against schema changes. Respects --dry-run (preview only)
 * and the --yes-skippable 5s safety delay.
 */
async function globalWipeResponses(
  client: ReturnType<typeof createLooseScriptClient>,
): Promise<void> {
  const historyCount = await countRows(client, 'form_response_history');
  const responseCount = await countRows(client, 'form_responses');
  console.log(`form_response_history: ${historyCount} rows`);
  console.log(`form_responses: ${responseCount} rows`);

  if (historyCount + responseCount === 0) {
    console.log('No existing responses to wipe.\n');
    return;
  }
  if (dryRun) {
    console.log(
      `[DRY RUN] Would delete ${historyCount} history rows, ${responseCount} responses.\n`,
    );
    return;
  }
  if (!skipDelay) {
    console.log(
      'WARNING: About to delete ALL form responses. Press Ctrl-C to abort (5s)...',
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  // 1. form_response_history first (supabase-js v2 requires a filter on delete;
  //    use a tautological created_at filter).
  const { error: histError } = await client
    .from('form_response_history')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();
  if (histError) {
    console.error(`ERROR deleting form_response_history: ${histError.message}`);
    console.error(
      'form_responses were NOT deleted. Partial state: history deletion may have partially completed.',
    );
    process.exit(1);
  }

  // 2. form_responses (cascades citations via FK).
  const { error: respError } = await client
    .from('form_responses')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();
  if (respError) {
    console.error(`ERROR deleting form_responses: ${respError.message}`);
    console.error(
      'form_response_history was already deleted. Manual cleanup may be needed.',
    );
    process.exit(1);
  }

  console.log(
    `Deleted ${historyCount} history rows, ${responseCount} responses.\n`,
  );
}

// ── Test data constants ────────────────────────────────────────────────────

const TEST_BID_NAME = '[TEST] Test Council -- Office Supplies 2026';
const TEST_BID_BUYER = 'Test Borough Council';
const TEST_BID_REFERENCE = 'TBC/2026/OS/001';

// Deadline 30 days from now
const deadline = new Date();
deadline.setDate(deadline.getDate() + 30);
const TEST_BID_DEADLINE = deadline.toISOString().split('T')[0];

/**
 * Realistic SQ-style questions grouped by section, modelled on the
 * Standard Selection Questionnaire (PPN 03/24) structure.
 */
const TEST_QUESTIONS: Array<{
  section_name: string;
  section_sequence: number;
  question_text: string;
  question_sequence: number;
  word_limit: number | null;
  evaluation_weight: number | null;
}> = [
  // Section 1: Economic and Financial Standing
  {
    section_name: 'Economic and Financial Standing',
    section_sequence: 1,
    question_text:
      'Please provide your most recent annual turnover figure and confirm it exceeds the minimum threshold of \u00a3500,000 for the last two financial years.',
    question_sequence: 1,
    word_limit: 200,
    evaluation_weight: null,
  },
  {
    section_name: 'Economic and Financial Standing',
    section_sequence: 1,
    question_text:
      'Please provide details of your professional indemnity insurance and employers\u2019 liability insurance, including the level of cover and expiry dates.',
    question_sequence: 2,
    word_limit: 300,
    evaluation_weight: null,
  },
  // Section 2: Technical and Professional Ability
  {
    section_name: 'Technical and Professional Ability',
    section_sequence: 2,
    question_text:
      'Please provide two examples of contracts you have delivered in the last three years that are similar in scope and scale to this requirement. Include the client name, contract value, duration, and a brief description of the services provided.',
    question_sequence: 3,
    word_limit: 500,
    evaluation_weight: 25,
  },
  {
    section_name: 'Technical and Professional Ability',
    section_sequence: 2,
    question_text:
      'Describe your approach to quality management, including any relevant accreditations (e.g. ISO 9001) and how you monitor and improve service quality.',
    question_sequence: 4,
    word_limit: 400,
    evaluation_weight: 15,
  },
  {
    section_name: 'Technical and Professional Ability',
    section_sequence: 2,
    question_text:
      'Describe your organisation\u2019s approach to environmental management. Include details of any environmental management system, accreditations (e.g. ISO 14001), and specific measures you take to minimise environmental impact.',
    question_sequence: 5,
    word_limit: 400,
    evaluation_weight: 10,
  },
  // Section 3: Health and Safety
  {
    section_name: 'Health and Safety',
    section_sequence: 3,
    question_text:
      'What health and safety accreditations does your organisation hold? Please provide details of your health and safety management system and any relevant certifications.',
    question_sequence: 6,
    word_limit: 300,
    evaluation_weight: 10,
  },
  {
    section_name: 'Health and Safety',
    section_sequence: 3,
    question_text:
      'Provide your organisation\u2019s health and safety incident record for the past three years, including the number of RIDDOR-reportable incidents and any enforcement actions taken by the HSE.',
    question_sequence: 7,
    word_limit: 250,
    evaluation_weight: null,
  },
  // Section 4: Data Protection and Modern Slavery
  {
    section_name: 'Data Protection and Modern Slavery',
    section_sequence: 4,
    question_text:
      'Describe your approach to data protection and GDPR compliance. Include details of your Data Protection Officer, data processing agreements, and how you handle data breaches.',
    question_sequence: 8,
    word_limit: 400,
    evaluation_weight: 15,
  },
  {
    section_name: 'Data Protection and Modern Slavery',
    section_sequence: 4,
    question_text:
      'Confirm whether your organisation is required to produce a Modern Slavery Statement under the Modern Slavery Act 2015. If so, please provide a link to your most recent statement or describe the steps you take to ensure modern slavery is not taking place in your supply chain.',
    question_sequence: 9,
    word_limit: 300,
    evaluation_weight: null,
  },
  {
    section_name: 'Data Protection and Modern Slavery',
    section_sequence: 4,
    question_text:
      'Describe your organisation\u2019s business continuity arrangements, including how you would maintain service delivery in the event of a significant disruption.',
    question_sequence: 10,
    word_limit: 400,
    evaluation_weight: 10,
  },
];

/**
 * Draft responses for a subset of questions (those most likely to have
 * strong KB matches based on existing Q&A library content).
 */
const DRAFT_RESPONSES: Array<{
  /** Index into TEST_QUESTIONS (0-based) */
  questionIndex: number;
  response_text: string;
  review_status: string;
}> = [
  {
    questionIndex: 3, // Quality management
    response_text:
      'Our organisation maintains a comprehensive Quality Management System certified to ISO 9001:2015. ' +
      'We conduct regular internal audits and management reviews to ensure continuous improvement. ' +
      'Our QMS covers all aspects of service delivery including procurement, logistics, customer service, ' +
      'and complaint handling. Key performance indicators are monitored monthly and reported to senior management. ' +
      'We hold regular team briefings to communicate quality objectives and celebrate successes.',
    review_status: 'draft',
  },
  {
    questionIndex: 5, // H&S accreditations
    response_text:
      'We hold the following health and safety accreditations:\n\n' +
      '- CHAS (Contractors Health and Safety Assessment Scheme)\n' +
      '- SafeContractor approved\n' +
      '- IOSH Managing Safely trained management team\n\n' +
      'Our health and safety management system is aligned with ISO 45001 and is subject to annual external audit. ' +
      'All employees receive comprehensive H&S induction training and ongoing refresher training. ' +
      'We maintain a dedicated Health and Safety Manager who reports directly to the Board.',
    review_status: 'draft',
  },
  {
    questionIndex: 7, // Data protection
    response_text:
      'Our organisation is fully committed to GDPR compliance and data protection best practice. ' +
      'We have appointed a Data Protection Officer who oversees all data processing activities. ' +
      'All staff receive annual data protection training. We maintain a comprehensive data processing register ' +
      'and have standard data processing agreements in place with all sub-processors. ' +
      'Our data breach response procedure ensures notification to the ICO within 72 hours where required. ' +
      'We are registered with the Information Commissioner\u2019s Office (registration number: ZA123456).',
    review_status: 'in_review',
  },
];

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('Procurement Test Data Seed Script');
  console.log('========================\n');

  if (dryRun) {
    console.log('[DRY RUN] No data will be written.\n');
  }

  // --reset: globally wipe ALL form responses + history (every workspace),
  // then fall through to a fresh seed. Folded from the retired
  // scripts/wipe-procurement-responses.ts (bl-361). Destructive — gated behind
  // the same --env fail-fast + prod confirm + safety delay as the original.
  if (reset) {
    console.log('Mode: reset (global response wipe + fresh seed)\n');
    assertResetEnv();
    if (envFlag === 'prod') await confirmProdWipe();
    const wipeClient = createLooseScriptClient(SUPABASE_URL, SUPABASE_KEY);
    await globalWipeResponses(wipeClient);
  }

  // Check for existing test bid. Post-T2: discriminator is
  // application_types.key via JOIN; 'bid' → 'procurement'.
  //
  // ID-145 {145.6}/{145.7}: form_questions no longer carries workspace_id
  // (form-first re-architecture, form_questions.form_instance_id is the sole
  // scoping key) — this fixture still separately creates a `workspaces` row
  // (harmless; `workspaces` survives W1, DR-056) AND a `form_instances` row
  // (below), unlinked to each other. The existing-check/cleanup path below
  // therefore looks up BOTH by TEST_BID_NAME independently, rather than
  // resolving the form via the workspace as the old resolve-or-mint RPC did.
  const { data: existing, error: checkError } = await supabase
    .from('workspaces')
    .select('id, name, application_types!inner(key)')
    .eq('name', TEST_BID_NAME)
    .eq('application_types.key', 'procurement')
    .limit(1);

  if (checkError) {
    console.error('Failed to check for existing test bid:', checkError.message);
    process.exit(1);
  }

  const { data: existingForm, error: checkFormError } = await supabase
    .from('form_instances')
    .select('id, name')
    .eq('name', TEST_BID_NAME)
    .limit(1);

  if (checkFormError) {
    console.error(
      'Failed to check for existing test form:',
      checkFormError.message,
    );
    process.exit(1);
  }

  if (
    (existing && existing.length > 0) ||
    (existingForm && existingForm.length > 0)
  ) {
    if (clean) {
      if (existing && existing.length > 0) {
        console.log(`Found existing test bid workspace: ${existing[0].id}`);
      }
      if (existingForm && existingForm.length > 0) {
        console.log(`Found existing test form instance: ${existingForm[0].id}`);
      }
      if (!dryRun) {
        // Delete responses, questions, then the form instance.
        if (existingForm && existingForm.length > 0) {
          const formInstanceId = existingForm[0].id;

          const { data: questions } = await supabase
            .from('form_questions')
            .select('id')
            .eq('form_instance_id', formInstanceId);

          if (questions && questions.length > 0) {
            const qIds = questions.map((q: { id: string }) => q.id);
            const { error: respDelErr } = await supabase
              .from('form_responses')
              .delete()
              .in('question_id', qIds);
            if (respDelErr) {
              console.error(
                'Failed to delete test responses:',
                respDelErr.message,
              );
            }
          }

          const { error: qDelErr } = await supabase
            .from('form_questions')
            .delete()
            .eq('form_instance_id', formInstanceId);
          if (qDelErr) {
            console.error('Failed to delete test questions:', qDelErr.message);
          }

          const { error: formDelErr } = await supabase
            .from('form_instances')
            .delete()
            .eq('id', formInstanceId);
          if (formDelErr) {
            console.error(
              'Failed to delete test form instance:',
              formDelErr.message,
            );
          }
        }

        // Delete the (unlinked) workspace row, if one exists.
        if (existing && existing.length > 0) {
          const { error: procurementDelErr } = await supabase
            .from('workspaces')
            .delete()
            .eq('id', existing[0].id);
          if (procurementDelErr) {
            console.error(
              'Failed to delete test bid workspace:',
              procurementDelErr.message,
            );
          }
        }

        console.log('Cleaned up existing test bid.\n');
      } else {
        console.log('[DRY RUN] Would delete existing test bid.\n');
      }
    } else {
      console.log(
        `Test bid already exists ` +
          `(workspace: ${existing?.[0]?.id ?? 'none'}, form: ${existingForm?.[0]?.id ?? 'none'})\n` +
          'Use --clean to remove it first, or it will be left as-is.\n',
      );
      process.exit(0);
    }
  }

  // Step 1: Create the bid workspace
  console.log('1. Creating bid workspace...');
  console.log(`   Name: ${TEST_BID_NAME}`);
  console.log(`   Buyer: ${TEST_BID_BUYER}`);
  console.log(`   Deadline: ${TEST_BID_DEADLINE}`);
  console.log(`   Reference: ${TEST_BID_REFERENCE}`);

  let procurementId: string | null = null;

  if (!dryRun) {
    const domainMetadata = {
      buyer: TEST_BID_BUYER,
      status: 'questions_extracted',
      deadline: TEST_BID_DEADLINE,
      reference_number: TEST_BID_REFERENCE,
      estimated_value: 150000,
      tender_source: null,
      tender_document_ids: [],
      submission_date: null,
      outcome: null,
      outcome_notes: null,
      notes: 'Seeded by seed-bid-test-data.ts for testing purposes.',
    };

    // Post-T2: workspaces.type column dropped — resolve application_type_id
    // via application_types.key='procurement' (per Q-OQR1-02 mapping).
    const { data: appType, error: appTypeError } = await supabase
      .from('application_types')
      .select('id')
      .eq('key', 'procurement')
      .maybeSingle();

    if (appTypeError || !appType) {
      console.error(
        'Failed to resolve application_type_id for procurement:',
        appTypeError?.message ?? 'not found',
      );
      process.exit(1);
    }

    const { data: bid, error: procurementError } = await supabase
      .from('workspaces')
      .insert({
        name: TEST_BID_NAME,
        description:
          'Test bid for UAT scenarios. Seeded automatically by seed-bid-test-data.ts.',
        application_type_id: appType.id,
        status: 'active',
        domain_metadata: domainMetadata,
      })
      .select('id')
      .single();

    if (procurementError) {
      console.error('Failed to create bid:', procurementError.message);
      process.exit(1);
    }

    procurementId = bid.id;
    console.log(`   Created: ${procurementId}\n`);
  } else {
    console.log('   [DRY RUN] Would create bid workspace.\n');
  }

  // Step 2: Create questions
  console.log('2. Creating questions...');
  const questionIds: string[] = [];

  // ID-145 {145.6}/{145.7} — form-first: mint the test form_instances row
  // directly (the resolve_or_mint_form_template_id RPC + its TS resolver are
  // retired, {145.7}). No user context here (script, not a request) —
  // created_by is left null. ingest_source='minted' (not 'app_upload') — this
  // is a docless placeholder mint (file_size 0, no real storage_path), the
  // exact case TECH.md §2 M3's re-cut ingest_source CHECK reserves 'minted'
  // for.
  let formInstanceId: string | null = null;
  if (!dryRun && procurementId) {
    const { data: mintedForm, error: mintError } = await supabase
      .from('form_instances')
      .insert({
        name: TEST_BID_NAME,
        filename: 'seed-procurement-test-data.pdf',
        storage_path: `app-created/${procurementId}/seed-procurement-test-data`,
        file_size: 0,
        mime_type: 'application/pdf',
        form_type: 'itt',
        ingest_source: 'minted',
        created_by: null,
      })
      .select('id')
      .single();

    if (mintError || !mintedForm) {
      console.error(
        'Failed to mint test form instance:',
        mintError?.message ?? 'unknown error',
      );
      process.exit(1);
    }
    formInstanceId = mintedForm.id;
  }

  for (const q of TEST_QUESTIONS) {
    console.log(
      `   [${q.section_name}] Q${q.question_sequence}: ${q.question_text.substring(0, 60)}...`,
    );

    if (!dryRun && procurementId) {
      const { data: created, error: qError } = await supabase
        .from('form_questions')
        .insert({
          form_instance_id: formInstanceId,
          section_name: q.section_name,
          section_sequence: q.section_sequence,
          question_text: q.question_text,
          question_sequence: q.question_sequence,
          word_limit: q.word_limit,
          evaluation_weight: q.evaluation_weight,
        })
        .select('id')
        .single();

      if (qError) {
        console.error(`   Failed to create question: ${qError.message}`);
        questionIds.push('');
      } else {
        questionIds.push(created.id);
      }
    } else {
      questionIds.push('');
    }
  }
  console.log(
    `   Created ${dryRun ? TEST_QUESTIONS.length + ' (preview)' : questionIds.filter(Boolean).length} questions.\n`,
  );

  // Step 3: Create draft responses
  console.log('3. Creating draft responses...');

  for (const resp of DRAFT_RESPONSES) {
    const q = TEST_QUESTIONS[resp.questionIndex];
    console.log(
      `   Response for Q${q.question_sequence} (${q.section_name}): ${resp.review_status}`,
    );

    if (!dryRun && questionIds[resp.questionIndex]) {
      const { error: rError } = await supabase.from('form_responses').insert({
        question_id: questionIds[resp.questionIndex],
        response_text: resp.response_text,
        review_status: resp.review_status,
      });

      if (rError) {
        console.error(`   Failed to create response: ${rError.message}`);
      }
    }
  }
  console.log(
    `   Created ${dryRun ? DRAFT_RESPONSES.length + ' (preview)' : DRAFT_RESPONSES.length} responses.\n`,
  );

  // Summary
  console.log('Summary');
  console.log('-------');
  console.log(`Procurement workspace: ${procurementId ?? '(dry run)'}`);
  console.log(`Questions: ${TEST_QUESTIONS.length}`);
  console.log(`Draft responses: ${DRAFT_RESPONSES.length}`);
  console.log(
    `Sections: ${[...new Set(TEST_QUESTIONS.map((q) => q.section_name))].join(', ')}`,
  );

  if (dryRun) {
    console.log('\n[DRY RUN] No data was written. Remove --dry-run to seed.');
  } else {
    console.log(`\nTest bid seeded successfully. View at:`);
    console.log(
      `  ${process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'}/bids/${procurementId}`,
    );
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
