#!/usr/bin/env bun
/**
 * task-view-drift-age.ts — CLI wrapper around computeDriftAge() (ID-157).
 *
 * Usage:
 *   bun scripts/task-view-drift-age.ts --tag-bump-date <ISO> --vendor-sync-date <ISO>
 *
 * Prints a single JSON line `{ageDays, tier, message}` to stdout. Consumed by
 * the primitive-drift step of `.github/workflows/task-view-vendor-drift.yml`
 * to tier a sticky PR comment. This script exits 1 only on a genuine
 * usage/input error (missing or unparseable flags) — the calling workflow
 * step already treats the whole call as best-effort (`|| echo '{}'`), so a
 * non-zero exit here never blocks the (non-blocking, OQ-T2) workflow.
 */

import { computeDriftAge } from './lib/task-view-drift-age';

function readFlag(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  if (idx === -1 || idx === process.argv.length - 1) return undefined;
  return process.argv[idx + 1];
}

function main(): void {
  const tagBumpDate = readFlag('--tag-bump-date');
  const vendorSyncDate = readFlag('--vendor-sync-date');

  if (!tagBumpDate || !vendorSyncDate) {
    console.error(
      'Usage: bun scripts/task-view-drift-age.ts --tag-bump-date <ISO> --vendor-sync-date <ISO>',
    );
    process.exit(1);
  }

  const result = computeDriftAge(tagBumpDate, vendorSyncDate);
  console.log(JSON.stringify(result));
}

main();
