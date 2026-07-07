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

import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createLooseScriptClient } from '@/scripts/lib/supabase-script-client';

const PROJECT_ROOT = join(import.meta.dir, '..');
const OUTPUT_PATH = join(
  PROJECT_ROOT,
  'scripts/tests/fixtures/taxonomy_snapshot.json',
);

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
  // Mirrors fallback pattern used by generate-classification-prompt-taxonomy.ts
  // and sync-plugin-taxonomy.ts — accepts either SUPABASE_URL (CI secrets
  // convention) or NEXT_PUBLIC_SUPABASE_URL (local .env convention).
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    throw new Error(
      'Missing required environment variable: SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL',
    );
  }
  const supabaseKey = getEnvVar('SUPABASE_SERVICE_ROLE_KEY');

  // <any>: calls the dead `get_check_constraint_values` rpc (fallback path),
  // not in the typed schema — intentionally loose (see supabase-script-client.ts).
  const supabase = createLooseScriptClient(supabaseUrl, supabaseKey);

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
    .select(
      'id, domain_id, name, display_order, is_active, provenance, description',
    )
    .eq('is_active', true)
    .order('display_order', { ascending: true });

  if (subtopicError) {
    console.error('Failed to fetch subtopics:', subtopicError.message);
    process.exit(1);
  }

  // Fetch live form_types rows (ID-52.6 / TECH §2.6b — triple-source
  // lockstep). The Python pipeline reads `form_types` from this snapshot via
  // `FormMetadata.form_type`'s field_validator, mirroring the
  // `_load_canonical_content_types` pattern.
  const { data: formTypes, error: formTypeError } = await supabase
    .from('form_types')
    .select('key, label')
    .order('key', { ascending: true });

  if (formTypeError) {
    console.error('Failed to fetch form_types:', formTypeError.message);
    process.exit(1);
  }

  // Fetch CHECK constraint values for content_types and platforms
  const { data: checkConstraints } = await supabase
    .rpc('get_check_constraint_values', undefined)
    .then((res) => {
      if (res.error) return { data: null };
      return res;
    });

  // Primary source is the `get_check_constraint_values` RPC, which reads the
  // live CHECK constraint values from `information_schema` server-side. The
  // fallback below is a hardcoded mirror used only when the RPC is unavailable.
  let contentTypes: string[] = [];
  let platforms: string[] = [];
  let requirementTypes: string[] = [];

  if (checkConstraints && Array.isArray(checkConstraints)) {
    for (const row of checkConstraints) {
      if (row.column_name === 'content_type') contentTypes = row.allowed_values;
      if (row.column_name === 'platform') platforms = row.allowed_values;
      if (row.column_name === 'requirement_type')
        requirementTypes = row.allowed_values;
    }
  }

  // If RPC not available, use the known values from schema reference.
  // ID-133 BI-3 (S451 owner-ratified): source_documents.content_type is no
  // longer a DB CHECK-enforced column (ID-131 M3 made it nullable, no
  // CHECK) — this fallback is the enforcement source of truth via
  // taxonomy_snapshot.json + the Pydantic `_validate_content_type` field
  // validator. Trimmed to the BI-3 stay-set: q_a_pair migrated out to its
  // own Layer-5 class (32-q-a-pair.md); case_study/policy/certification/
  // compliance/methodology/capability/product_description moved to the
  // L-concept type discriminators (37-concept-type.md).
  if (contentTypes.length === 0) {
    contentTypes = [
      'article',
      'blog',
      'pdf',
      'note',
      'research',
      'document',
      'other',
    ];
    console.warn('  Using fallback content_types (RPC not available)');
  }
  if (platforms.length === 0) {
    platforms = ['web', 'email', 'manual', 'upload', 'extraction', 'other'];
    console.warn('  Using fallback platforms (RPC not available)');
  }
  if (requirementTypes.length === 0) {
    requirementTypes = [
      'policy',
      'statement',
      'evidence',
      'data',
      'narrative',
      'declaration',
      'reference',
    ];
    console.warn('  Using fallback requirement_type (RPC not available)');
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
    content_types: contentTypes,
    platforms: platforms,
    requirement_type: requirementTypes,
    form_types: (formTypes ?? []).map((row) => ({
      key: row.key,
      label: row.label,
    })),
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');

  // Summary
  const baselineDomains = snapshot.domains.filter(
    (d) => d.provenance === 'baseline',
  );
  const clientDomains = snapshot.domains.filter(
    (d) => d.provenance === 'client',
  );
  const recommendedDomains = snapshot.domains.filter(
    (d) => d.provenance === 'recommended',
  );

  console.log(`Taxonomy snapshot written to ${OUTPUT_PATH}`);
  console.log(
    `  Domains: ${snapshot.domains.length} (${baselineDomains.length} baseline, ${clientDomains.length} client, ${recommendedDomains.length} recommended)`,
  );
  console.log(`  Subtopics: ${snapshot.subtopics.length}`);
  console.log(`  Content types: ${snapshot.content_types.length}`);
  console.log(`  Platforms: ${snapshot.platforms.length}`);
  console.log(`  Requirement types: ${snapshot.requirement_type.length}`);
  console.log(`  Form types: ${snapshot.form_types.length}`);
}

main().catch((err) => {
  console.error('Snapshot generation failed:', err);
  process.exit(1);
});
