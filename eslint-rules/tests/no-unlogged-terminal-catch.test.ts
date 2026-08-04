import rule from '../no-unlogged-terminal-catch.js';
import noUncheckedSupabaseError from '../no-unchecked-supabase-error.js';
import noSilentPromiseCatch from '../no-silent-promise-catch.js';
import { RuleTester } from 'eslint';

// RuleTester uses Mocha-style describe/it globals; vitest provides them when
// `globals: true` is set in vitest.config.ts (which it is for this repo).

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
  },
});

/**
 * Invalid fixtures below reproduce PRE-FIX shapes verbatim from the tree's
 * history, so the rule provably catches the class it was built for
 * (id-369 {369.6}):
 *  - `regeneratePreFix` — app/api/procurement/[id]/responses/[rId]/
 *    regenerate/route.ts before its S501-era fix (500 body carries only
 *    `safeErrorMessage`'s fallback, nothing reaches the server log).
 *  - `sseStreamPreFix` — draft-stream's inner catch before the same fix
 *    (SSE `event: error` with no server-side trace).
 *  - `governancePreFix` — the F1 outer catch as it stood before S496
 *    (`15d64957~1`, app/api/governance/review/route.ts).
 */
const regeneratePreFix =
  'async function POST() { try { return NextResponse.json({ ok: true }); } catch (err) { return NextResponse.json({ error: safeErrorMessage(err, "Failed to regenerate response") }, { status: 500 }); } }';

const sseStreamPreFix =
  'function start(send) { try { send("done", {}); } catch (err) { send("error", { error: safeErrorMessage(err, "Streaming draft failed") }); } }';

const governancePreFix =
  'async function POST() { try { return NextResponse.json({ success: true }); } catch (err) { return NextResponse.json({ error: safeErrorMessage(err, "Failed to process governance review") }, { status: 500 }); } }';

ruleTester.run('no-unlogged-terminal-catch', rule as never, {
  valid: [
    // Post-fix regenerate shape: log BEFORE narrowing, then respond.
    {
      code: 'async function POST() { try { return NextResponse.json({ ok: true }); } catch (err) { logger.error({ err, op: "response_regenerate" }, "Regenerate failed"); return NextResponse.json({ error: safeErrorMessage(err, "Failed") }, { status: 500 }); } }',
    },
    // Post-fix SSE shape: log, then emit the client-safe error event.
    {
      code: 'function start(send) { try { send("done", {}); } catch (err) { logger.error({ err, op: "draft_stream" }, "Streaming draft failed"); send("error", { error: safeErrorMessage(err, "Streaming draft failed") }); } }',
    },
    // Sanctioned telemetry helper counts as logging.
    {
      code: 'async function f() { try { await g(); } catch (err) { logBestEffortWarn("governance.review.notify", "notify failed", { err }); return NextResponse.json({ ok: false }, { status: 500 }); } }',
    },
    // Sentry counts as logging (member and direct-import forms).
    {
      code: 'async function f() { try { await g(); } catch (err) { Sentry.captureException(err); return NextResponse.json({ error: "x" }, { status: 500 }); } }',
    },
    {
      code: 'async function f() { try { await g(); } catch (err) { captureException(err); return new Response("x", { status: 500 }); } }',
    },
    // console.error counts (no-console governs its own surface separately).
    {
      code: 'async function f() { try { await g(); } catch (err) { console.error(err); return new Response(JSON.stringify({ error: "x" }), { status: 500 }); } }',
    },
    // Rethrow is an escape — an outer frame can still see the error.
    {
      code: 'async function f() { try { await g(); } catch (err) { throw err; } }',
    },
    // Conditional rethrow still counts as an escape.
    {
      code: 'async function f() { try { await g(); } catch (err) { if (isCritical(err)) throw err; return NextResponse.json({ error: "x" }, { status: 500 }); } }',
    },
    // Logging catch with NO client response (pre-S496 inner F1 catch) —
    // not terminal, and it logs. Doubly out of scope.
    {
      code: 'async function f() { try { await g(); } catch (err) { logger.warn({ err }, "Failed to create governance notification"); } }',
    },
    // Local degrade — a checked Result / null return is an outer frame's
    // problem, deliberately NOT this rule's business.
    {
      code: 'async function f() { try { return await g(); } catch (err) { return null; } }',
    },
    {
      code: 'async function f() { try { return await g(); } catch (err) { return { ok: false, error: err }; } }',
    },
    // `_err` opt-out — deliberate swallow, intent visible.
    {
      code: 'async function f() { try { await g(); } catch (_err) { return NextResponse.json({ error: "gone" }, { status: 410 }); } }',
    },
    // Helper-built response — unrecognisable as terminal; the helper may
    // log, so the rule stays silent by design.
    {
      code: 'async function f() { try { await g(); } catch (err) { return errorResponse(err); } }',
    },
    // `logX(...)` helper counts as logging.
    {
      code: 'async function f() { try { await g(); } catch (err) { logError(err); return NextResponse.json({ error: "x" }, { status: 500 }); } }',
    },
    // Logging from inside a nested callback still counts (lenient direction).
    {
      code: 'async function f() { try { await g(); } catch (err) { queueMicrotask(() => logger.error({ err }, "failed")); return NextResponse.json({ error: "x" }, { status: 500 }); } }',
    },
    // A terminal response inside a NESTED function is not this catch
    // answering the client — out of scope.
    {
      code: 'async function f() { try { await g(); } catch (err) { logger.error({ err }, "x"); const h = () => NextResponse.json({ error: "y" }, { status: 500 }); return h(); } }',
    },
    // `send` with a non-'error' event is not the SSE error shape.
    {
      code: 'function start(send) { try { send("done", {}); } catch (err) { send("progress", { done: true }); throw err; } }',
    },
    // NextResponse.redirect — control flow, not error narrowing; different
    // class, deliberately not covered.
    {
      code: 'async function f() { try { await g(); } catch (err) { return NextResponse.redirect(loginUrl); } }',
    },
    // Checked-Result degrade (lib/validation `parseBody`): the response is
    // WRAPPED, the caller decides — and here the error detail is passed
    // through, not narrowed away. The ledger's own carve-out.
    {
      code: 'function parse(schema, body) { try { return { success: true, data: schema.parse(body) }; } catch (err) { return { success: false, response: NextResponse.json({ error: "Validation failed", details: err.issues }, { status: 400 }) }; } }',
    },
    // `new Response(...)` as a stub VALUE, not answering a client
    // (feed-poller's HEAD preflight fallback) — measured false positive of
    // the anywhere-in-body gate, pinned here against regression.
    {
      code: 'async function probe(url) { let preflight; try { preflight = await fetch(url); } catch { preflight = new Response(null, { status: 200 }); } return preflight; }',
    },
  ],

  invalid: [
    // The recorded class instances, pre-fix shapes (see header note).
    {
      code: regeneratePreFix,
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    { code: sseStreamPreFix, errors: [{ messageId: 'unloggedTerminalCatch' }] },
    {
      code: governancePreFix,
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // draft-stream's OUTER catch shape: `new Response(...)` with a 500 body.
    {
      code: 'async function POST() { try { return new Response(stream); } catch (err) { return new Response(JSON.stringify({ error: safeErrorMessage(err, "Failed to start streaming draft") }), { status: 500, headers: { "Content-Type": "application/json" } }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // Omitted binding is NOT an opt-out: at a terminal boundary an unbound
    // error cannot even be logged — the worst version of the shape.
    {
      code: 'async function POST() { try { return NextResponse.json({ ok: true }); } catch { return NextResponse.json({ error: "Internal error" }, { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // Narrowing via an intermediate variable is still the same shape.
    {
      code: 'async function POST() { try { return NextResponse.json({ ok: true }); } catch (err) { const message = safeErrorMessage(err, "Failed"); return NextResponse.json({ error: message }, { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // Static Response.json.
    {
      code: 'async function POST() { try { return Response.json({ ok: true }); } catch (err) { return Response.json({ error: "x" }, { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // Bound-but-unused (non-underscore) param + member-form SSE emit.
    {
      code: 'function start(stream) { try { stream.send("done", {}); } catch (error) { stream.send("error", { message: "failed" }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // `new NextResponse(...)` construction.
    {
      code: 'async function GET() { try { return new NextResponse(body); } catch (err) { return new NextResponse("Internal error", { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // A `logger` that is referenced but never CALLED does not count.
    {
      code: 'async function POST() { try { return NextResponse.json({ ok: true }); } catch (err) { const l = logger; return NextResponse.json({ error: "x" }, { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
    // Ternary return — either branch constructing the response counts.
    {
      code: 'async function POST() { try { return NextResponse.json({ ok: true }); } catch (err) { return isTimeout(err) ? NextResponse.json({ error: "timeout" }, { status: 504 }) : NextResponse.json({ error: "x" }, { status: 500 }); } }',
      errors: [{ messageId: 'unloggedTerminalCatch' }],
    },
  ],
});

/**
 * Proof-of-gap, pinned executable ({369.6} / the S502 ruling): NEITHER
 * existing silent-failure rule reaches this class, so a third rule is a
 * genuine requirement, not a widening of either.
 *  - `no-unchecked-supabase-error` gates every visitor on a `.from()`/`.rpc()`
 *    PostgREST chain; these shapes contain no Supabase call at all.
 *  - `no-silent-promise-catch` visits only `.catch()` CallExpressions with a
 *    zero-parameter handler; these are CatchClause nodes with a bound, USED
 *    param.
 * A `valid` RuleTester case asserts zero reports, so if either rule ever
 * grows to cover the shape, this pin fails and {369.6}'s rationale must be
 * re-examined.
 */
ruleTester.run(
  'no-unchecked-supabase-error (proof-of-gap: blind to the terminal-catch class)',
  noUncheckedSupabaseError as never,
  {
    valid: [{ code: regeneratePreFix }, { code: sseStreamPreFix }],
    invalid: [],
  },
);

ruleTester.run(
  'no-silent-promise-catch (proof-of-gap: blind to the terminal-catch class)',
  noSilentPromiseCatch as never,
  {
    valid: [{ code: regeneratePreFix }, { code: sseStreamPreFix }],
    invalid: [],
  },
);
