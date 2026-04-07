import { NextResponse } from 'next/server';
import type { Result } from './safe';
import { isOk } from './safe';

/**
 * Collects non-fatal warnings during a composite response.
 *
 * **PII warning.** Warning strings are surfaced to clients. Never embed
 * user-identifying data, personally identifiable information, or sensitive
 * error details (DB column names, raw SQL, internal IDs) in a warning
 * message. Keep them human-readable and operationally generic — e.g.
 * "Governance config could not be loaded — review trigger skipped" rather
 * than "SELECT failed on governance_config WHERE domain='security'".
 *
 * @example
 *   const warnings = createWarningsCollector();
 *
 *   const gov = await tryQuery(supabase.from('governance_config')...);
 *   if (!isOk(gov)) warnings.add('Governance config failed to load');
 *
 *   return warningsEnvelope({ success: true, item }, warnings);
 */
export interface WarningsCollector {
  add(message: string): void;
  addFromResult<T>(result: Result<T>, message: string): T | null;
  readonly list: readonly string[];
  readonly hasAny: boolean;
}

export function createWarningsCollector(): WarningsCollector {
  const warnings: string[] = [];
  return {
    add(message) {
      warnings.push(message);
    },
    /**
     * Unwrap a `Result<T>`. On success, returns the data. On error, pushes
     * a warning containing the error code and returns `null`.
     *
     * **PII warning.** The default warning format includes the error code
     * (e.g. "PGRST500"), which is safe to surface. Do NOT pass a `message`
     * argument that includes user data, IDs, or sensitive context — see the
     * collector-level PII warning above.
     */
    addFromResult<T>(result: Result<T>, message: string): T | null {
      if (isOk(result)) {
        return result.data;
      }
      // Include the error code in the warning for ops debugging
      warnings.push(`${message} (code: ${result.error.code ?? 'unknown'})`);
      return null;
    },
    get list() {
      return warnings;
    },
    get hasAny() {
      return warnings.length > 0;
    },
  };
}

/**
 * Shape of a composite-response envelope. All composite routes (>= 2
 * sub-queries) must return this shape so the UI can render a partial-
 * failure banner when warnings is present and non-empty.
 *
 * **`warnings` is a SIBLING of `data`'s fields, not a wrapper.** This
 * matches the canonical reference at `app/api/items/[id]/route.ts:419-423`
 * and preserves consumer compatibility — `team-section.tsx` and any other
 * existing reader of `data.warnings` keeps working without modification.
 *
 * The `warnings` field is only present in the serialised response when the
 * collector is non-empty (matching the canonical reference's
 * `if (warnings.length > 0)` guard). Consumers should treat the field as
 * optional: `const warnings = Array.isArray(data.warnings) ? data.warnings : [];`.
 */
export type WarningsEnvelope<T> = T & { warnings: readonly string[] };

/**
 * Wrap a composite response object by adding `warnings` as a sibling field
 * (only when non-empty), and return a `NextResponse` with HTTP 200. Status
 * is always 200 — if any sub-query failure is fatal, the caller should
 * throw before reaching here.
 *
 * **Non-breaking shape.** This helper does not wrap `data` in an outer
 * object. The returned response is `{ ...data }` when there are no
 * warnings, and `{ ...data, warnings: [...] }` when there are. Consumers
 * that already read `data.foo` continue to work; consumers that want to
 * render a banner read `data.warnings` exactly as the canonical reference
 * does.
 *
 * @example
 *   // Existing route (canonical reference shape preserved):
 *   return warningsEnvelope({ success: true, item }, warnings);
 *   // Serialises as { success: true, item: {...} } when warnings empty,
 *   // or { success: true, item: {...}, warnings: [...] } when non-empty.
 */
export function warningsEnvelope<T extends Record<string, unknown>>(
  data: T,
  warnings: WarningsCollector | readonly string[],
  init?: Omit<ResponseInit, 'status'>,
): NextResponse<WarningsEnvelope<T>> {
  const list = Array.isArray(warnings)
    ? warnings
    : (warnings as WarningsCollector).list;
  // Match canonical reference at app/api/items/[id]/route.ts:419-423 —
  // only include `warnings` in the response when non-empty.
  const body: Record<string, unknown> = { ...data };
  if (list.length > 0) {
    body.warnings = list;
  }
  return NextResponse.json(body as WarningsEnvelope<T>, {
    ...init,
    status: 200,
  });
}
