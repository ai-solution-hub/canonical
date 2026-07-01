import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Worker-prefix scoping for the /browse page (test-philosophy.md §2.1 —
 * never assert against ambient staging content; assert only against
 * worker-seeded prefix-scoped rows).
 *
 * IMPORTANT — why this helper does a *semantic search*, not a title filter:
 *
 *   /browse exposes NO deterministic title-substring filter. The only
 *   in-page text input (`components/browse/search-bar.tsx`, `variant="inline"`)
 *   runs a SEMANTIC (embeddings) search — typing the literal worker prefix
 *   `[E2E-S{shard}-W{n}]` into it would not surface the seeded rows (the
 *   bracketed prefix is not embedded content). The `FilterPanel` filters by
 *   domain / content_type / platform / freshness only — not title.
 *
 *   The brief's fallback ("route the quality-badge asserts through a seeded
 *   /item/[id] detail card") is ALSO infeasible: `QualityBadge` renders only
 *   inside `ContentCard` (the browse grid + search-results cards) — it is NOT
 *   present on the `/item/[id]` detail page.
 *
 *   So to read worker-seeded (not ambient) cards we run a semantic search
 *   anchored on the unique high-specificity seeded title
 *   "Cyber Essentials Compliance" (content item [3] — see
 *   `e2e/fixtures/test-data.ts` `buildCoreContentItems` index 3; it carries a
 *   pre-computed embedding, `EMBEDDING_ITEM_INDICES = [0,1,2,3,7]`), which
 *   ranks the worker rows into the visible window even against ambient staging
 *   embeddings on the shared DB, then scope to the single result card carrying
 *   THIS worker's prefix. Every other concurrent worker seeds the same title
 *   under its own prefix, so the prefix regex isolates the current worker.
 */

/**
 * Unique high-specificity title seeded as content item [3]
 * (`e2e/fixtures/test-data.ts` `buildCoreContentItems`). Has a pre-computed
 * embedding (index 3 ∈ `EMBEDDING_ITEM_INDICES`), so a semantic search for
 * this exact string ranks the worker-seeded row into the top window.
 */
export const PREFIX_SEARCH_ANCHOR_TITLE = 'Cyber Essentials Compliance';

/** Escape a worker prefix (e.g. "[E2E-S1-W0]") for safe use inside a RegExp. */
export function escapePrefix(prefix: string): string {
  return prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Run a semantic /browse search anchored on the unique seeded title and
 * return the result card belonging to THIS worker (`prefix`).
 *
 * `ContentCard` renders as a `<Link>` (role `link`) to `/item/{id}`; its
 * accessible name includes the unhighlighted worker prefix, and the
 * `QualityBadge` span lives inside it. The returned Locator is asserted
 * visible before return, so callers get a hard failure (never a silent skip)
 * when the worker row is absent — exactly the {128.9} self-seeding contract.
 *
 * @returns the worker-seeded card `<a>` Locator (`.first()` — top-ranked).
 */
export async function searchBrowseByPrefix(
  page: Page,
  prefix: string,
): Promise<Locator> {
  await page.goto(
    `/browse?q=${encodeURIComponent(PREFIX_SEARCH_ANCHOR_TITLE)}`,
  );

  const workerCard = page
    .getByRole('link', { name: new RegExp(escapePrefix(prefix)) })
    .first();
  await expect(workerCard).toBeVisible({ timeout: 15000 });
  return workerCard;
}
