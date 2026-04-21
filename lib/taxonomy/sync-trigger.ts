/**
 * Taxonomy sync trigger — server-side debounce + hash computation.
 *
 * `enqueueTaxonomySync()` is called from each of the 9 taxonomy/layer API
 * routes after a successful mutation. It debounces rapid sequential changes
 * (e.g. reordering 5 domains) into a single dispatch via a 2 s trailing
 * timer, then fires the internal `/api/admin/taxonomy-sync` endpoint.
 *
 * `computeTaxonomyHash()` produces a deterministic SHA-256 digest of the
 * classification-relevant taxonomy state for drift detection.
 */

import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Debounce — module-level singleton (server-side, per-process)
// ---------------------------------------------------------------------------

let pendingTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Enqueue a taxonomy sync dispatch with 2 s trailing-edge debounce.
 *
 * Safe to call from any API route handler after a successful taxonomy or
 * layer mutation. Returns immediately (fire-and-forget). The actual
 * dispatch is handled by the `/api/admin/taxonomy-sync` route which
 * records the result via `pipeline_runs`.
 */
export function enqueueTaxonomySync(): void {
  if (pendingTimer) clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    void fetch('/api/admin/taxonomy-sync', {
      method: 'POST',
      headers: { 'x-internal-trigger': 'taxonomy-mutation' },
    }).catch((_err) => {
      // Intentionally swallowed — the sync route records its own failures
      // via pipeline_runs + Sentry. The originating mutation already
      // succeeded; there is nothing actionable here.
    });
  }, 2_000);
}

// ---------------------------------------------------------------------------
// Taxonomy hash — deterministic SHA-256 of classification-relevant state
// ---------------------------------------------------------------------------

/**
 * Shape accepted by `computeTaxonomyHash`. Matches the rows returned by
 * a `SELECT *` on `taxonomy_domains` / `taxonomy_subtopics`. Only
 * classification-relevant fields are projected into the hash — see the
 * field allowlist below.
 */
export interface TaxonomySnapshot {
  domains: Array<{
    id: string;
    name: string;
    description: string | null;
    key_signal: string | null;
    display_order: number;
    is_active: boolean | null;
    /** Fields intentionally ignored by the hash */
    colour?: string | null;
    provenance?: string;
    display_name?: string | null;
    created_at?: string;
    updated_at?: string;
    accepted_at?: string | null;
    recommended_at?: string | null;
    recommended_by?: string | null;
  }>;
  subtopics: Array<{
    id: string;
    domain_id: string;
    name: string;
    description: string | null;
    display_order: number;
    is_active: boolean | null;
    /** Fields intentionally ignored by the hash */
    colour?: string | null;
    provenance?: string;
    display_name?: string | null;
    created_at?: string;
    updated_at?: string;
    accepted_at?: string | null;
    recommended_at?: string | null;
    recommended_by?: string | null;
  }>;
}

// Layer vocabulary is intentionally excluded from the hash.
// Layer mutations dispatch to GitHub Actions for consistency, but produce
// no artefact changes (layers appear in no generated file today — see OQ-3).
// This means the drift banner never fires for layer-only changes.

/**
 * Compute a deterministic SHA-256 hash of the classification-relevant
 * taxonomy state. Only active domains/subtopics are included. Fields
 * that affect only display (colour, provenance, display_order beyond
 * sort stability, display_name, timestamps) are excluded so cosmetic
 * edits do not trigger unnecessary syncs.
 *
 * Per spec SS3.2.1 — the hash covers `name`, `description`, and
 * `key_signal` for domains; `name`, `domain_id`, and `description`
 * for subtopics.
 */
export function computeTaxonomyHash(state: TaxonomySnapshot): string {
  const normalised = JSON.stringify({
    domains: state.domains
      .filter((d) => d.is_active)
      .sort((a, b) => a.display_order - b.display_order)
      .map((d) => ({
        name: d.name,
        description: d.description,
        key_signal: d.key_signal,
      })),
    subtopics: state.subtopics
      .filter((s) => s.is_active)
      .sort((a, b) => a.display_order - b.display_order)
      .map((s) => ({
        name: s.name,
        domain_id: s.domain_id,
        description: s.description,
      })),
  });

  return createHash('sha256').update(normalised).digest('hex');
}
