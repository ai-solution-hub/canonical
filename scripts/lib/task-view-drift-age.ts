/**
 * task-view-drift-age.ts — pure drift-age tiering for the primitive-drift
 * escalation (ID-157).
 *
 * Compares the last time THIS repo's TASK_VIEW_TAG pin moved (a proxy for
 * "a newer upstream task-view release exists") against the last time
 * lib/ledger/'s vendored primitives were actually re-synced. A large gap
 * between the two is the exact failure mode from bl-464/ID-148.12: the
 * task-view-vendor-drift.yml primitive-drift step warned via ::warning::
 * for ~5 upstream releases before the {148.12} re-vendor caught up.
 *
 * Non-blocking (OQ-T2): this module only produces a severity TIER for a
 * louder Step Summary entry / sticky PR comment — it never gates the build.
 * The day thresholds are a pragmatic judgment call, not a spec invariant:
 * ~45 days approximates one release cycle; ~120 days approximates the
 * "~5 releases" observed drift window that preceded {148.12}.
 */

export type DriftAgeTier = 'in-sync' | 'notice' | 'warning' | 'critical';

export interface DriftAgeResult {
  ageDays: number;
  tier: DriftAgeTier;
  message: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOTICE_THRESHOLD_DAYS = 45;
const WARNING_THRESHOLD_DAYS = 120;

function parseDateOrThrow(label: string, value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new RangeError(
      `computeDriftAge: invalid ${label} date input "${value}"`,
    );
  }
  return parsed;
}

/**
 * @param tagBumpDate ISO date string — the commit date of the last change
 *   that touched the workflow file pinning `TASK_VIEW_TAG` (proxy for "the
 *   pin last moved").
 * @param vendorSyncDate ISO date string — the commit date of the last
 *   change under `lib/ledger/` (proxy for "the primitives were last
 *   re-vendored").
 */
export function computeDriftAge(
  tagBumpDate: string,
  vendorSyncDate: string,
): DriftAgeResult {
  const tagBump = parseDateOrThrow('tag-bump', tagBumpDate);
  const vendorSync = parseDateOrThrow('vendor-sync', vendorSyncDate);

  // Staleness = how long the tag pin has led the last vendor sync. If the
  // vendor sync happened AT or AFTER the tag last moved, the primitives are
  // considered current (0 staleness) — a re-vendor commit naturally lands in
  // the same PR as (or after) its own tag bump.
  const rawAgeMs = tagBump.getTime() - vendorSync.getTime();
  const ageDays = Math.max(0, Math.round(rawAgeMs / MS_PER_DAY));

  if (ageDays === 0) {
    return {
      ageDays,
      tier: 'in-sync',
      message:
        'lib/ledger/ was synced at or after the last TASK_VIEW_TAG move — no staleness detected.',
    };
  }

  if (ageDays <= NOTICE_THRESHOLD_DAYS) {
    return {
      ageDays,
      tier: 'notice',
      message: `lib/ledger/ has been ${ageDays}d behind the last TASK_VIEW_TAG move — within one release cycle, worth a look.`,
    };
  }

  if (ageDays <= WARNING_THRESHOLD_DAYS) {
    return {
      ageDays,
      tier: 'warning',
      message: `lib/ledger/ has been ${ageDays}d behind the last TASK_VIEW_TAG move — re-vendor is overdue.`,
    };
  }

  return {
    ageDays,
    tier: 'critical',
    message: `lib/ledger/ has been ${ageDays}d behind the last TASK_VIEW_TAG move — comparable to the ~5-release drift that preceded {148.12}; re-vendor now.`,
  };
}
