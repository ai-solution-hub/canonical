/**
 * Generate the TAXONOMY section of classification-prompt.md from DB.
 *
 * Fetches taxonomy domains and subtopics from the database and injects the
 * generated markdown between <!-- TAXONOMY_START --> and <!-- TAXONOMY_END -->
 * markers in docs/reference/classification-prompt.md.
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
import { resolvePrivateDocsDir } from '../lib/private-docs';

const PROJECT_ROOT = join(__dirname, '..');
// classification-prompt.md relocated private ({68.23}); both the read (inject
// source) and write (codegen target) legs resolve via the KH_PRIVATE_DOCS_DIR
// bridge (fail-loud, opt-in lane — Inv 28/29).
const PROMPT_PATH = join(
  resolvePrivateDocsDir(),
  'ops',
  'classification-prompt.md',
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

// ── Inject into prompt file ──

function inject(
  filePath: string,
  startMarker: string,
  endMarker: string,
  newContent: string,
): boolean {
  const content = readFileSync(filePath, 'utf8');
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    console.error(
      `Markers ${startMarker}/${endMarker} not found in ${filePath}`,
    );
    process.exit(1);
  }

  const updatedContent =
    content.substring(0, startIndex + startMarker.length) +
    '\n' +
    newContent.trim() +
    '\n' +
    content.substring(endIndex);

  if (content === updatedContent) {
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

  const changed = inject(
    PROMPT_PATH,
    '<!-- TAXONOMY_START -->',
    '<!-- TAXONOMY_END -->',
    section,
  );

  if (changed) {
    console.log('UPDATED docs/reference/classification-prompt.md');
  } else {
    console.log('SKIPPED docs/reference/classification-prompt.md (no changes)');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
