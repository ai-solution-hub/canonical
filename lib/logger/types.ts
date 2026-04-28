/**
 * Public types for the structured logger.
 *
 * Separated from `index.ts` so that consumers (and tests) can import the
 * `RequestContext` type without dragging the runtime singleton along.
 *
 * Spec: docs/specs/structured-logging-spec.md §4.1, §4.2.
 */

/**
 * Per-request scope established at the API boundary (proxy + route wrapper)
 * and propagated through the request's call graph via AsyncLocalStorage.
 *
 * `requestId` is minted in `proxy.ts` from `crypto.randomUUID()` and echoed
 * back to the caller via the `x-request-id` response header for end-to-end
 * traceability.
 *
 * `userId` and `userRole` are populated lazily — anonymous traffic still has
 * a request ID, authenticated traffic gets the user attached once
 * `getAuthorisedClient()` resolves (Phase 2 wiring).
 */
export interface RequestContext {
  requestId: string;
  userId?: string;
  userRole?: string;
  route: string;
  method: string;
  startedAt: number;
}

/**
 * Standard log fields emitted on every line via the pino `mixin` hook
 * (when a request context is in scope). Caller-supplied fields are merged
 * on top.
 */
export interface LogContext {
  requestId?: string;
  userId?: string;
  userRole?: string;
  route?: string;
  method?: string;
  /** Operation name (e.g. `embedding.generate`, `classify.batch`). */
  op?: string;
  /** Arbitrary structured fields. */
  [key: string]: unknown;
}
