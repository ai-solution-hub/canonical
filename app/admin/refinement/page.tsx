import { redirect } from 'next/navigation';
import { getAuthorisedClient } from '@/lib/auth';
import { metricFor, type GraduationMetricValue } from '@/lib/eval/graduation';
import { listTouchpoints } from '@/lib/eval/registry';
import { tryQuery } from '@/lib/supabase/safe';

/**
 * Admin Refinement Registry — stub-spine listing.
 *
 * Server component that gates on admin role, then renders the registered
 * touchpoint list alongside the current `registry_version`, per-touchpoint
 * unprocessed-signal count (from `ai_call_events`), and the current
 * graduation-metric value for touchpoints that declare one (T19/B-INV-19).
 *
 * Non-admins are redirected to /login (unauthenticated) or / (forbidden) —
 * no route leak. NOT in proxy.ts publicRoutes.
 *
 * The four per-touchpoint curl-able endpoints:
 *   GET /api/refinement/touchpoints/[id]/signals
 *   GET /api/refinement/touchpoints/[id]/patterns   (present-but-empty)
 *   GET /api/refinement/touchpoints/[id]/proposals  (present-but-empty)
 *   GET /api/refinement/touchpoints/[id]/version-history
 *
 * ID-104.16 — T20, T21, T22 / B-INV-20, B-INV-21, B-INV-22.
 * ID-104.18 — T19 / B-INV-19 (graduation metric surface wiring).
 * Spec: specs/id-104-eval-engine/TECH.md §T19, §T22.
 */
export default async function AdminRefinementPage() {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) {
    if (auth.reason === 'unauthenticated') redirect('/login');
    redirect('/');
  }
  const { supabase } = auth;

  // Fetch all registered touchpoints (ordered by touchpoint_id, stable surface).
  const touchpoints = await listTouchpoints(supabase);

  // Derive the current registry_version: max across all rows, 0 when empty.
  const registryVersion = touchpoints.reduce(
    (max, tp) => Math.max(max, tp.registry_version),
    0,
  );

  // Fetch per-touchpoint unprocessed-signal counts in one query.
  // "Unprocessed" = all ai_call_events not yet consumed by the deferred
  // pattern-detector organ (T24). Since patterns are deferred, this is the
  // total count per touchpoint.
  const signalCountResult = await tryQuery(
    supabase.from('ai_call_events').select('touchpoint_id'),
    'refinement.signalCounts',
  );

  const signalCountMap: Record<string, number> = {};
  if (signalCountResult.ok && signalCountResult.data) {
    for (const row of signalCountResult.data) {
      const tid = row.touchpoint_id as string;
      signalCountMap[tid] = (signalCountMap[tid] ?? 0) + 1;
    }
  }

  // Fetch graduation metric values in parallel for touchpoints that declare one
  // (T19/B-INV-19). Touchpoints with no `graduation_metric` resolve to null —
  // clean omission surfaced as a dash in the table. Errors are caught per-
  // touchpoint so a single bad row does not break the whole page render.
  const graduationMetricMap: Record<string, GraduationMetricValue | null> = {};
  await Promise.all(
    touchpoints
      .filter((tp) => tp.graduation_metric !== null)
      .map(async (tp) => {
        const value = await metricFor(supabase, tp.touchpoint_id).catch(
          () => null,
        );
        graduationMetricMap[tp.touchpoint_id] = value;
      }),
  );

  return (
    <main className="p-6 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">
          Refinement Registry
        </h1>
        <p className="mt-1 text-sm text-[var(--muted-foreground)]">
          Registry version:{' '}
          <span className="font-mono font-medium text-[var(--foreground)]">
            {registryVersion}
          </span>{' '}
          &mdash; {touchpoints.length} touchpoint
          {touchpoints.length === 1 ? '' : 's'} registered
        </p>
      </header>

      {touchpoints.length === 0 ? (
        <p className="text-sm text-[var(--muted-foreground)]">
          No touchpoints registered yet. Run{' '}
          <code className="font-mono text-xs bg-[var(--muted)] px-1 py-0.5 rounded">
            bun run scripts/eval-runner.ts --all
          </code>{' '}
          to bootstrap the registry.
        </p>
      ) : (
        <div className="border border-[var(--border)] rounded-md overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[var(--muted)] text-[var(--muted-foreground)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium" scope="col">
                  Touchpoint ID
                </th>
                <th className="text-left px-4 py-2 font-medium" scope="col">
                  Kind
                </th>
                <th className="text-left px-4 py-2 font-medium" scope="col">
                  Owner
                </th>
                <th className="text-left px-4 py-2 font-medium" scope="col">
                  Suite
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  scope="col"
                  aria-label="Contract version"
                >
                  Contract v
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  scope="col"
                  aria-label="Unprocessed signal count"
                >
                  Signals
                </th>
                <th
                  className="text-right px-4 py-2 font-medium"
                  scope="col"
                  aria-label="Graduation metric current value"
                >
                  Grad metric
                </th>
                <th className="text-left px-4 py-2 font-medium" scope="col">
                  Endpoints
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {touchpoints.map((tp) => {
                const signalCount = signalCountMap[tp.touchpoint_id] ?? 0;
                const graduationMetric =
                  graduationMetricMap[tp.touchpoint_id] ?? null;
                const baseUrl = `/api/refinement/touchpoints/${encodeURIComponent(tp.touchpoint_id)}`;
                return (
                  <tr
                    key={tp.touchpoint_id}
                    className="bg-[var(--card)] hover:bg-[var(--accent)] transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-xs text-[var(--foreground)] align-top">
                      {tp.touchpoint_id}
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground)] align-top">
                      {tp.kind}
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground)] align-top">
                      {tp.owner}
                    </td>
                    <td className="px-4 py-3 text-[var(--foreground)] align-top">
                      {tp.suite_name}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--foreground)] align-top">
                      {tp.contract_version}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums align-top">
                      <span
                        className={
                          signalCount > 0
                            ? 'text-[var(--foreground)]'
                            : 'text-[var(--muted-foreground)]'
                        }
                        aria-label={`${signalCount} unprocessed signal${signalCount === 1 ? '' : 's'}`}
                      >
                        {signalCount}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums align-top">
                      {graduationMetric !== null ? (
                        <span
                          className="text-[var(--foreground)]"
                          aria-label={`${graduationMetric.metric}: ${(graduationMetric.value * 100).toFixed(1)}%`}
                          title={`${graduationMetric.metric} (${graduationMetric.sample_size} samples)`}
                        >
                          {(graduationMetric.value * 100).toFixed(1)}%
                        </span>
                      ) : (
                        <span
                          className="text-[var(--muted-foreground)]"
                          aria-label="No graduation metric declared"
                        >
                          &mdash;
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <ul className="space-y-0.5 text-xs font-mono">
                        {(
                          [
                            'signals',
                            'patterns',
                            'proposals',
                            'version-history',
                          ] as const
                        ).map((endpoint) => (
                          <li key={endpoint}>
                            <a
                              href={`${baseUrl}/${endpoint}`}
                              className="text-[var(--primary)] underline-offset-2 hover:underline"
                              target="_blank"
                              rel="noreferrer"
                            >
                              {endpoint}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <footer className="mt-6 text-xs text-[var(--muted-foreground)]">
        <p>
          Admin-only &mdash; non-admins are redirected to /login.
          Cross-touchpoint dashboard is a named follow-up (ID-104 deferred
          organ, T24 / B-INV-24).
        </p>
        <p className="mt-1">
          Raindrop Workshop runs locally only &mdash; no client-data egress
          off-platform (B-INV-21).
        </p>
      </footer>
    </main>
  );
}
