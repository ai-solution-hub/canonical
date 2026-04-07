import type { PostgrestError, PostgrestSingleResponse } from '@supabase/supabase-js';

/**
 * Branded error class thrown by `sb()` on any Supabase failure.
 * Distinguishable from generic `Error` so error handlers can route it.
 *
 * The `cause` field carries the original PostgrestError for debugging;
 * the `code` field mirrors `PostgrestError.code` for convenience.
 */
export class SupabaseError extends Error {
  readonly name = 'SupabaseError';
  readonly code: string | undefined;
  readonly details: string | undefined;
  readonly hint: string | undefined;
  readonly status: number | undefined;

  constructor(cause: PostgrestError, context?: string) {
    const prefix = context ? `[${context}] ` : '';
    super(`${prefix}${cause.message}`);
    this.code = cause.code;
    this.details = cause.details;
    this.hint = cause.hint;
    this.cause = cause;
  }
}

/**
 * Awaitable whose resolved shape is a PostgrestSingleResponse.
 *
 * `T` is the resolved data shape:
 *   - array (e.g. `ContentItem[]`) for plain `select()`;
 *   - single object (e.g. `ContentItem`) for `.single()`;
 *   - `T | null` for `.maybeSingle()`.
 *
 * `PostgrestResponse<T>` is a derived alias `PostgrestSingleResponse<T[]>`
 * (see `node_modules/@supabase/postgrest-js/dist/index.d.mts:594`), so the
 * single-branch signature below covers both array selects and single-row
 * queries — there are not two separate response shapes to union over.
 */
type PostgrestLike<T> = PromiseLike<PostgrestSingleResponse<T>>;

/**
 * Fail-fast query wrapper. Resolves to `data` on success (non-null after
 * error check) and throws `SupabaseError` on any `error` field.
 *
 * **Use this by default.** Routes that legitimately want partial-failure
 * semantics should use `tryQuery` instead.
 *
 * **Migration note:** `sb()` throws on PostgREST code `PGRST116` ("no rows
 * found") because `.single()` surfaces zero-row results as an error. Use
 * `.maybeSingle()` when "no rows" is an expected outcome (it returns
 * `data: null` with no error), or use `tryQuery` and branch on
 * `error.code === 'PGRST116'` if you need to distinguish "not found" from
 * other failure modes.
 *
 * @example
 *   // Plain select — `items` is `ContentItem[]`, never null.
 *   const items = await sb(
 *     supabase.from('content_items').select('id, title').in('id', ids),
 *     'content_items.byId',
 *   );
 *
 * @example
 *   // .single() — `item` is `ContentItem`, throws on PGRST116.
 *   // Use .maybeSingle() (see below) if "no rows" is expected.
 *   const item = await sb(
 *     supabase.from('content_items').select().eq('id', id).single(),
 *     'content_items.detail',
 *   );
 *
 * @example
 *   // .maybeSingle() — `profile` is `Profile | null`. Caller MUST handle null.
 *   const profile = await sb(
 *     supabase.from('profiles').select().eq('id', userId).maybeSingle(),
 *     'profiles.byId',
 *   );
 *   if (!profile) return notFoundResponse();
 *
 * @example
 *   // .rpc() — sb() covers RPC return types via the same wrapper. Pass an
 *   // explicit generic when the generated types do not infer the return
 *   // shape automatically.
 *   const summary = await sb<DashboardSummary>(
 *     supabase.rpc('get_dashboard_summary', { user_id: userId }),
 *     'rpc.dashboard_summary',
 *   );
 */
export async function sb<T>(
  query: PostgrestLike<T>,
  context?: string,
): Promise<T> {
  const result = await query;
  if (result.error) {
    throw new SupabaseError(result.error, context);
  }
  // Non-null assertion is safe: PostgREST contract guarantees
  // `data` is non-null when `error` is null.
  return result.data as T;
}

/**
 * Result type returned by `tryQuery`. Discriminated by `ok` so callers
 * cannot read `data` without first checking the branch.
 */
export type Result<T, E = SupabaseError> =
  | { ok: true; data: T }
  | { ok: false; error: E };

/**
 * Partial-failure query wrapper. Returns a discriminated `Result` so the
 * caller must branch on `ok` before reading `data`.
 *
 * Use this in composite responses where one sub-query failing should
 * degrade gracefully (push to `warnings`) rather than fail the whole
 * response.
 *
 * @example
 *   // .single() — Result<GovernanceConfig, SupabaseError>. Use this when
 *   // you need to distinguish PGRST116 ("no rows") from other errors.
 *   const govResult = await tryQuery(
 *     supabase.from('governance_config').select('*').eq('domain', d).single(),
 *     'governance_config.byDomain',
 *   );
 *   if (!govResult.ok) {
 *     if (govResult.error.code === 'PGRST116') {
 *       warnings.push('No governance config for this domain — using defaults');
 *     } else {
 *       warnings.push('Governance config could not be loaded');
 *     }
 *   } else if (govResult.data.posture === 'review_on_change') {
 *     // ...
 *   }
 *
 * @example
 *   // .maybeSingle() — Result<Profile | null, SupabaseError>. The success
 *   // branch can still be `null` (no row found), so callers must handle
 *   // both the failure case AND the null-data case.
 *   const profileResult = await tryQuery(
 *     supabase.from('profiles').select().eq('id', userId).maybeSingle(),
 *     'profiles.byId',
 *   );
 *   if (!profileResult.ok) {
 *     warnings.push('Profile lookup failed');
 *   } else if (!profileResult.data) {
 *     warnings.push('No profile for user — onboarding incomplete');
 *   } else {
 *     // profileResult.data is Profile here
 *   }
 *
 * @example
 *   // .rpc() — Result wraps the same RPC return type that `sb()` would.
 *   const summaryResult = await tryQuery<DashboardSummary>(
 *     supabase.rpc('get_dashboard_summary', { user_id: userId }),
 *     'rpc.dashboard_summary',
 *   );
 */
export async function tryQuery<T>(
  query: PostgrestLike<T>,
  context?: string,
): Promise<Result<T, SupabaseError>> {
  try {
    const result = await query;
    if (result.error) {
      return { ok: false, error: new SupabaseError(result.error, context) };
    }
    return { ok: true, data: result.data as T };
  } catch (err) {
    // Network failure / serialisation error — still a Supabase-domain failure
    // from the caller's perspective. Wrap in SupabaseError for a uniform API.
    const pgError = {
      message: err instanceof Error ? err.message : String(err),
      code: 'NETWORK_ERROR',
      details: '',
      hint: '',
    } as PostgrestError;
    return { ok: false, error: new SupabaseError(pgError, context) };
  }
}

/**
 * Type guard for `Result<T, E>` — lets callers narrow in conditionals.
 *
 * @example
 *   if (isOk(govResult)) { govResult.data; } // T
 *   else { govResult.error; } // SupabaseError
 */
export function isOk<T, E>(
  result: Result<T, E>,
): result is { ok: true; data: T } {
  return result.ok === true;
}
