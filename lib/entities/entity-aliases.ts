/**
 * Entity alias resolution — maps variant names to canonical form.
 *
 * Aliases are loaded from the `entity_aliases` DB table with an
 * in-memory cache. Generic aliases (ISO, technology names) are kept
 * as a code-level baseline fallback for when the DB is unreachable
 * (e.g. during builds, tests without DB).
 *
 * Client-specific aliases (company names, product names) live
 * exclusively in the DB and differ per deployment.
 */

import { logger } from '@/lib/logger';

// ── Generic baseline (client-independent, always available) ─────────
export const BASELINE_ALIASES: Record<string, string> = {
  'ISO Certification': 'ISO 27001',
  'Iso Certifications': 'ISO 27001',
  'ISO 27001 2013': 'ISO 27001',
  'ISO 27000': 'ISO 27001',
  'ISO 9001 2015': 'ISO 9001',
  wordpress: 'WordPress',
  Wordpress: 'WordPress',
  Csharp: 'C#',
  csharp: 'C#',
  'Asp Net': 'ASP.NET',
  'Asp.net': 'ASP.NET',
  agile: 'Agile',
  Hcaptcha: 'hCaptcha',
  'Wcag 2 1 Aa': 'WCAG 2.1 AA',
};

// ── In-memory cache ─────────────────────────────────────────────────

let cachedAliases: Record<string, string> | null = null;
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Load aliases from the entity_aliases DB table.
 * Merges with BASELINE_ALIASES (DB values take precedence).
 */
/**
 * Supabase client shape for alias loading. Uses a minimal structural type
 * to avoid deep type instantiation with the full SupabaseClient<Database>.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AliasSupabaseClient = { from: (table: string) => any };

export async function loadAliases(
  supabase: AliasSupabaseClient,
): Promise<Record<string, string>> {
  if (cachedAliases && Date.now() - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedAliases;
  }

  try {
    const { data, error } = await supabase
      .from('entity_aliases')
      .select('alias, canonical')
      .eq('is_active', true);

    if (error || !data) {
      logger.warn(
        { err: error },
        'Failed to load entity aliases from DB, using baseline',
      );
      cachedAliases = { ...BASELINE_ALIASES };
    } else {
      // Merge: baseline first, then DB entries (DB wins on conflict)
      cachedAliases = { ...BASELINE_ALIASES };
      for (const row of data) {
        cachedAliases[row.alias] = row.canonical;
      }
    }
  } catch {
    logger.warn('Entity alias DB fetch threw, using baseline');
    cachedAliases = { ...BASELINE_ALIASES };
  }

  cacheLoadedAt = Date.now();
  return cachedAliases;
}

/**
 * Resolve an entity name through the alias map.
 * Uses the cached map if loaded; falls back to baseline if not.
 *
 * For synchronous contexts (tests, scripts that do not await loadAliases),
 * this uses whatever is cached or just the baseline.
 */
export function resolveAlias(canonicalName: string): string {
  const map = cachedAliases ?? BASELINE_ALIASES;
  return map[canonicalName] ?? canonicalName;
}

/**
 * Clear the in-memory cache. Useful for tests.
 */
export function clearAliasCache(): void {
  cachedAliases = null;
  cacheLoadedAt = 0;
}

/**
 * Preload aliases into cache with a given map. Useful for tests and
 * scripts that want to inject aliases without a DB connection.
 */
export function setAliasCache(aliases: Record<string, string>): void {
  cachedAliases = { ...BASELINE_ALIASES, ...aliases };
  cacheLoadedAt = Date.now();
}
