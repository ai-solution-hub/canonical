export interface FreshnessSummary {
  fresh: number;
  aging: number;
  stale: number;
  expired: number;
}

export interface ReorientFirstLoginInput {
  last_active_at: string | null;
  my_recent_work: readonly unknown[];
  team_changes: readonly unknown[];
}

export function deriveIsKBEmpty(freshness: FreshnessSummary): boolean {
  return (
    freshness.fresh + freshness.aging + freshness.stale + freshness.expired ===
    0
  );
}

export function deriveIsFirstLogin(reorient: ReorientFirstLoginInput): boolean {
  return (
    !reorient.last_active_at &&
    reorient.my_recent_work.length === 0 &&
    reorient.team_changes.length === 0
  );
}
