/**
 * eval-register-suites — bootstrap registration + suite dispatch map.
 *
 * This module owns two responsibilities (T23 / {104.14} / B-INV-23):
 *
 *   1. **Bootstrap registration** (`registerAllSuites`): idempotently registers
 *      all known eval suites as touchpoints in `eval_touchpoints` (M1). Run once
 *      at environment setup time (or via `bun run scripts/eval-register-suites.ts`
 *      with `--register`). Safe to re-run — `registerTouchpoint` is a no-op when
 *      the contract is unchanged (B-INV-5).
 *
 *   2. **Suite dispatch map** (`buildSuiteRegistry`): returns the `SuiteRegistry`
 *      the central `eval-runner` `main()` populates its `suites` option with. Each
 *      entry maps a `suite_name` to the suite's `runAsEvalSuite` adapter (the
 *      function that runs the checks and returns a `SuiteRunOutcome`).
 *
 * Suites registered (10 total):
 *   — 3 mcp-eval suites:   l1 (protocol-compliance), l3 (response-quality),
 *                           l4 (functional-correctness)
 *   — 7 legacy eval suites: classification, entity-classification,
 *                           holder-rule-ts, procurement-drafting, search,
 *                           summarisation, tag-morphology-adoption
 *
 * Contract field choices (per TECH §T23 / §Contract / B-INV-23):
 *   - mcp-eval suites: kind='tool' (they exercise MCP tools end-to-end),
 *     grounding_shape='structured_output', severity_on_fail='block' (CI-gating
 *     suites — a failure must fail the gate), variance_band=0.02.
 *   - legacy eval suites: kind='inline' (they run inside the codebase, not
 *     via an MCP protocol hop), grounding_shape='n/a' (no forced grounding —
 *     they test classification/search quality), severity_on_fail='warn' (legacy
 *     suites are not yet CI-blocking; an operator reviews regressions via
 *     /admin/refinement), variance_band=0.03 (slightly wider band for
 *     classification/search variance).
 *
 * No barrel re-export: import directly from `@/scripts/eval-register-suites`.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

import type { Database } from '@/supabase/types/database.types';
import type { AgentEvalContract } from '@/lib/eval/contract';
import { registerTouchpoint } from '@/lib/eval/registry';
import type { Touchpoint } from '@/lib/eval/registry';
import type { SuiteRegistry, SuiteRunOutcome } from '@/scripts/eval-runner';

// ---------------------------------------------------------------------------
// Suite contracts (T23 / B-INV-23)
// ---------------------------------------------------------------------------

/**
 * Bound `AgentEvalContract` for each registered suite. Declared here — not
 * inside the register fn — so the Zod validator catches a malformed contract
 * at module load time (before any DB access).
 */
const SUITE_CONTRACTS: readonly AgentEvalContract[] = [
  // ── mcp-eval suites (L1 / L3 / L4) ────────────────────────────────────
  {
    touchpoint_id: 'mcp-eval.l1',
    kind: 'tool',
    owner: 'platform-team',
    suite_name: 'l1',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
  },
  {
    touchpoint_id: 'mcp-eval.l3',
    kind: 'tool',
    owner: 'platform-team',
    suite_name: 'l3',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
  },
  {
    touchpoint_id: 'mcp-eval.l4',
    kind: 'tool',
    owner: 'platform-team',
    suite_name: 'l4',
    grounding_shape: 'structured_output',
    severity_on_fail: 'block',
    variance_band: 0.02,
  },
  // ── legacy eval suites ──────────────────────────────────────────────────
  {
    touchpoint_id: 'eval.classification',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'classification',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.entity-classification',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'entity-classification',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.holder-rule-ts',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'holder-rule-ts',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.procurement-drafting',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'procurement-drafting',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.search',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'search',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.summarisation',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'summarisation',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
  {
    touchpoint_id: 'eval.tag-morphology-adoption',
    kind: 'inline',
    owner: 'platform-team',
    suite_name: 'tag-morphology-adoption',
    grounding_shape: 'n/a',
    severity_on_fail: 'warn',
    variance_band: 0.03,
  },
] as const;

// ---------------------------------------------------------------------------
// Bootstrap registration
// ---------------------------------------------------------------------------

/**
 * Register all eval suites as touchpoints in `eval_touchpoints` (T23 /
 * B-INV-23). Idempotent: `registerTouchpoint` is a no-op when the contract
 * is unchanged (B-INV-5). Safe to re-run at any time.
 *
 * Intended call sites:
 *   - `bun run scripts/eval-register-suites.ts --register` (one-off bootstrap)
 *   - CI seed step (before the nightly runner dispatches)
 *
 * Throws on any registration failure (PK conflict with a mismatched contract,
 * DB-unreachable) so the caller can surface the error loudly (T4).
 */
export async function registerAllSuites(
  supabase: SupabaseClient<Database>,
): Promise<void> {
  for (const contract of SUITE_CONTRACTS) {
    await registerTouchpoint(supabase, contract);
  }
}

/** The list of suite contracts (read-only), exposed for tests. */
export const REGISTERED_SUITE_CONTRACTS: readonly AgentEvalContract[] =
  SUITE_CONTRACTS;

// ---------------------------------------------------------------------------
// Suite dispatch map — maps suite_name → SuiteFn for eval-runner
// ---------------------------------------------------------------------------

/**
 * Placeholder suite fn for legacy `scripts/eval-*.ts` suites.
 *
 * The 7 legacy suites run in process (long-running, require env vars,
 * expensive Anthropic calls on some modes). The dispatch map carries them as
 * `SuiteFn` entries for the runner to call; in the nightly lane they run for
 * real. In the unit-test context the suite registry is mocked at the
 * `buildSuiteRegistry()` call site (never touching Anthropic).
 *
 * Each legacy suite's `main()` calls `process.exit` — these adapters call the
 * suite's internal logic without process.exit (same pattern as the mcp-eval
 * `runAsEvalSuite` adapters). The legacy suite adapters are thin: they import
 * the suite's top-level `runSuiteForRunner` export (added by {104.14}) or, for
 * suites without one yet, return an infra-skip result. Concrete adapters land
 * incrementally as each legacy suite is re-pointed per the DB-cutover plan
 * (TECH §Risk: "file path removed only after every suite is re-pointed and
 * the nightly lane is green").
 *
 * For the bootstrap Subtask ({104.14}) scope, the 7 legacy suites are
 * REGISTERED as touchpoints (the registry rows exist + their contracts are
 * bound) but their suite fns return a stable `infra`-skip until a follow-on
 * Subtask wires each one to a real `runSuiteForRunner` export. The runner
 * treats an `infra` outcome as could-not-complete (exit 2), which is correct
 * for a not-yet-wired suite — it is NOT a quality regression.
 */
function legacySuiteFn(
  suiteName: string,
): (tp: Touchpoint) => Promise<SuiteRunOutcome> {
  return async (_tp: Touchpoint): Promise<SuiteRunOutcome> => ({
    ok: false,
    kind: 'infra',
    reason: `${suiteName}: legacy suite not yet wired to eval-runner (re-point pending DB-cutover)`,
  });
}

/**
 * Build the `SuiteRegistry` the central eval-runner `main()` injects into
 * `runEvals`. Each key is a `suite_name` matching a registered touchpoint row
 * in `eval_touchpoints`; the value is the async suite fn that runs the checks
 * and returns a `SuiteRunOutcome`.
 *
 * The three mcp-eval suites have full adapters (`runAsEvalSuite` exported from
 * their module). The seven legacy suites carry placeholder infra-skip fns until
 * each is re-pointed per the DB-cutover plan.
 */
export function buildSuiteRegistry(): SuiteRegistry {
  return {
    // mcp-eval suites — full adapters via {104.14} wiring
    l1: async (tp) => {
      const { runAsEvalSuite } =
        await import('@/scripts/mcp-eval/protocol-compliance');
      void tp; // suite_name selects the fn; Touchpoint fields used by runner
      return runAsEvalSuite();
    },
    l3: async (tp) => {
      const { runAsEvalSuite } =
        await import('@/scripts/mcp-eval/response-quality');
      void tp;
      return runAsEvalSuite();
    },
    l4: async (tp) => {
      const { runAsEvalSuite } =
        await import('@/scripts/mcp-eval/functional-correctness');
      void tp;
      return runAsEvalSuite();
    },
    // legacy suites — registered, placeholder infra-skip until DB-cutover
    classification: legacySuiteFn('classification'),
    'entity-classification': legacySuiteFn('entity-classification'),
    'holder-rule-ts': legacySuiteFn('holder-rule-ts'),
    'procurement-drafting': legacySuiteFn('procurement-drafting'),
    search: legacySuiteFn('search'),
    summarisation: legacySuiteFn('summarisation'),
    'tag-morphology-adoption': legacySuiteFn('tag-morphology-adoption'),
  };
}

// ---------------------------------------------------------------------------
// Direct CLI entry point (--register mode)
// ---------------------------------------------------------------------------

/**
 * When run directly (`bun run scripts/eval-register-suites.ts --register`),
 * registers all suite contracts against the staging Supabase instance.
 * Exits 0 on success, 1 on error (no 0/1/2 runner exit — this is a bootstrap
 * utility, not the runner itself).
 */
if (import.meta.main) {
  (async () => {
    const { createClient } = await import('@supabase/supabase-js');

    const url =
      process.env['NEXT_PUBLIC_SUPABASE_URL'] ?? process.env['SUPABASE_URL'];
    const key = process.env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !key) {
      console.error(
        'eval-register-suites: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
      );
      process.exit(1);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = createClient<any>(url, key, {
      auth: { persistSession: false },
    });

    console.log(`Registering ${SUITE_CONTRACTS.length} eval suites…`);
    try {
      await registerAllSuites(supabase);
      console.log('Done — all suites registered (or already up-to-date).');
    } catch (err) {
      console.error(
        'Registration failed:',
        err instanceof Error ? err.message : String(err),
      );
      process.exit(1);
    }
  })().catch((err: unknown) => {
    console.error(
      'eval-register-suites: fatal error:',
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  });
}
