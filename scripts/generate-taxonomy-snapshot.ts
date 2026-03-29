/**
 * Generate a taxonomy snapshot from the live database.
 *
 * Writes a JSON fixture at scripts/tests/fixtures/taxonomy_snapshot.json
 * containing active domains and subtopics. This snapshot is consumed by:
 *   - TypeScript consistency tests (__tests__/validation/taxonomy-consistency.test.ts)
 *   - Python validation tests (scripts/tests/test_validate_classification.py)
 *
 * Run via: bun run scripts/generate-taxonomy-snapshot.ts
 * Or as part of: bun run sync:taxonomy
 */

import { createClient } from '@supabase/supabase-js';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT_ROOT = join(import.meta.dir, '..');
const OUTPUT_PATH = join(PROJECT_ROOT, 'scripts/tests/fixtures/taxonomy_snapshot.json');

// ---------------------------------------------------------------------------
// Supabase client (service role — bypasses RLS)
// ---------------------------------------------------------------------------

function getEnvVar(name: string): string {
  const val = process.env[name];
  if (!val) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return val;
}

async function main() {
  const supabaseUrl = getEnvVar('NEXT_PUBLIC_SUPABASE_URL');
  const supabaseKey = getEnvVar('SUPABASE_SECRET_KEY');

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Fetch active domains
  const { data: domains, error: domainError } = await supabase
    .from('taxonomy_domains')
    .select('id, name, display_order, colour, is_active, provenance')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (domainError) {
    console.error('Failed to fetch domains:', domainError.message);
    process.exit(1);
  }

  // Fetch active subtopics
  const { data: subtopics, error: subtopicError } = await supabase
    .from('taxonomy_subtopics')
    .select('id, domain_id, name, display_order, is_active, provenance, description')
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (subtopicError) {
    console.error('Failed to fetch subtopics:', subtopicError.message);
    process.exit(1);
  }

  // Build snapshot
  const snapshot = {
    generated_at: new Date().toISOString(),
    domains: (domains ?? []).map((d) => ({
      id: d.id,
      name: d.name,
      display_order: d.display_order,
      colour: d.colour,
      provenance: d.provenance,
    })),
    subtopics: (subtopics ?? []).map((s) => ({
      id: s.id,
      domain_id: s.domain_id,
      name: s.name,
      display_order: s.display_order,
      provenance: s.provenance,
      description: s.description,
    })),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  // Summary
  const baselineDomains = snapshot.domains.filter((d) => d.provenance === 'baseline');
  const clientDomains = snapshot.domains.filter((d) => d.provenance === 'client');
  const recommendedDomains = snapshot.domains.filter((d) => d.provenance === 'recommended');

  console.log(`Taxonomy snapshot written to ${OUTPUT_PATH}`);
  console.log(`  Domains: ${snapshot.domains.length} (${baselineDomains.length} baseline, ${clientDomains.length} client, ${recommendedDomains.length} recommended)`);
  console.log(`  Subtopics: ${snapshot.subtopics.length}`);
}

main().catch((err) => {
  console.error('Snapshot generation failed:', err);
  process.exit(1);
});
