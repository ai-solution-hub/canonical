#!/usr/bin/env bun
/**
 * One-shot CLI for §1.7 + §1.9 admin-dedup fixture management.
 *
 * Wraps the helpers in `e2e/fixtures/admin-dedup-fixture-helpers.ts` for
 * manual WP2 sessions (and ad-hoc cleanup). Playwright workers should use
 * the worker-scoped fixture instead — this CLI is for human-driven flows.
 *
 * Usage:
 *   bun run scripts/seed-admin-dedup-fixtures.ts                 # seed (default)
 *   bun run scripts/seed-admin-dedup-fixtures.ts --tag manual    # named run-id
 *   bun run scripts/seed-admin-dedup-fixtures.ts --cleanup       # delete by --tag
 *   bun run scripts/seed-admin-dedup-fixtures.ts --cleanup-all   # delete every run-id
 *   bun run scripts/seed-admin-dedup-fixtures.ts --cleanup-all --yes
 *   bun run scripts/seed-admin-dedup-fixtures.ts --dry-run --cleanup-all
 *   bun run scripts/seed-admin-dedup-fixtures.ts --help
 *
 * Exit codes:
 *   0 — success
 *   1 — env validation error
 *   2 — user aborted at confirmation prompt
 *   3 — verifier failure (seeded pairs don't match expected similarity)
 *
 * Reference: `docs/audits/s213b-admin-dedup-fixtures-design.md` §6.1, §9.1.
 */

import { createInterface } from 'node:readline/promises';
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { type SupabaseClient } from '@supabase/supabase-js';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import {
  cleanupAdminDedupFixtures,
  cleanupAllAdminDedupFixtures,
  generateRunId,
  seedAdminDedupFixtures,
  verifySeededPairs,
} from '@/e2e/fixtures/admin-dedup-fixture-helpers';

// ---------------------------------------------------------------------------
// Env loading — search up to 5 levels for .env / .env.local
// ---------------------------------------------------------------------------

function findProjectRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 5; i += 1) {
    try {
      const result = config({ path: resolve(dir, '.env') });
      if (!result.error) return dir;
    } catch {
      /* continue searching */
    }
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
config({ path: resolve(projectRoot, '.env') });
config({ path: resolve(projectRoot, '.env.local'), override: true });

// ---------------------------------------------------------------------------
// CLI flag parsing — minimal argv walk (no external libs per design constraint)
// ---------------------------------------------------------------------------

interface CliArgs {
  help: boolean;
  cleanup: boolean;
  cleanupAll: boolean;
  dryRun: boolean;
  yes: boolean;
  tag: string | null;
}

function parseArgs(argv: readonly string[]): CliArgs {
  const args: CliArgs = {
    help: false,
    cleanup: false,
    cleanupAll: false,
    dryRun: false,
    yes: false,
    tag: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case '--help':
      case '-h':
        args.help = true;
        break;
      case '--cleanup':
        args.cleanup = true;
        break;
      case '--cleanup-all':
        args.cleanupAll = true;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--yes':
      case '-y':
        args.yes = true;
        break;
      case '--tag': {
        const next = argv[i + 1];
        if (!next || next.startsWith('--')) {
          throw new Error('--tag requires a value (e.g. --tag manual)');
        }
        args.tag = next;
        i += 1;
        break;
      }
      default:
        if (arg.startsWith('--tag=')) {
          args.tag = arg.slice('--tag='.length);
        } else {
          throw new Error(`Unknown argument: ${arg}`);
        }
    }
  }

  return args;
}

function printHelp(): void {
  console.log(`
seed-admin-dedup-fixtures — manage §1.7 + §1.9 admin-dedup E2E fixtures

Usage:
  bun run scripts/seed-admin-dedup-fixtures.ts [options]

Default action: seed (idempotent on the same --tag).

Options:
  --tag <name>      Override the auto-generated run-id (e.g. "manual").
                    Idempotent re-seed pre-sweeps existing rows on the same tag.
  --cleanup         Delete only the rows tagged with --tag (or the latest run-id).
  --cleanup-all     Delete every row tagged with any e2e_dedup_fixture_run_id.
                    Requires --yes for non-interactive use.
  --dry-run         Print preview only — never deletes (independent of --yes).
  --yes, -y         Skip the interactive confirmation prompt.
  --help, -h        Show this message and exit.

Exit codes:
  0  success
  1  env validation error
  2  user aborted at confirmation prompt
  3  verifier failure (seeded pairs don't match expected similarity)

Reference: docs/audits/s213b-admin-dedup-fixtures-design.md §6.1.
`);
}

// ---------------------------------------------------------------------------
// Env validation
// ---------------------------------------------------------------------------

function validateEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.error(
      'FATAL: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.\n' +
        'Ensure .env.local is loaded or these are set in the environment.',
    );
    process.exit(1);
  }

  return { url, key };
}

// ---------------------------------------------------------------------------
// Confirmation prompt
// ---------------------------------------------------------------------------

async function confirmInteractive(message: string): Promise<boolean> {
  // No TTY (e.g. CI without --yes) → safest default is "no".
  if (!process.stdin.isTTY) {
    console.error(
      'No TTY detected; pass --yes to confirm non-interactively or run from a terminal.',
    );
    return false;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await rl.question(`${message} [y/N] `);
    const trimmed = answer.trim().toLowerCase();
    return trimmed === 'y' || trimmed === 'yes';
  } finally {
    rl.close();
  }
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

async function operationSeed(
  supabase: SupabaseClient,
  args: CliArgs,
): Promise<void> {
  const runId = args.tag ?? generateRunId();

  console.log(`[seed] Starting seed with run-id=${runId}...`);
  console.log('[seed] Pre-sweeping any existing rows on the same run-id...');

  const data = await seedAdminDedupFixtures(supabase, runId);

  console.log(`[seed] Seeded ${data.allIds.length} content_items rows.`);
  console.log(
    '[seed] Verifying seeded pairs surface at expected similarities...',
  );

  try {
    await verifySeededPairs(supabase, data);
  } catch (err) {
    console.error(`[seed] Verifier failure:\n${(err as Error).message}`);
    process.exit(3);
  }

  console.log('[seed] Verification passed.');
  console.log('');
  console.log('Fixture summary:');
  console.log(`  run-id:                    ${data.runId}`);
  console.log(`  §1.7 queue pairs:          6 (12 rows)`);
  console.log(`  §1.9 near-dup pairs:       7 (14 rows)`);
  console.log(`  Total content_items rows:  ${data.allIds.length}`);
  console.log('');
  console.log('Visit:');
  console.log(
    `  /admin/content-dedup           — §1.7 queue (10 visible rows)`,
  );
  console.log(
    `  /admin/content-dedup/near-duplicates — §1.9 dashboard (5 X-domain pairs at 0.95 threshold)`,
  );
  console.log('');
  console.log(
    `Cleanup: bun run scripts/seed-admin-dedup-fixtures.ts --tag ${runId} --cleanup`,
  );
}

async function operationCleanup(
  supabase: SupabaseClient,
  args: CliArgs,
): Promise<void> {
  if (!args.tag) {
    console.error(
      'FATAL: --cleanup requires --tag <name> to identify which run-id to delete.\n' +
        'Use --cleanup-all to delete every fixture run.',
    );
    process.exit(1);
  }

  console.log(`[cleanup] Dry-run preview for run-id=${args.tag}...`);

  // Probe how many rows exist before any deletion happens.
  const { data: probe, error: probeErr } = await supabase
    .from('content_items')
    .select('id, title, dedup_status, primary_domain, created_at')
    .eq('metadata->>e2e_dedup_fixture_run_id', args.tag);

  if (probeErr) {
    console.error(`[cleanup] Probe failed: ${probeErr.message}`);
    process.exit(1);
  }

  const rows = probe ?? [];
  console.log(`[cleanup] Would delete ${rows.length} content_items rows.`);

  if (rows.length === 0) {
    console.log('[cleanup] Nothing to do.');
    return;
  }

  if (args.dryRun) {
    console.log('[cleanup] --dry-run set; no rows deleted.');
    return;
  }

  if (!args.yes) {
    const ok = await confirmInteractive(
      `Proceed to delete ${rows.length} content_items + cascading content_history rows for run-id=${args.tag}?`,
    );
    if (!ok) {
      console.log('[cleanup] Aborted by user.');
      process.exit(2);
    }
  }

  const counts = await cleanupAdminDedupFixtures(supabase, args.tag);
  console.log(
    `[cleanup] Deleted ${counts.deletedContentItems} content_items, ` +
      `${counts.deletedHistoryRows} content_history rows, ` +
      `${counts.deletedChunks} content_chunks rows.`,
  );
}

async function operationCleanupAll(
  supabase: SupabaseClient,
  args: CliArgs,
): Promise<void> {
  console.log('[cleanup-all] Dry-run preview for all fixture run-ids...');

  // Probe: list ALL fixture rows + group by run-id.
  const { data: probe, error: probeErr } = await supabase
    .from('content_items')
    .select('id, metadata, created_at')
    .not('metadata->e2e_dedup_fixture_run_id', 'is', null);

  if (probeErr) {
    console.error(`[cleanup-all] Probe failed: ${probeErr.message}`);
    process.exit(1);
  }

  const rows = probe ?? [];
  console.log(`[cleanup-all] Would delete ${rows.length} content_items rows.`);

  if (rows.length === 0) {
    console.log('[cleanup-all] Nothing to do.');
    return;
  }

  // Group + summarise by run-id.
  const byRunId = new Map<string, number>();
  for (const r of rows) {
    const runId =
      (r.metadata as Record<string, unknown> | null)?.[
        'e2e_dedup_fixture_run_id'
      ] ?? 'unknown';
    byRunId.set(runId as string, (byRunId.get(runId as string) ?? 0) + 1);
  }
  console.log('[cleanup-all] Run-id breakdown:');
  for (const [runId, count] of byRunId) {
    console.log(`  ${runId}: ${count} rows`);
  }

  if (args.dryRun) {
    console.log('[cleanup-all] --dry-run set; no rows deleted.');
    return;
  }

  if (!args.yes) {
    const ok = await confirmInteractive(
      `Proceed to delete ${rows.length} content_items rows across ${byRunId.size} run-ids?`,
    );
    if (!ok) {
      console.log('[cleanup-all] Aborted by user.');
      process.exit(2);
    }
  }

  const counts = await cleanupAllAdminDedupFixtures(supabase);
  console.log(
    `[cleanup-all] Deleted ${counts.deletedContentItems} content_items, ` +
      `${counts.deletedHistoryRows} content_history rows, ` +
      `${counts.deletedChunks} content_chunks rows.`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Argument error: ${(err as Error).message}`);
    console.error('Use --help for usage information.');
    process.exit(1);
  }

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Mutually-exclusive operations: --cleanup OR --cleanup-all OR seed.
  if (args.cleanup && args.cleanupAll) {
    console.error('FATAL: --cleanup and --cleanup-all are mutually exclusive.');
    process.exit(1);
  }

  const { url, key } = validateEnv();
  const supabase = createScriptClient(url, key);

  if (args.cleanupAll) {
    await operationCleanupAll(supabase, args);
    return;
  }

  if (args.cleanup) {
    await operationCleanup(supabase, args);
    return;
  }

  // Default: seed.
  await operationSeed(supabase, args);
}

main().catch((err: unknown) => {
  console.error('FATAL:', err);
  process.exit(1);
});
