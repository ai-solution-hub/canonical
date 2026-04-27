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

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createClient } from '@supabase/supabase-js';

// ── Env loading (mirrors kb-search.ts) ──

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
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
    // File doesn't exist — fine
  }
}

function findProjectRoot(): string {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const candidates = new Set<string>();

  let dir = resolve(scriptDir, '..');
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const root of candidates) {
    if (
      existsSync(resolve(root, '.env')) ||
      existsSync(resolve(root, '.env.local'))
    ) {
      return root;
    }
  }

  return resolve(scriptDir, '..');
}

const PROJECT_ROOT = findProjectRoot();
loadEnvFile(resolve(PROJECT_ROOT, '.env.local'));
loadEnvFile(resolve(PROJECT_ROOT, '.env'));

// ── Import coverage engine (relative to avoid path alias issues in scripts) ──

import {
  computeTemplateCoverage,
  SIMILARITY_STRONG_THRESHOLD,
  SIMILARITY_PARTIAL_THRESHOLD,
  type TemplateRequirement,
  type ContentItemForMatching,
  type RequirementType,
} from '../lib/templates/template-coverage';

// ── CLI args ──

interface CalibrationArgs {
  templateName: string;
  min: number;
  max: number;
  step: number;
}

function parseArgs(): CalibrationArgs {
  const args = process.argv.slice(2);
  let templateName = 'Standard Selection Questionnaire';
  let min = 0.4;
  let max = 0.8;
  let step = 0.05;

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
    } else if (arg === '--help' || arg === '-h') {
      console.log(`Usage: bun run scripts/calibrate_coverage_thresholds.ts [options]

Options:
  --template "NAME"  Template to calibrate (default: "Standard SQ")
  --min N            Minimum strong threshold (default: 0.40)
  --max N            Maximum strong threshold (default: 0.80)
  --step N           Threshold step size (default: 0.05)
  --help, -h         Show this help message`);
      process.exit(0);
    }
  }

  return { templateName, min, max, step };
}

// ── Data fetching (standalone, no Next.js path aliases) ──

async function fetchRequirements(
  supabase: ReturnType<typeof createClient>,
  templateName: string,
): Promise<TemplateRequirement[]> {
  const { data, error } = await supabase
    .from('template_requirements')
    .select(
      'id, template_name, template_version, template_type, section_ref, section_name, question_number, requirement_text, description, requirement_type, primary_domain, primary_subtopic, secondary_domain, secondary_subtopic, matching_keywords, matching_guidance, requirement_embedding, is_mandatory, sector_applicability, word_limit_guidance, display_order',
    )
    .eq('template_name', templateName)
    .eq('is_current', true)
    .order('display_order');

  if (error) throw new Error(`Failed to fetch requirements: ${error.message}`);

  return (data ?? []).map((row: Record<string, unknown>) => ({
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
    requirement_embedding: row.requirement_embedding
      ? typeof row.requirement_embedding === 'string'
        ? JSON.parse(row.requirement_embedding as string)
        : (row.requirement_embedding as number[])
      : null,
    is_mandatory: row.is_mandatory as boolean | null,
    sector_applicability: row.sector_applicability as string[] | null,
    word_limit_guidance: row.word_limit_guidance as number | null,
    display_order: row.display_order as number,
  }));
}

async function fetchContent(
  supabase: ReturnType<typeof createClient>,
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
  const { templateName, min, max, step } = parseArgs();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set.',
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

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
