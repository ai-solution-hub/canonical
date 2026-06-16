/**
 * Generate an entity-aliases snapshot from the live database.
 *
 * Writes a JSON fixture at scripts/tests/fixtures/entity_aliases_snapshot.json
 * containing the active `entity_aliases` rows (alias → canonical). This snapshot
 * gives the Python relationship canonicaliser DB-alias resolution WITHOUT a
 * runtime DB dependency, mirroring the taxonomy-snapshot pattern
 * (generate-taxonomy-snapshot.ts). It is consumed by:
 *   - scripts/cocoindex_pipeline/canonicalisation.py (`_load_db_entity_aliases`)
 *
 * Closes the canonicalisation.py:117-123 follow-up ({101.9}): without it, a
 * client's SHORT name in source text was not resolved to its full registered
 * canonical, so the holder self-match mis-attributed the client's own
 * certifications to a phantom supplier.
 *
 * Run via: bun run scripts/generate-entity-aliases-snapshot.ts
 */

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';

const PROJECT_ROOT = join(import.meta.dir, '..');
const OUTPUT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/entity_aliases_snapshot.json',
);

function getEnvVar(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function main() {
  // Mirrors the fallback pattern used by generate-taxonomy-snapshot.ts —
  // accepts either SUPABASE_URL (CI secrets convention) or
  // NEXT_PUBLIC_SUPABASE_URL (local .env convention).
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error(
      'Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL',
    );
  }
  const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

  // Active alias rows only. Columns mirror loadAliases()
  // (lib/entities/entity-aliases.ts:58-61) plus `provenance` for context. The
  // DB map is keyed by the RAW `alias` column downstream.
  const { data: aliases, error } = await supabase
    .from('entity_aliases')
    .select('alias, canonical, provenance, is_active')
    .eq('is_active', true)
    .order('alias', { ascending: true });

  if (error) {
    console.error('Failed to fetch entity_aliases:', error.message);
    process.exit(1);
  }

  // Deterministic, sorted-by-alias rows for stable diffs.
  const rows = (aliases ?? [])
    .map((row) => ({
      alias: row.alias as string,
      canonical: row.canonical as string,
      provenance: row.provenance as string,
    }))
    .sort((a, b) => a.alias.localeCompare(b.alias));

  const snapshot = {
    generated_at: new Date().toISOString(),
    aliases: rows,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  const byProvenance = rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.provenance] = (acc[r.provenance] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Entity-aliases snapshot written to ${OUTPUT_PATH}`);
  console.log(`  Aliases: ${rows.length}`);
  for (const [prov, n] of Object.entries(byProvenance).sort()) {
    console.log(`    ${prov}: ${n}`);
  }
}

main().catch((err) => {
  console.error('Snapshot generation failed:', err);
  process.exit(1);
});
