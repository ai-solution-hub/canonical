#!/usr/bin/env bun
/**
 * Tag morphology corpus regression eval — §1.17 / S197 WP3.
 *
 * Reads every distinct tag in `content_items.ai_keywords` and compares the
 * stored value against `normaliseTag(tag)`. Disagreements are reported as
 * potential merges (the library proposes a different canonical form).
 *
 * Outputs:
 *   - Summary table to stdout
 *   - JSON diff file: docs/audits/tag-morphology-eval-{timestamp}.json
 *   - Optionally: inserts rows into `tag_morphology_drift_flags` for human
 *     triage via the Settings UI (requires --insert-flags).
 *
 * Usage:
 *   bun run scripts/eval-tag-morphology-adoption.ts                    # dry run, JSON only
 *   bun run scripts/eval-tag-morphology-adoption.ts --insert-flags     # also writes flag rows
 *   bun run scripts/eval-tag-morphology-adoption.ts --limit 1000       # cap rows scanned
 *
 * Sandbox note: this script writes nothing in default mode. With
 * `--insert-flags` it uses supabase-js `.upsert()` which returns 204 — must
 * run with `dangerouslyDisableSandbox: true`. Production (Vercel) unaffected.
 *
 * Spec: docs/specs/p1-tag-morphology-library-adoption-spec.md §3.5.
 */

import { parseArgs } from 'util';
import path from 'path';
import fs from 'fs';
import { normaliseTag } from '../lib/validation/schemas';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { assertEnvFlag } from '@/scripts/lib/script-env';

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
          const val = trimmed
            .slice(eq + 1)
            .trim()
            .replace(/^["']|["']$/g, '');
          if (!process.env[key]) process.env[key] = val;
        }
      }
    }
    dir = path.dirname(dir);
  }
}

loadEnv();

// ── Types ──────────────────────────────────────────────────────────────────

interface DiffEntry {
  stored_tag: string;
  proposed_canonical: string;
  usage_count: number;
  affected_content_ids: string[];
}

interface EvalSummary {
  total_unique_tags: number;
  unchanged: number;
  newly_canonicalised: number;
  diffs: DiffEntry[];
  generated_at: string;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      'insert-flags': { type: 'boolean', default: false },
      limit: { type: 'string', default: '' },
      help: { type: 'boolean', default: false },
      env: { type: 'string', default: '' },
    },
    strict: true,
  });

  if (values.help) {
    console.log(`
Usage: bun run scripts/eval-tag-morphology-adoption.ts [options]

Options:
  --insert-flags   Insert disagreements into tag_morphology_drift_flags
  --limit N        Process at most N content_items rows
  --env=prod       Asserts SUPABASE_URL points at prod (the client production project)
  --help           Show this help

Examples:
  bun run scripts/eval-tag-morphology-adoption.ts                  # dry run
  bun run scripts/eval-tag-morphology-adoption.ts --insert-flags   # populate triage queue
`);
    process.exit(0);
  }

  const insertFlags = values['insert-flags'] === true;
  const LIMIT = values.limit ? parseInt(values.limit, 10) : 0;

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables.',
    );
    process.exit(1);
  }

  assertEnvFlag(
    values.env ?? '',
    supabaseUrl,
    'scripts/eval-tag-morphology-adoption.ts',
  );

  // tag_morphology_drift_flags is a new table not yet in database.types.ts;
  // we cast the supabase client to any for that table only (CLAUDE.md
  // gotcha: "Do not regen types mid-session").
  const supabase = createScriptClient(supabaseUrl, supabaseKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabaseUntyped = supabase as any;

  console.log('='.repeat(60));
  console.log('Tag morphology regression eval');
  console.log('='.repeat(60));
  console.log(`Mode: ${insertFlags ? 'WRITE (--insert-flags)' : 'DRY RUN'}`);
  if (LIMIT > 0) console.log(`Row limit: ${LIMIT}`);

  // Stream content_items in batches so we can build a tag → ids map
  const tagUsage = new Map<string, { ids: Set<string>; count: number }>();
  let totalRows = 0;
  const batchSize = 1000;

  for (let offset = 0; ; offset += batchSize) {
    if (LIMIT && offset >= LIMIT) break;

    const remaining = LIMIT ? Math.min(batchSize, LIMIT - offset) : batchSize;
    const { data, error } = await supabase
      .from('content_items')
      .select('id, ai_keywords')
      .not('ai_keywords', 'is', null)
      .order('id')
      .range(offset, offset + remaining - 1);

    if (error) {
      console.error('Failed to read content_items:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;

    for (const row of data) {
      const tags = (row.ai_keywords ?? []) as string[];
      for (const tag of tags) {
        if (typeof tag !== 'string' || tag.length === 0) continue;
        const slot = tagUsage.get(tag);
        if (slot) {
          slot.ids.add(row.id);
          slot.count++;
        } else {
          tagUsage.set(tag, { ids: new Set([row.id]), count: 1 });
        }
      }
    }

    totalRows += data.length;
    if (data.length < remaining) break;
  }

  console.log(`Scanned ${totalRows} content_items rows.`);
  console.log(`Found ${tagUsage.size} distinct tags.`);

  // Compute the diff
  const diffs: DiffEntry[] = [];
  let unchanged = 0;

  for (const [storedTag, info] of tagUsage) {
    const proposed = normaliseTag(storedTag);
    if (proposed === storedTag) {
      unchanged++;
      continue;
    }
    diffs.push({
      stored_tag: storedTag,
      proposed_canonical: proposed,
      usage_count: info.count,
      affected_content_ids: Array.from(info.ids),
    });
  }

  diffs.sort((a, b) => b.usage_count - a.usage_count);

  const summary: EvalSummary = {
    total_unique_tags: tagUsage.size,
    unchanged,
    newly_canonicalised: diffs.length,
    diffs,
    generated_at: new Date().toISOString(),
  };

  // Write JSON diff file
  const auditDir = path.join(process.cwd(), 'docs', 'audits');
  fs.mkdirSync(auditDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = path.join(auditDir, `tag-morphology-eval-${stamp}.json`);
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf-8');

  console.log('\n' + '─'.repeat(60));
  console.log('Summary');
  console.log('─'.repeat(60));
  console.log(`Total unique tags:        ${summary.total_unique_tags}`);
  console.log(`Unchanged (library agrees): ${summary.unchanged}`);
  console.log(`Newly canonicalised:        ${summary.newly_canonicalised}`);

  if (diffs.length > 0) {
    console.log('\nTop 20 disagreements (by usage_count):');
    for (const d of diffs.slice(0, 20)) {
      console.log(
        `  ${d.usage_count.toString().padStart(5)}× ` +
          `${d.stored_tag.padEnd(30)} → ${d.proposed_canonical}`,
      );
    }
    if (diffs.length > 20) {
      console.log(`  … plus ${diffs.length - 20} more`);
    }
  }

  console.log(`\nDiff JSON written to: ${outPath}`);

  // Optionally write to tag_morphology_drift_flags
  if (insertFlags && diffs.length > 0) {
    console.log('\nInserting flags into tag_morphology_drift_flags…');
    // Upsert in batches of 200
    let inserted = 0;
    const batchInsertSize = 200;
    for (let i = 0; i < diffs.length; i += batchInsertSize) {
      const batch = diffs.slice(i, i + batchInsertSize);
      const { error } = await supabaseUntyped
        .from('tag_morphology_drift_flags')
        .upsert(
          batch.map((d) => ({
            stored_tag: d.stored_tag,
            proposed_canonical: d.proposed_canonical,
            usage_count: d.usage_count,
            affected_content_ids: d.affected_content_ids,
          })),
          {
            onConflict: 'stored_tag,proposed_canonical',
            ignoreDuplicates: false,
          },
        );
      if (error) {
        console.error(`  Batch ${i}–${i + batch.length}: ${error.message}`);
        process.exit(1);
      }
      inserted += batch.length;
      console.log(`  Inserted/updated ${inserted}/${diffs.length}`);
    }
    console.log('Done. Triage at /settings?section=tag-morphology');
  } else if (diffs.length > 0) {
    console.log(
      '\nDry run — no flags written. Re-run with --insert-flags to populate the triage queue.',
    );
  } else {
    console.log('\nNo disagreements found — nothing to triage.');
  }
}

main().catch((err) => {
  console.error('Eval failed:', err);
  process.exit(1);
});
