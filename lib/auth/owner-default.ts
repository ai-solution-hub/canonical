/**
 * Resolve the `content_owner_id` to write at an ingest entry point.
 *
 * Spec: ingest-path-consistency-spec.md §3.3 (AC3.1).
 *
 * Behaviour (silent-force pattern, mirrors `skip_dedup`):
 *   - Admin caller + explicit override   → use the explicit UUID
 *   - Non-admin caller + explicit override → silently force to caller's userId
 *   - No explicit override                 → use caller's userId
 *
 * The helper never throws; callers always receive a valid UUID string.
 *
 * The `explicit` field is whatever the caller submitted on the request body
 * (Zod-coerced to `string | undefined` upstream). `null` is treated the same
 * as `undefined` because some callers submit explicit nulls to mean "no
 * override".
 */
export function resolveContentOwnerId({
  explicit,
  role,
  userId,
}: {
  explicit: string | null | undefined;
  role: string;
  userId: string;
}): string {
  const adminOverride = explicit && role === 'admin' ? explicit : null;
  return adminOverride ?? userId;
}
