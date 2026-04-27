#!/usr/bin/env bun
/**
 * Wipe bid responses — migration helper for P0-BM Phase 2.
 *
 * Deletes all rows from `bid_response_history` and `bid_responses` in FK order.
 * Used during the wipe-and-regenerate migration (no production bid data exists).
 *
 * Optional `--convert` flag: instead of deleting, converts existing HTML
 * `response_text` values to markdown in-place using the project's configured
 * Turndown service. Useful if preserving responses during the HTML → markdown
 * format migration.
 *
 * **REQUIRED ENV FLAG (D-22 fix per WP-S5.2 spec v1.1 §6.2 + §9):**
 *   --env=staging  Default safe target post-flip. Asserts SUPABASE_URL
 *                  contains `turayklvaunphgbgscat`.
 *   --env=prod     DANGEROUS — only with explicit confirmation prompt.
 *                  Asserts SUPABASE_URL contains `rovrymhhffssilaftdwd`.
 *
 * The script FAILS FAST if neither flag is passed.
 *
 * NOTE: When running against the dev DB via Claude Code, invoke with
 * `dangerouslyDisableSandbox: true` to avoid the Bun+sandbox HTTP 204 hang
 * (see CLAUDE.md Gotchas § Supabase).
 *
 * Usage:
 *   bun run scripts/wipe-bid-responses.ts --env=staging               # wipe staging (with 5s safety delay)
 *   bun run scripts/wipe-bid-responses.ts --env=staging --dry-run     # preview counts without changes
 *   bun run scripts/wipe-bid-responses.ts --env=staging --convert     # HTML → markdown in-place (no delete)
 *   bun run scripts/wipe-bid-responses.ts --env=staging --convert --dry-run  # preview conversion
 *   bun run scripts/wipe-bid-responses.ts --env=staging --yes         # skip 5s safety delay
 *   bun run scripts/wipe-bid-responses.ts --env=prod                  # WIPE PROD (interactive confirm)
 */

import { createClient } from '@supabase/supabase-js';
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

// ── Args ───────────────────────────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    convert: { type: 'boolean', default: false },
    yes: { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
    env: { type: 'string', default: '' },
  },
  strict: true,
});

if (args.help) {
  console.log(`
Usage: bun run scripts/wipe-bid-responses.ts --env=<staging|prod> [options]

Required:
  --env=staging  Wipe staging (asserts URL contains \`turayklvaunphgbgscat\`)
  --env=prod     Wipe prod   (asserts URL contains \`rovrymhhffssilaftdwd\`,
                 requires interactive "wipe prod" confirmation)

Options:
  --dry-run      Preview row counts without making changes
  --convert      Convert HTML response_text to markdown in-place (no delete)
  --yes          Skip the 5-second safety delay before destructive operations
  --help         Show this help

The script FAILS FAST if neither --env=staging nor --env=prod is passed —
this prevents accidental wipes against whichever DB happens to be linked.
`);
  process.exit(0);
}

const DRY_RUN = args['dry-run']!;
const CONVERT = args.convert!;
const SKIP_DELAY = args.yes!;
const ENV_FLAG = args.env!;

// Project-ref constants for env-flag assertion (D-22 fix per WP-S5.2 spec
// v1.1 §6.2 + §9). Hardcoded per spec §7.1 so the script does NOT swap
// env values — the flag only ASSERTS the env-resolved URL points at the
// expected env. Operator must provide creds via env vars.
const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';
const STAGING_PROJECT_REF = 'turayklvaunphgbgscat';

// ── Supabase client ────────────────────────────────────────────────────────

// v1.1 W3e M-1 fix: read SUPABASE_URL ?? NEXT_PUBLIC_SUPABASE_URL so spec §7.1/§7.3 override examples
// (`SUPABASE_URL=<prod-url> bun run ...`) match the resolved variable.
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error(
    'ERROR: Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL in environment. Check .env.local.',
  );
  process.exit(1);
}

if (!supabaseKey) {
  console.error(
    'ERROR: Missing SUPABASE_SERVICE_ROLE_KEY in environment. This script requires the service-role key, not the anon key.',
  );
  process.exit(1);
}

// FAIL-FAST: --env flag is REQUIRED. Without it, we have no way to know
// whether the linked DB is the intended target — this is the highest-risk
// destructive script in the repo.
if (ENV_FLAG !== 'staging' && ENV_FLAG !== 'prod') {
  console.error(
    'ERROR: --env=<staging|prod> is REQUIRED. This script wipes ALL bid responses;\n' +
      'refusing to run without an explicit env flag to prevent accidental destruction.\n\n' +
      'Examples:\n' +
      '  bun run scripts/wipe-bid-responses.ts --env=staging\n' +
      '  bun run scripts/wipe-bid-responses.ts --env=prod   # interactive confirm\n',
  );
  process.exit(1);
}

// Assert URL matches the named env.
if (ENV_FLAG === 'staging' && !supabaseUrl.includes(STAGING_PROJECT_REF)) {
  console.error(
    `ERROR: --env=staging set but SUPABASE_URL does not include '${STAGING_PROJECT_REF}'.\n` +
      `Current SUPABASE_URL: ${supabaseUrl}\n` +
      'Update .env.local to point at staging or pass an explicit override:\n' +
      `  SUPABASE_URL=https://${STAGING_PROJECT_REF}.supabase.co \\\n` +
      '    SUPABASE_SERVICE_ROLE_KEY=<staging-svc-key> \\\n' +
      '    bun run scripts/wipe-bid-responses.ts --env=staging',
  );
  process.exit(1);
}
if (ENV_FLAG === 'prod' && !supabaseUrl.includes(PROD_PROJECT_REF)) {
  console.error(
    `ERROR: --env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
      `Current SUPABASE_URL: ${supabaseUrl}\n` +
      'Override with explicit prod creds:\n' +
      `  SUPABASE_URL=https://${PROD_PROJECT_REF}.supabase.co \\\n` +
      '    SUPABASE_SERVICE_ROLE_KEY=<prod-svc-key> \\\n' +
      '    bun run scripts/wipe-bid-responses.ts --env=prod',
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// ── Prod confirmation prompt ───────────────────────────────────────────────

/**
 * For --env=prod, require the operator to type "wipe prod" verbatim before
 * any destructive call. Anything else exits 0 (cancelled).
 *
 * Skipped in dry-run mode (no destructive side effects).
 * Skipped in --convert mode (non-destructive — converts in-place).
 */
async function confirmProdWipe(): Promise<void> {
  if (DRY_RUN || CONVERT) return;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolveAnswer) => {
    rl.question(
      'WARNING: Wiping prod bid_responses. Type "wipe prod" to confirm: ',
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

// ── Count helper ───────────────────────────────────────────────────────────

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase
    .from(table)
    .select('*', { count: 'exact', head: true });

  if (error) {
    console.error(`ERROR counting ${table}: ${error.message}`);
    process.exit(1);
  }

  return count ?? 0;
}

// ── Convert path ───────────────────────────────────────────────────────────

async function convertResponses(): Promise<void> {
  // Dynamic import to avoid loading Turndown when not needed
  const { turndown } = await import('../lib/extraction/turndown');

  const { data: responses, error } = await supabase
    .from('bid_responses')
    .select('id, response_text, response_text_advanced');

  if (error) {
    console.error(`ERROR fetching bid_responses: ${error.message}`);
    process.exit(1);
  }

  if (!responses || responses.length === 0) {
    console.log('No bid responses to convert.');
    return;
  }

  console.log(`Found ${responses.length} bid responses to convert.`);

  let converted = 0;
  let skipped = 0;

  for (const row of responses) {
    const updates: Record<string, string | null> = {};
    let needsUpdate = false;

    // Convert response_text if it looks like HTML
    if (row.response_text && row.response_text.includes('<')) {
      updates.response_text = turndown.turndown(row.response_text);
      needsUpdate = true;
    }

    // Convert response_text_advanced if it looks like HTML
    if (row.response_text_advanced && row.response_text_advanced.includes('<')) {
      updates.response_text_advanced = turndown.turndown(
        row.response_text_advanced,
      );
      needsUpdate = true;
    }

    if (!needsUpdate) {
      skipped++;
      console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — skipped (not HTML)`);
      continue;
    }

    if (DRY_RUN) {
      converted++;
      console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — would convert`);
      continue;
    }

    const { error: updateError } = await supabase
      .from('bid_responses')
      .update(updates)
      .eq('id', row.id)
      .select();

    if (updateError) {
      console.error(`  ERROR updating ${row.id}: ${updateError.message}`);
      process.exit(1);
    }

    converted++;
    console.log(`  [${converted + skipped}/${responses.length}] ${row.id} — converted`);
  }

  const prefix = DRY_RUN ? '[DRY RUN] Would convert' : 'Converted';
  console.log(
    `\n${prefix} ${converted} responses. Skipped ${skipped} (already markdown/plain text).`,
  );
}

// ── Delete path ────────────────────────────────────────────────────────────

async function wipeResponses(): Promise<void> {
  const historyCount = await countRows('bid_response_history');
  const responseCount = await countRows('bid_responses');

  console.log(`bid_response_history: ${historyCount} rows`);
  console.log(`bid_responses: ${responseCount} rows`);

  const total = historyCount + responseCount;

  if (total === 0) {
    console.log('\nNo bid responses to wipe.');
    process.exit(0);
  }

  if (DRY_RUN) {
    console.log(
      `\n[DRY RUN] Would delete ${historyCount} history rows, ${responseCount} responses.`,
    );
    process.exit(0);
  }

  // Safety delay for destructive operations
  if (!SKIP_DELAY) {
    console.log(
      '\nWARNING: About to delete ALL bid responses. Press Ctrl-C to abort (5s)...',
    );
    await new Promise((r) => setTimeout(r, 5000));
  }

  // Delete in FK order: bid_response_history first, then bid_responses.
  // Both FKs are ON DELETE CASCADE, but explicit ordering gives accurate counts
  // and is defensive against schema changes.

  // 1. Delete bid_response_history
  // supabase-js v2 requires a filter on .delete() — use a tautological filter
  const { error: histError } = await supabase
    .from('bid_response_history')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();

  if (histError) {
    console.error(
      `ERROR deleting bid_response_history: ${histError.message}`,
    );
    console.error(
      'bid_responses were NOT deleted. Partial state: history deletion may have partially completed.',
    );
    process.exit(1);
  }

  // 2. Delete bid_responses (cascades content_citations via FK)
  const { error: respError } = await supabase
    .from('bid_responses')
    .delete()
    .gte('created_at', '1970-01-01')
    .select();

  if (respError) {
    console.error(`ERROR deleting bid_responses: ${respError.message}`);
    console.error(
      'bid_response_history was already deleted. Manual cleanup may be needed.',
    );
    process.exit(1);
  }

  console.log(
    `\nDeleted ${historyCount} history rows, ${responseCount} responses.`,
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Bid Response Wipe/Convert Script ===\n');
  console.log(`Env: ${ENV_FLAG}`);
  console.log(`Target: ${supabaseUrl}\n`);

  // Prod requires interactive confirmation before any destructive call.
  if (ENV_FLAG === 'prod') {
    await confirmProdWipe();
  }

  if (CONVERT) {
    console.log(`Mode: convert (HTML → markdown)${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
    await convertResponses();
  } else {
    console.log(`Mode: wipe${DRY_RUN ? ' [DRY RUN]' : ''}\n`);
    await wipeResponses();
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
