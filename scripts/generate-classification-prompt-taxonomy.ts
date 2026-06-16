/**
 * Generate the TAXONOMY section of lib/ai/taxonomy/canonical-taxonomy.generated.md from DB.
 *
 * Fetches taxonomy domains and subtopics from the database and writes the
 * generated markdown between <!-- TAXONOMY_START --> and <!-- TAXONOMY_END -->
 * markers in the MAIN-homed artefact lib/ai/taxonomy/canonical-taxonomy.generated.md.
 * This replaces the former docs-site bridge ({68.23}/{114.6}).
 *
 * Domain descriptions come from the DB `taxonomy_domains.description` column.
 * "Key signal" paragraphs come from the DB `taxonomy_domains.key_signal` column
 * (migrated from hardcoded map in WP2 of the taxonomy chain automation).
 *
 * Usage: bun run scripts/generate-classification-prompt-taxonomy.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = join(__dirname, '..');
// DB-derived artefact homed in MAIN ({114.6}). Both bundle-plugin.ts validate()
// and parseCanonicalTaxonomy() read from this path.
const PROMPT_PATH = join(
  PROJECT_ROOT,
  'lib',
  'ai',
  'taxonomy',
  'canonical-taxonomy.generated.md',
);

// ── Env loading ──

function loadEnvFile(path: string): void {
  try {
    const content = readFileSync(path, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — that's fine
  }
}

loadEnvFile(join(PROJECT_ROOT, '.env.local'));
loadEnvFile(join(PROJECT_ROOT, '.env'));

// ── DB fetch ──

interface DomainRow {
  id: string;
  name: string;
  description: string | null;
  key_signal: string | null;
}

interface SubtopicRow {
  name: string;
  domain_id: string;
  description: string | null;
}

// ── --env=prod opt-in (WP-S5.3 D-21 F-1) ──────────────────────────────────

const PROD_PROJECT_REF = 'rovrymhhffssilaftdwd';

function parseEnvFlag(argv: string[]): string {
  const eqArg = argv.find((a) => a.startsWith('--env='));
  if (eqArg) return eqArg.slice('--env='.length);
  const idx = argv.indexOf('--env');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return '';
}

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(PROD_PROJECT_REF)) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${PROD_PROJECT_REF}'.\n` +
        `Run: SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<key> bun run scripts/generate-classification-prompt-taxonomy.ts --env=prod`,
    );
    process.exit(1);
  }
}

async function fetchTaxonomy(env: string): Promise<{
  domains: DomainRow[];
  subtopics: SubtopicRow[];
}> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl);

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: domains, error: dErr } = await supabase
    .from('taxonomy_domains')
    .select('id, name, description, key_signal')
    .eq('is_active', true)
    .order('display_order');

  if (dErr || !domains?.length) {
    console.error(
      'Failed to fetch taxonomy domains:',
      dErr?.message ?? 'empty result',
    );
    process.exit(1);
  }

  const { data: subtopics, error: sErr } = await supabase
    .from('taxonomy_subtopics')
    .select('name, domain_id, description')
    .eq('is_active', true)
    .order('display_order');

  if (sErr) {
    console.error('Failed to fetch taxonomy subtopics:', sErr.message);
    process.exit(1);
  }

  return {
    domains: domains as DomainRow[],
    subtopics: (subtopics ?? []) as SubtopicRow[],
  };
}

// ── Taxonomy section generation ──

function generateTaxonomySection(
  domains: DomainRow[],
  subtopics: SubtopicRow[],
): string {
  const lines: string[] = [];

  lines.push('## TAXONOMY REFERENCE');
  lines.push('');
  lines.push('### Level 1 Domains (Choose exactly ONE primary)');

  for (let i = 0; i < domains.length; i++) {
    const domain = domains[i];
    const domainSubtopics = subtopics.filter((s) => s.domain_id === domain.id);

    lines.push('');
    lines.push(`#### ${i + 1}. ${domain.name.toUpperCase()}`);
    lines.push('');

    if (domain.description) {
      lines.push(domain.description);
    }

    if (domainSubtopics.length > 0) {
      lines.push('');
      lines.push('**Subtopics:**');
      lines.push('');
      for (const st of domainSubtopics) {
        const desc = st.description ? `: ${st.description}` : '';
        lines.push(`- \`${st.name}\`${desc}`);
      }
    }

    // Add key signal if available (stored in DB)
    if (domain.key_signal) {
      lines.push('');
      lines.push(domain.key_signal);
    }

    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

// ── Write MAIN artefact ──

const TAXONOMY_START = '<!-- TAXONOMY_START -->';
const TAXONOMY_END = '<!-- TAXONOMY_END -->';

/**
 * Writes (or refreshes) the MAIN-homed artefact, wrapping the taxonomy section
 * between TAXONOMY_START / TAXONOMY_END markers so parseCanonicalTaxonomy()
 * can parse it. Always writes the full file; returns true if content changed.
 */
function writeArtefact(filePath: string, section: string): boolean {
  const updatedContent = [
    '<!-- DO NOT EDIT — regenerated by scripts/generate-classification-prompt-taxonomy.ts -->',
    '<!-- Run: bun run scripts/generate-classification-prompt-taxonomy.ts -->',
    '',
    TAXONOMY_START,
    section.trim(),
    TAXONOMY_END,
    '',
  ].join('\n');

  let previous = '';
  try {
    previous = readFileSync(filePath, 'utf8');
  } catch {
    // File doesn't exist yet — first materialisation
  }

  if (previous === updatedContent) {
    return false;
  }

  writeFileSync(filePath, updatedContent);
  return true;
}

// ── Main ──

async function main() {
  console.log('Generating classification prompt taxonomy from DB...');

  const envFlag = parseEnvFlag(process.argv.slice(2));
  const { domains, subtopics } = await fetchTaxonomy(envFlag);

  const totalSubtopics = subtopics.length;
  console.log(
    `  Fetched ${domains.length} domains, ${totalSubtopics} subtopics from DB`,
  );

  const section = generateTaxonomySection(domains, subtopics);

  const changed = writeArtefact(PROMPT_PATH, section);

  if (changed) {
    console.log(`UPDATED ${PROMPT_PATH}`);
  } else {
    console.log(`SKIPPED ${PROMPT_PATH} (no changes)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
