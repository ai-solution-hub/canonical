/**
 * keepAliveAfterResponse — register a fire-and-forget promise with the
 * serverless runtime so it survives the post-response freeze.
 *
 * WHY (id-127 {127.20} S555): the app→pipeline walk nudges are deliberately
 * fire-and-forget (`void fetch(...)`) so a slow or unreachable pipeline can
 * never block a user-facing response. On Vercel that pattern silently loses
 * the request: the function instance freezes the moment the response is
 * returned, the in-flight fetch dies, and neither `.then` nor `.catch` ever
 * runs — no walk, no warning. Proven live on Platform staging: a folder-drop
 * admit (202, 23:10:29Z) produced ZERO corresponding events in the Cloudflare
 * Access edge log.
 *
 * `after()` is Next's contract for exactly this: work that must be allowed to
 * complete after the response is sent. Registering the promise keeps the
 * instance alive until it settles without delaying the response. The promise
 * chain passed in must own its own errors (`.catch` attached) — `after()` is
 * a keep-alive, not an error boundary.
 */
import { after } from 'next/server';

export function keepAliveAfterResponse(promise: Promise<unknown>): void {
  try {
    after(promise);
  } catch {
    // `after()` throws outside a request scope (unit tests, scripts,
    // long-lived non-Vercel processes). The promise is already executing,
    // and in a long-lived process there is no freeze to outlive — the
    // pre-registration behaviour is already correct there. Swallowing keeps
    // every nudge site callable from any context.
  }
}
