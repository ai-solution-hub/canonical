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

import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { prodProjectRef } from '@/scripts/lib/project-refs';

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

// ── De-ID redaction (PC-31 / PI-1) ──
//
// Resolves the canonical identity denylist at runtime (same priority order as
// sweep-identity-relocation.ts / generate-purge-path-inventory.ts):
//   1. KH_CLIENT_NAME_DENYLIST env var — JSON content (primary; CI secret)
//   2. KH_PRIVATE_DOCS_DIR/ops/identity-denylist.json — local dev fallback
//   3. Sibling checkout: <main-checkout-parent>/knowledge-hub-docs-site/ops/identity-denylist.json
//
// SECURITY: token VALUES are never embedded in this file or emitted to stdout.

export interface DenylistToken {
  value: string;
  case_insensitive: boolean;
  class: string;
}

interface Denylist {
  tokens: DenylistToken[];
}

function git(args: string[]): string {
  const res = spawnSync('git', args, { encoding: 'utf8' });
  if (res.error) throw res.error;
  return res.stdout;
}

/**
 * Resolves the denylist file path from available env/filesystem sources.
 * Returns null if no source is reachable (caller decides how to handle).
 */
function resolveDenylistPath(): string | null {
  // Primary: KH_CLIENT_NAME_DENYLIST env var holds the full JSON content
  const inlineJson = process.env.KH_CLIENT_NAME_DENYLIST;
  if (inlineJson) {
    const tmpDir = mkdtempSync(join(tmpdir(), 'kh-denylist-'));
    const tmpPath = join(tmpDir, 'identity-denylist.json');
    writeFileSync(tmpPath, inlineJson, 'utf8');
    return tmpPath;
  }

  // Fallback 1: KH_PRIVATE_DOCS_DIR checkout
  const envDir = process.env.KH_PRIVATE_DOCS_DIR;
  if (envDir) {
    const p = join(envDir, 'ops', 'identity-denylist.json');
    if (existsSync(p)) return p;
  }

  // Fallback 2: sibling checkout (resolves correctly for agent worktrees too)
  const commonDir = git([
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]).trim();
  if (commonDir) {
    const mainRoot = dirname(commonDir);
    const p = join(
      dirname(mainRoot),
      'knowledge-hub-docs-site',
      'ops',
      'identity-denylist.json',
    );
    if (existsSync(p)) return p;
  }

  return null;
}

/**
 * Loads the denylist tokens, or returns null if no denylist source is reachable.
 * Caller must invoke assertDenylistReachable before writing any artefact.
 */
function loadDenylistTokens(): DenylistToken[] | null {
  const path = resolveDenylistPath();
  if (!path) return null;
  const denylist: Denylist = JSON.parse(readFileSync(path, 'utf8'));
  return denylist.tokens;
}

/**
 * Fail-loud de-ID guard (PC-31 / PI-1). Throws when no client-name denylist
 * source is reachable — a null or empty token list — so the generator can
 * never materialise the public taxonomy artefact without a confirmed
 * redaction source. Without a denylist we cannot prove the DB-sourced
 * content is free of client-name terms, so emitting it would be a silent
 * de-ID hole (ID-68.36).
 *
 * Asserts `tokens` is a non-empty DenylistToken[] for the caller on return.
 */
export function assertDenylistReachable(
  tokens: DenylistToken[] | null,
): asserts tokens is DenylistToken[] {
  if (!tokens || tokens.length === 0) {
    throw new Error(
      'FATAL: No client-name denylist source reachable ' +
        '(KH_CLIENT_NAME_DENYLIST, KH_PRIVATE_DOCS_DIR, or sibling ' +
        'knowledge-hub-docs-site checkout). De-ID redaction cannot be ' +
        'applied, so the taxonomy artefact will not be written. Set a ' +
        'denylist source and re-run.',
    );
  }
}

/**
 * Replaces each denylist token found in `text` with a neutral placeholder.
 * Uses `{CLIENT_PRODUCT_NAME}` for product-class tokens and
 * `{CLIENT_ORGANISATION_NAME}` for every other class.
 *
 * Returns the redacted string; is a no-op when tokens is null/empty.
 */
export function redactClientTerms(
  text: string,
  tokens: DenylistToken[] | null,
): string {
  if (!tokens || tokens.length === 0) return text;
  let result = text;
  for (const token of tokens) {
    const placeholder = /product/i.test(token.class)
      ? '{CLIENT_PRODUCT_NAME}'
      : '{CLIENT_ORGANISATION_NAME}';
    const flags = token.case_insensitive ? 'gi' : 'g';
    // Escape special regex characters in the token value
    const escaped = token.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    result = result.replace(new RegExp(escaped, flags), placeholder);
  }
  return result;
}

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

function parseEnvFlag(argv: string[]): string {
  const eqArg = argv.find((a) => a.startsWith('--env='));
  if (eqArg) return eqArg.slice('--env='.length);
  const idx = argv.indexOf('--env');
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return '';
}

function assertEnvFlag(env: string, url: string | undefined): void {
  if (env === 'prod' && !(url ?? '').includes(prodProjectRef())) {
    console.error(
      `--env=prod set but SUPABASE_URL does not include '${prodProjectRef()}'.\n` +
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

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

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
  denylistTokens: DenylistToken[] | null,
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
      lines.push(redactClientTerms(domain.description, denylistTokens));
    }

    if (domainSubtopics.length > 0) {
      lines.push('');
      lines.push('**Subtopics:**');
      lines.push('');
      for (const st of domainSubtopics) {
        const rawDesc = st.description ?? '';
        const desc = rawDesc
          ? `: ${redactClientTerms(rawDesc, denylistTokens)}`
          : '';
        lines.push(`- \`${st.name}\`${desc}`);
      }
    }

    // Add key signal if available (stored in DB)
    if (domain.key_signal) {
      lines.push('');
      lines.push(redactClientTerms(domain.key_signal, denylistTokens));
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

  // Load denylist tokens for de-ID redaction (PC-31 / PI-1) and fail loud if
  // no source is reachable. The DB-sourced taxonomy content may contain
  // client-name terms; without a denylist we cannot redact them, so writing
  // the public artefact would be a silent de-ID hole (ID-68.36).
  const denylistTokens = loadDenylistTokens();
  assertDenylistReachable(denylistTokens);
  console.log(
    `  Loaded denylist (${denylistTokens.length} tokens) for PC-31 redaction`,
  );

  const envFlag = parseEnvFlag(process.argv.slice(2));
  const { domains, subtopics } = await fetchTaxonomy(envFlag);

  console.log(
    `  Fetched ${domains.length} domains, ${subtopics.length} subtopics from DB`,
  );

  const section = generateTaxonomySection(domains, subtopics, denylistTokens);

  const changed = writeArtefact(PROMPT_PATH, section);

  if (changed) {
    console.log(`UPDATED ${PROMPT_PATH}`);
  } else {
    console.log(`SKIPPED ${PROMPT_PATH} (no changes)`);
  }
}

// Guard the entry point so importing this module (e.g. from tests that
// exercise the pure redaction/guard functions) does not execute main().
if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
