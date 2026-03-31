/**
 * Generate the TAXONOMY section of classification-prompt.md from DB.
 *
 * Fetches taxonomy domains and subtopics from the database and injects the
 * generated markdown between <!-- TAXONOMY_START --> and <!-- TAXONOMY_END -->
 * markers in docs/reference/classification-prompt.md.
 *
 * Domain descriptions come from the DB `taxonomy_domains.description` column.
 * "Key signal" paragraphs are editorial content maintained in this script
 * (Option B per spec) — they change rarely and are not stored in the DB.
 *
 * Usage: bun run scripts/generate-classification-prompt-taxonomy.ts
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const PROJECT_ROOT = join(__dirname, '..');
const PROMPT_PATH = join(PROJECT_ROOT, 'docs/reference/classification-prompt.md');

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

// ── Key signal paragraphs (editorial, Option B per spec) ──
// These are hand-curated and change rarely. Keyed by lowercase domain name.

const KEY_SIGNALS: Record<string, string> = {
  security:
    '**Key signal:** Content about protecting information, systems, and data —\n' +
    'controls, policies, and security practices. The substance is about HOW security\n' +
    'is managed, not merely that a certification exists.',
  compliance:
    '**Key signal:** Content about proving adherence to external requirements —\n' +
    'standards bodies, regulators, auditors. The focus is on the obligation or\n' +
    'evidence, not the underlying practice. For H&S, environmental, and modern\n' +
    'slavery subtopics, the signal is physical safety, environmental impact, or\n' +
    'ethical supply chain — not information security or data protection.',
  implementation:
    '**Key signal:** Content about concrete delivery activities — what happens, when\n' +
    'it happens, and how the transition is managed. Answers the question "What do you\n' +
    'do to get the client live?"',
  support:
    '**Key signal:** Content about keeping a live service running — BAU operations,\n' +
    'response commitments, and what happens when things go wrong. Answers the\n' +
    'question "How do you look after the service once it is live?"',
  corporate:
    '**Key signal:** Content about the organisation itself — who you are, your track\n' +
    'record, your people, and your financial health. Answers the question "Tell us\n' +
    'about your company."',
  'product-feature':
    '**Key signal:** Content about what the product or platform CAN do — its\n' +
    'capabilities, architecture, and user experience. Answers the question "What does\n' +
    'your system do?"',
  methodology:
    '**Key signal:** Content about HOW you work — your processes, governance, and\n' +
    'quality practices. Answers the question "What is your approach to delivering\n' +
    'projects?"',
  'legislation-policy':
    '**Key signal:** Content about laws, statutory guidance, regulatory policy\n' +
    'updates, and legislative instruments. The substance is about WHAT THE LAW\n' +
    'SAYS or HOW POLICY IS CHANGING, not about how an organisation complies.\n' +
    'Answers the question "What does the legislation/guidance require?"',
  'market-intelligence':
    '**Key signal:** Content about competitors, market trends, procurement\n' +
    'activity, and commercial landscape. The substance is about the EXTERNAL\n' +
    "MARKET, not about the organisation's own capabilities or products.\n" +
    'Answers the question "What is happening in our market?"',
  'sector-news':
    '**Key signal:** Content about sector events, leadership changes, inspections,\n' +
    'audits, and organisational restructuring in target sectors. The substance is\n' +
    'about WHAT IS HAPPENING in a sector, not about the organisation itself.\n' +
    'Answers the question "What is happening in the sectors we serve?"',
};

// ── DB fetch ──

interface DomainRow {
  id: string;
  name: string;
  description: string | null;
}

interface SubtopicRow {
  name: string;
  domain_id: string;
  description: string | null;
}

async function fetchTaxonomy(): Promise<{ domains: DomainRow[]; subtopics: SubtopicRow[] }> {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: domains, error: dErr } = await supabase
    .from('taxonomy_domains')
    .select('id, name, description')
    .eq('is_active', true)
    .order('display_order');

  if (dErr || !domains?.length) {
    console.error('Failed to fetch taxonomy domains:', dErr?.message ?? 'empty result');
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

  return { domains: domains as DomainRow[], subtopics: (subtopics ?? []) as SubtopicRow[] };
}

// ── Taxonomy section generation ──

function generateTaxonomySection(domains: DomainRow[], subtopics: SubtopicRow[]): string {
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

    // Add key signal if available
    const signal = KEY_SIGNALS[domain.name.toLowerCase()];
    if (signal) {
      lines.push('');
      lines.push(signal);
    }

    lines.push('');
    lines.push('---');
  }

  return lines.join('\n');
}

// ── Inject into prompt file ──

function inject(filePath: string, startMarker: string, endMarker: string, newContent: string): boolean {
  const content = readFileSync(filePath, 'utf8');
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    console.error(`Markers ${startMarker}/${endMarker} not found in ${filePath}`);
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

  const { domains, subtopics } = await fetchTaxonomy();

  const totalSubtopics = subtopics.length;
  console.log(`  Fetched ${domains.length} domains, ${totalSubtopics} subtopics from DB`);

  const section = generateTaxonomySection(domains, subtopics);

  const changed = inject(PROMPT_PATH, '<!-- TAXONOMY_START -->', '<!-- TAXONOMY_END -->', section);

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
