#!/usr/bin/env bun
/**
 * Path C — generic catalogue-from-instance executable (TECH §2.7, ID-52.14).
 *
 * Reads the `form_template_fields` of one ingested form instance, classifies
 * each field into a catalogue-requirement shape via Anthropic, embeds it,
 * presents each candidate row for explicit `y/n` confirmation, and — only on
 * confirmation by an authorised (admin/editor) caller — writes the rows to the
 * global `form_template_requirements` catalogue.
 *
 * This is the generic template. The `catalogue-form-requirements` skill emits
 * per-form copies named `scripts/catalogue-from-instance-<form_template_id>.ts`
 * (which may simply invoke this with the id baked in), but this file runs
 * directly too:
 *
 *   bun run scripts/catalogue-from-instance.ts --form-template-id <uuid> \
 *     [--template-type <form_types.key>] [--confirm] [--env=prod]
 *
 * Without `--confirm`, the script runs in PREVIEW mode: it classifies and
 * prints every candidate row but writes nothing (Inv-21 — no auto-write).
 *
 * Invariants: Inv-20 (cataloguing only via this path), Inv-21 (human-confirmed),
 * Inv-22 (T10 read shape), Inv-23 (no workspace_id), Inv-24 (admin/editor gate).
 */

import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { createInterface } from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import type { Database } from '@/supabase/types/database.types';
import {
  readInstanceFields,
  classifyField,
  resolveRequirementEmbedding,
  buildCatalogueRow,
  confirmAndWriteCatalogue,
  type CatalogueRowInsert,
} from '@/lib/catalogue/from-instance';

// ── Env loading (same walk-up pattern as catalogue-standard-sq.ts) ──────────

function loadEnv(): void {
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
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    if (fs.existsSync(path.join(dir, 'package.json'))) break;
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── CLI args ─────────────────────────────────────────────────────────────

interface CliArgs {
  formTemplateId: string;
  templateType: string | null;
  confirm: boolean;
  env: string;
}

function parseCliArgs(): CliArgs {
  const args = process.argv.slice(2);
  let formTemplateId = '';
  let templateType: string | null = null;
  let confirm = false;
  let env = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--form-template-id' && args[i + 1]) {
      formTemplateId = args[++i];
    } else if (arg.startsWith('--form-template-id=')) {
      formTemplateId = arg.slice('--form-template-id='.length);
    } else if (arg === '--template-type' && args[i + 1]) {
      templateType = args[++i];
    } else if (arg.startsWith('--template-type=')) {
      templateType = arg.slice('--template-type='.length);
    } else if (arg === '--confirm') {
      confirm = true;
    } else if (arg === '--env' && args[i + 1]) {
      env = args[++i];
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    }
  }

  return { formTemplateId, templateType, confirm, env };
}

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.`,
    );
    process.exit(1);
  }
}

// ── stdin y/n confirmation ──────────────────────────────────────────────────

function makeStdinConfirmer(): {
  confirm: (row: CatalogueRowInsert, index: number) => Promise<boolean>;
  close: () => void;
} {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  return {
    confirm: async (row, index) => {
      console.log(`\n── Candidate ${index + 1} ─────────────────────────────`);
      console.log(`  section_name:      ${row.section_name}`);
      console.log(`  requirement_type:  ${row.requirement_type}`);
      console.log(`  is_mandatory:      ${row.is_mandatory}`);
      console.log(`  matching_keywords: ${row.matching_keywords?.join(', ')}`);
      console.log(`  matching_guidance: ${row.matching_guidance ?? '(none)'}`);
      console.log(`  requirement_text:  ${row.requirement_text.slice(0, 120)}`);
      const answer = (await ask('  Write this row? [y/N] '))
        .trim()
        .toLowerCase();
      return answer === 'y' || answer === 'yes';
    },
    close: () => rl.close(),
  };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { formTemplateId, templateType, confirm, env } = parseCliArgs();

  if (!formTemplateId) {
    console.error(
      'ERROR: --form-template-id <uuid> is required.\n' +
        'Usage: bun run scripts/catalogue-from-instance.ts --form-template-id <uuid> [--template-type <key>] [--confirm]',
    );
    process.exit(1);
  }

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
    process.exit(1);
  }
  assertEnvFlag(env, supabaseUrl);

  const supabase = createClient<Database>(supabaseUrl, supabaseKey);
  const anthropic = new Anthropic();

  // ── Read the instance (read-only) ──
  console.log(`Reading form_template_fields for instance ${formTemplateId}...`);
  const templateResult = await supabase
    .from('form_templates')
    .select('id, name, form_type')
    .eq('id', formTemplateId)
    .single();
  if (templateResult.error || !templateResult.data) {
    console.error(
      `ERROR: could not load form_templates row ${formTemplateId}: ${templateResult.error?.message ?? 'not found'}`,
    );
    process.exit(1);
  }
  const template = templateResult.data;
  const resolvedType = templateType ?? template.form_type;
  if (!resolvedType) {
    console.error(
      'ERROR: the instance has no form_type and no --template-type override was supplied.',
    );
    process.exit(1);
  }

  const fieldsResult = await readInstanceFields(supabase, formTemplateId);
  if (!fieldsResult.ok) {
    console.error(
      `ERROR reading instance fields: ${fieldsResult.error.message}`,
    );
    process.exit(1);
  }
  const fields = fieldsResult.data;
  if (fields.length === 0) {
    console.error(
      'ERROR: the instance has no form_template_fields to catalogue.',
    );
    process.exit(1);
  }
  console.log(`  Read ${fields.length} fields. Classifying + embedding...`);

  // ── Classify + embed each field into a candidate row ──
  // Embedding recompute is conditional ({52.22} design §3.2): when the
  // catalogue already holds a row for this natural key with unchanged
  // requirement text, the stored vector is reused (no OpenAI call); the row
  // is still UPSERTed so other changed fields update.
  const rows: CatalogueRowInsert[] = [];
  let reusedEmbeddings = 0;
  for (const field of fields) {
    const classification = await classifyField(anthropic, field);
    const embedText = `${field.question_text ?? ''}\n\nKeywords: ${classification.matching_keywords.join(', ')}`;
    const resolved = await resolveRequirementEmbedding({
      supabase,
      field,
      templateName: template.name,
      embedText,
    });
    if (resolved.reused) reusedEmbeddings += 1;
    rows.push(
      buildCatalogueRow({
        field,
        classification,
        embedding: resolved.embedding,
        templateName: template.name,
        templateType: resolvedType,
      }),
    );
  }
  if (reusedEmbeddings > 0) {
    console.log(
      `  Reused ${reusedEmbeddings} stored embedding(s) (requirement text unchanged).`,
    );
  }

  // ── Preview mode — no write (Inv-21) ──
  if (!confirm) {
    console.log(
      `\nPREVIEW (no --confirm): ${rows.length} candidate rows. Nothing written.\n`,
    );
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      console.log(
        `  [${i + 1}] ${r.requirement_type} — ${r.requirement_text.slice(0, 80)}`,
      );
    }
    console.log('\nRe-run with --confirm to write rows (admin/editor only).');
    return;
  }

  // ── Confirm + write (auth gate + per-row y/n) ──
  const confirmer = makeStdinConfirmer();
  try {
    const result = await confirmAndWriteCatalogue({
      supabase,
      rows,
      confirmRow: confirmer.confirm,
    });

    if (result.refused) {
      console.error(
        `\nWRITE REFUSED — auth gate failed (reason: ${result.refusalReason}, status: ${result.refusalStatus}).\n` +
          'Only admin/editor callers may write the catalogue (Inv-24).',
      );
      process.exit(1);
    }

    console.log(
      `\nDONE: ${result.written} written, ${result.declined} declined, ${result.failed} failed.`,
    );
    if (result.failed > 0) {
      for (const err of result.errors) console.error(`  insert error: ${err}`);
      process.exit(1);
    }
  } finally {
    confirmer.close();
  }
}

main().catch((err) => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
