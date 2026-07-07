/**
 * Template Coverage Threshold Calibration Script
 *
 * Runs the coverage engine against the Standard SQ template at varying
 * similarity thresholds to help calibrate the strong/partial cut-offs.
 *
 * Usage:
 *   bun run scripts/calibrate_coverage_thresholds.ts
 *   bun run scripts/calibrate_coverage_thresholds.ts --template "Standard SQ"
 *   bun run scripts/calibrate_coverage_thresholds.ts --min 0.3 --max 0.9 --step 0.1
 */

import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';
import { loadScriptEnv } from '@/scripts/lib/load-script-env';
import type { Database } from '@/supabase/types/database.types';

// ── Env loading (shared scriptDir+cwd loader — bl-356) ──

loadScriptEnv(import.meta.url);

// ── Import coverage engine (relative to avoid path alias issues in scripts) ──

import {
  computeTemplateCoverage,
  SIMILARITY_STRONG_THRESHOLD,
  SIMILARITY_PARTIAL_THRESHOLD,
  type TemplateRequirement,
  type ContentItemForMatching,
  type RequirementType,
} from '../lib/domains/procurement/form-templating/template-coverage';

// ── CLI args ──

interface CalibrationArgs {
  templateName: string;
  min: number;
  max: number;
  step: number;
  env: string;
}

function parseArgs(): CalibrationArgs {
  const args = process.argv.slice(2);
  let templateName = 'Standard Selection Questionnaire';
  let min = 0.4;
  let max = 0.8;
  let step = 0.05;
  let env = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--template' && args[i + 1]) {
      templateName = args[i + 1];
      i++;
    } else if (arg === '--min' && args[i + 1]) {
      min = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--max' && args[i + 1]) {
      max = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--step' && args[i + 1]) {
      step = parseFloat(args[i + 1]);
      i++;
    } else if (arg === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun run scripts/calibrate_coverage_thresholds.ts [options]

Options:
  --template "NAME"  Template to calibrate (default: "Standard SQ")
  --min N            Minimum strong threshold (default: 0.40)
  --max N            Maximum strong threshold (default: 0.80)
  --step N           Threshold step size (default: 0.05)
  --env=prod         Asserts SUPABASE_URL points at prod (the client production project)
  --help, -h         Show this help message`);
      process.exit(0);
    }
  }

  return { templateName, min, max, step, env };
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/calibrate-coverage-thresholds.ts --env=prod`,
    );
    process.exit(1);
  }
}

// ── Data fetching (standalone, no Next.js path aliases) ──

/**
 * The record_embeddings model column value ({130.24} DR-036 — mirrors the
 * template-coverage engine's own EMBEDDING_MODEL constant, and the
 * catalogue's — lib/domains/procurement/form-templating/catalogue/from-instance.ts).
 */
const REQUIREMENT_EMBEDDING_MODEL = 'text-embedding-3-large';

async function fetchRequirements(
  supabase: SupabaseClient<Database>,
  templateName: string,
): Promise<TemplateRequirement[]> {
  // Post-T2: `template_requirements` renamed to `form_template_requirements`.
  const { data, error } = await supabase
    .from('form_template_requirements')
    .select(
      'id, template_name, template_version, template_type, section_ref, section_name, question_number, requirement_text, description, requirement_type, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, matching_keywords, matching_guidance, is_mandatory, sector_applicability, word_limit_guidance, display_order',
    )
    .eq('template_name', templateName)
    .eq('is_current', true)
    .order('display_order');

  if (error) throw new Error(`Failed to fetch requirements: ${error.message}`);

  const rows = data ?? [];

  // {130.24} DR-036: requirement_embedding was dropped from
  // form_template_requirements — hydrate it from the polymorphic
  // record_embeddings store (owner_kind='form_template_requirement'),
  // keyed by owner_id (the requirement row's id). Mirrors
  // lib/domains/procurement/form-templating/template-coverage.ts's
  // fetchTemplateRequirements.
  const embeddingById = new Map<string, number[] | null>();
  if (rows.length > 0) {
    const { data: embeddingRows, error: embeddingError } = await supabase
      .from('record_embeddings')
      .select('owner_id, embedding')
      .eq('owner_kind', 'form_template_requirement')
      .in(
        'owner_id',
        rows.map((row) => row.id),
      )
      .eq('model', REQUIREMENT_EMBEDDING_MODEL);

    if (embeddingError) {
      throw new Error(
        `Failed to fetch record_embeddings for requirements: ${embeddingError.message}`,
      );
    }

    for (const row of embeddingRows ?? []) {
      const embedding = row.embedding
        ? typeof row.embedding === 'string'
          ? JSON.parse(row.embedding)
          : row.embedding
        : null;
      embeddingById.set(row.owner_id, embedding);
    }
  }

  return rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    template_name: row.template_name as string,
    template_version: row.template_version as string | null,
    template_type: row.template_type as string,
    section_ref: row.section_ref as string,
    section_name: row.section_name as string,
    question_number: row.question_number as number | null,
    requirement_text: row.requirement_text as string,
    description: row.description as string | null,
    requirement_type: row.requirement_type as RequirementType,
    primary_domain: row.primary_domain as string | null,
    primary_subtopic: row.primary_subtopic as string | null,
    secondary_domain: row.secondary_domain as string | null,
    secondary_subtopic: row.secondary_subtopic as string | null,
    matching_keywords: row.matching_keywords as string[] | null,
    matching_guidance: row.matching_guidance as string | null,
    requirement_embedding: embeddingById.get(row.id as string) ?? null,
    is_mandatory: row.is_mandatory as boolean | null,
    sector_applicability: row.sector_applicability as string[] | null,
    word_limit_guidance: row.word_limit_guidance as number | null,
    display_order: row.display_order as number,
  }));
}

async function fetchContent(
  supabase: SupabaseClient<Database>,
): Promise<ContentItemForMatching[]> {
  const { data, error } = await supabase
    .from('content_items')
    .select(
      'id, content, brief, detail, title, suggested_title, primary_domain, primary_subtopic, content_type, ai_keywords, embedding',
    )
    .is('archived_at', null);

  if (error) throw new Error(`Failed to fetch content: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    content: row.content as string,
    brief: row.brief as string | null,
    detail: row.detail as string | null,
    title: row.title as string,
    suggested_title: row.suggested_title as string | null,
    primary_domain: row.primary_domain as string | null,
    primary_subtopic: row.primary_subtopic as string | null,
    content_type: row.content_type as string,
    ai_keywords: row.ai_keywords as string[] | null,
    embedding: row.embedding
      ? typeof row.embedding === 'string'
        ? JSON.parse(row.embedding as string)
        : (row.embedding as number[])
      : null,
  }));
}

// ── Main ──

async function main() {
  const { templateName, min, max, step, env } = parseArgs();

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.',
    );
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl);

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

  console.log(`\n📐 Template Coverage Threshold Calibration`);
  console.log(`   Template: ${templateName}`);
  console.log(
    `   Strong threshold range: ${min.toFixed(2)} → ${max.toFixed(2)} (step ${step.toFixed(2)})`,
  );
  console.log(`   Partial threshold = strong − 0.20\n`);

  // Fetch data
  console.log('Fetching template requirements...');
  const requirements = await fetchRequirements(supabase, templateName);
  if (requirements.length === 0) {
    console.error(`No requirements found for template "${templateName}".`);
    process.exit(1);
  }
  console.log(`  → ${requirements.length} requirements loaded`);

  console.log('Fetching content items...');
  const content = await fetchContent(supabase);
  console.log(
    `  → ${content.length} content items loaded (excluding archived)\n`,
  );

  // Check embedding coverage
  const reqWithEmbeddings = requirements.filter(
    (r) => r.requirement_embedding !== null,
  ).length;
  const contentWithEmbeddings = content.filter(
    (c) => c.embedding !== null,
  ).length;
  console.log(
    `Embedding coverage: ${reqWithEmbeddings}/${requirements.length} requirements, ${contentWithEmbeddings}/${content.length} content items\n`,
  );

  // Run calibration
  const results: Array<{
    strong: number;
    partial: number;
    score: number;
    strongCount: number;
    partialCount: number;
    gapCount: number;
    naCount: number;
  }> = [];

  const thresholds: number[] = [];
  for (let t = min; t <= max + 0.001; t += step) {
    thresholds.push(Math.round(t * 100) / 100);
  }

  for (const strongT of thresholds) {
    const partialT = Math.max(0.1, strongT - 0.2);
    const coverage = computeTemplateCoverage(
      templateName,
      null,
      'standard_questionnaire',
      requirements,
      content,
      strongT,
      partialT,
    );
    results.push({
      strong: strongT,
      partial: partialT,
      score: coverage.score,
      strongCount: coverage.strong_count,
      partialCount: coverage.partial_count,
      gapCount: coverage.gap_count,
      naCount: coverage.na_count,
    });
  }

  // Output table
  const header = 'Strong  Partial  Score   Strong  Partial  Gap  N/A';
  const divider = '─'.repeat(header.length);
  console.log(header);
  console.log(divider);

  for (const r of results) {
    const marker =
      r.strong === SIMILARITY_STRONG_THRESHOLD &&
      r.partial === SIMILARITY_PARTIAL_THRESHOLD
        ? ' ← current'
        : '';
    console.log(
      `${r.strong.toFixed(2)}    ${r.partial.toFixed(2)}     ${(r.score * 100).toFixed(1).padStart(5)}%  ${String(r.strongCount).padStart(6)}  ${String(r.partialCount).padStart(7)}  ${String(r.gapCount).padStart(3)}  ${String(r.naCount).padStart(3)}${marker}`,
    );
  }

  console.log(divider);
  console.log(`\nTotal requirements: ${requirements.length}`);
  console.log(
    `Current defaults: strong=${SIMILARITY_STRONG_THRESHOLD}, partial=${SIMILARITY_PARTIAL_THRESHOLD}\n`,
  );
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
