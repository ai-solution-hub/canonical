#!/usr/bin/env bun
/**
 * ID-145 {145.6} W1f — reseed exemplar + bid-default reclassification.
 *
 * TECH.md §2 M6 ("...w1f_reseed_exemplar.sql (or a TS seed script)"). A TS
 * script, not a .sql migration, because two of its three jobs need a Node/Bun
 * runtime: uploading a real file to Supabase Storage (not expressible as
 * portable DDL/DML) and the requirement-catalogue reseed depends on the
 * OpenAI embedding service (see JOB 2 below for why that piece defers to an
 * existing script rather than being duplicated here).
 *
 * THREE JOBS (PRODUCT.md BI-44/BI-45):
 *
 *   JOB 1 — re-classify `form_type='bid'` defaults (BI-45). The RPC/backfill
 *   precedents that minted placeholder forms (id-130 {130.8}, the now-retired
 *   `resolve_or_mint_form_template_id`) all hardcoded `form_type='bid'` — a
 *   bid-era default no live item should carry as its real classification.
 *   Reclassified to 'itt' (Invitation To Tender): the closest real
 *   final-award-stage type to what "bid" was standing in for (matches
 *   `form_outcome_types`' own final_award-stage applicable_form_types set,
 *   which still lists 'bid' alongside 'itt'/'tender'/'rfp'). A plain,
 *   idempotent UPDATE — safe to re-run (a second pass matches zero rows).
 *
 *   JOB 2 — reseed `form_requirement_templates` (staging 0 rows vs prod 96 —
 *   seed drift). NOT duplicated here: `scripts/catalogue-standard-sq.ts`
 *   already contains 66 real, reviewed Standard-SQ (PPN 03/24) requirement
 *   rows with embeddings — re-implementing that dataset in a second script
 *   would create two divergent sources of truth for the same canonical
 *   catalogue. That script currently targets the pre-{145.6} table name
 *   (`form_template_requirements`) and is OUT of this Subtask's file-ownership
 *   boundary (grep-swept and reported, not fixed, per the {145.6}/{145.7}
 *   dispatch brief's SQL-grep discipline instruction) — running it against
 *   staging is a POST-PUSH step once its table-name reference is updated. The
 *   remaining ~30 rows needed to reach prod's 96-row count (from the other
 *   three exemplar dirs under docs/testing/test-data/templates/ —
 *   itt-services-charnwood, itt-services-efa, rfp-british-council) have no
 *   equivalent checked-in cataloguing script; BI-44's own verifiable
 *   criterion only requires ONE usable exemplar (JOB 3 below), so the
 *   remaining seed-drift gap is flagged for the Curator rather than
 *   fabricated here.
 *
 *   JOB 3 — seed exactly ONE form-first exemplar item (BI-44) from the
 *   verified 198-field Standard SQ PDF baseline
 *   (docs/testing/test-data/templates/sq-standard-selection-questionnaire/
 *   standard-selection-questionnaire-ppn-03-24.pdf) — uploads the real file to
 *   the `tender-documents` storage bucket and mints one `form_instances` row
 *   whose file identity IS that upload (ingest_source='app_upload' — a real
 *   document backs this row, unlike a docless mint). form_type='psq' (the DB's
 *   controlled vocabulary collapses SQ/PSQ into one key, see form_types seed
 *   `20260625150000_id130_data.sql` — 'psq' labelled "Selection Questionnaire
 *   (SQ/PSQ)"; there is no separate 'sq' key). Idempotent: skips the upload +
 *   insert if a form_instances row with this exact name already exists (BI-44
 *   "exactly one form-first exemplar" — a second run must not mint a second
 *   one).
 *
 * NOT RUN by this Subtask (staging-first push constraint — this worktree
 * authors migrations/scripts but does not apply them against any project;
 * the push is an Orchestrator-gated integration step). Run post-push:
 *   bun run scripts/seed-id145-w1f-exemplar.ts --env=staging
 *
 * Usage:
 *   bun run scripts/seed-id145-w1f-exemplar.ts                   # full run
 *   bun run scripts/seed-id145-w1f-exemplar.ts --dry-run          # preview only
 *   bun run scripts/seed-id145-w1f-exemplar.ts --skip-bid-reclassify
 *   bun run scripts/seed-id145-w1f-exemplar.ts --skip-exemplar
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { loadEnv } from './lib/load-env';

loadEnv();

const EXEMPLAR_NAME = 'Standard Selection Questionnaire (PPN 03/24) — exemplar';
const EXEMPLAR_RELATIVE_PATH =
  'docs/testing/test-data/templates/sq-standard-selection-questionnaire/standard-selection-questionnaire-ppn-03-24.pdf';
const EXEMPLAR_STORAGE_BUCKET = 'tender-documents';
const EXEMPLAR_MIME_TYPE = 'application/pdf';

function parseCliArgs(): {
  dryRun: boolean;
  skipBidReclassify: boolean;
  skipExemplar: boolean;
} {
  const args = process.argv.slice(2);
  return {
    dryRun: args.includes('--dry-run'),
    skipBidReclassify: args.includes('--skip-bid-reclassify'),
    skipExemplar: args.includes('--skip-exemplar'),
  };
}

async function reclassifyBidDefaults(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- form_instances is not yet in database.types.ts pending the Orchestrator's post-push `bun run sync` ({145.6} type-regen-skip allowance)
  supabase: any,
  dryRun: boolean,
): Promise<void> {
  console.log("JOB 1 — re-classify form_type='bid' defaults to 'itt'...");

  if (dryRun) {
    const { count, error } = await supabase
      .from('form_instances')
      .select('id', { count: 'exact', head: true })
      .eq('form_type', 'bid');
    if (error) {
      console.error('  Failed to count bid-typed forms:', error.message);
      process.exit(1);
    }
    console.log(`  [DRY RUN] Would reclassify ${count ?? 0} row(s).`);
    return;
  }

  const { data, error } = await supabase
    .from('form_instances')
    .update({ form_type: 'itt' })
    .eq('form_type', 'bid')
    .select('id');

  if (error) {
    console.error('  Failed to reclassify bid-typed forms:', error.message);
    process.exit(1);
  }
  console.log(`  Reclassified ${data?.length ?? 0} row(s) 'bid' -> 'itt'.`);
}

async function seedExemplar(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see reclassifyBidDefaults
  supabase: any,
  dryRun: boolean,
): Promise<void> {
  console.log('JOB 3 — seed one form-first exemplar (Standard SQ PDF)...');

  const { data: existing, error: checkError } = await supabase
    .from('form_instances')
    .select('id')
    .eq('name', EXEMPLAR_NAME)
    .limit(1);

  if (checkError) {
    console.error(
      '  Failed to check for an existing exemplar:',
      checkError.message,
    );
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log(
      `  Exemplar already exists (${existing[0].id}) — BI-44 wants exactly one; skipping.`,
    );
    return;
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const pdfPath = resolve(repoRoot, EXEMPLAR_RELATIVE_PATH);
  const fileBuffer = await readFile(pdfPath);

  if (dryRun) {
    console.log(
      `  [DRY RUN] Would upload ${EXEMPLAR_RELATIVE_PATH} (${fileBuffer.byteLength} bytes) and mint one form_instances row named "${EXEMPLAR_NAME}".`,
    );
    return;
  }

  const storagePath = `id145-w1f-exemplar/standard-selection-questionnaire-ppn-03-24.pdf`;
  const { error: uploadError } = await supabase.storage
    .from(EXEMPLAR_STORAGE_BUCKET)
    .upload(storagePath, fileBuffer, {
      contentType: EXEMPLAR_MIME_TYPE,
      upsert: true,
    });

  if (uploadError) {
    console.error('  Failed to upload the exemplar PDF:', uploadError.message);
    process.exit(1);
  }

  const { data: created, error: insertError } = await supabase
    .from('form_instances')
    .insert({
      name: EXEMPLAR_NAME,
      filename: 'standard-selection-questionnaire-ppn-03-24.pdf',
      storage_path: storagePath,
      file_size: fileBuffer.byteLength,
      mime_type: EXEMPLAR_MIME_TYPE,
      form_type: 'psq',
      ingest_source: 'app_upload',
      created_by: null,
    })
    .select('id')
    .single();

  if (insertError || !created) {
    console.error(
      '  Failed to mint the exemplar form_instances row:',
      insertError?.message ?? 'unknown error',
    );
    process.exit(1);
  }

  console.log(`  Seeded exemplar form_instances row: ${created.id}`);
}

async function main(): Promise<void> {
  const { dryRun, skipBidReclassify, skipExemplar } = parseCliArgs();

  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    );
    process.exit(1);
  }

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

  if (dryRun) console.log('[DRY RUN] No data will be written.\n');

  if (!skipBidReclassify) {
    await reclassifyBidDefaults(supabase, dryRun);
  }
  console.log('');

  if (!skipExemplar) {
    await seedExemplar(supabase, dryRun);
  }
  console.log('');

  console.log(
    'JOB 2 (form_requirement_templates reseed) is NOT run by this script —',
  );
  console.log(
    "  see this file's header comment: run scripts/catalogue-standard-sq.ts",
  );
  console.log(
    '  once its table-name reference is updated for the {145.6} rename.',
  );
}

if (import.meta.main) {
  main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}
