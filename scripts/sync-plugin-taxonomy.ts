import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { VALID_CONTENT_TYPES } from '../lib/validation/schemas';

const PROJECT_ROOT = join(__dirname, '..');
const CLASSIFICATION_SKILL_PATH = join(
  PROJECT_ROOT,
  '.claude/plugins/knowledge-hub/1.0.0/skills/classification/SKILL.md',
);
const SEARCH_SKILL_PATH = join(
  PROJECT_ROOT,
  '.claude/plugins/knowledge-hub/1.0.0/skills/search-strategy/SKILL.md',
);
const SETTINGS_PATH = join(
  PROJECT_ROOT,
  '.claude/plugins/knowledge-hub/1.0.0/settings.template.json',
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

async function fetchTaxonomyFromDB(): Promise<
  Map<string, { slug: string; desc: string }[]>
> {
  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data: domains, error: dErr } = await supabase
    .from('taxonomy_domains')
    .select('id, name')
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

  const taxonomyMap = new Map<string, { slug: string; desc: string }[]>();

  for (const domain of domains) {
    const domainSubtopics = (subtopics ?? [])
      .filter((s) => s.domain_id === domain.id)
      .map((s) => ({
        slug: s.name,
        desc: s.description ?? '',
      }));
    taxonomyMap.set(domain.name.toLowerCase(), domainSubtopics);
  }

  return taxonomyMap;
}

// Mapping for content type descriptions used in the table
const CONTENT_TYPE_DESCRIPTIONS: Record<string, { desc: string; use: string }> =
  {
    q_a_pair: {
      desc: 'Question and answer pair with standard/advanced answers',
      use: 'Pre-approved bid responses',
    },
    article: {
      desc: 'In-depth knowledge base article',
      use: 'General reference material',
    },
    blog: { desc: 'Blog-style content', use: 'Thought leadership, updates' },
    pdf: {
      desc: 'Content extracted from PDF documents',
      use: 'Imported documentation',
    },
    note: { desc: 'Short-form notes', use: 'Quick captures, meeting notes' },
    research: {
      desc: 'Research documents and findings',
      use: 'Market research, analysis',
    },
    case_study: {
      desc: 'Project case study with outcomes',
      use: 'Evidence for bid responses',
    },
    policy: {
      desc: 'Organisational policy or procedure',
      use: 'Authority for compliance claims',
    },
    certification: {
      desc: 'Certification or accreditation record',
      use: 'Proof of compliance',
    },
    compliance: {
      desc: 'Compliance documentation',
      use: 'Regulatory evidence',
    },
    methodology: {
      desc: 'Methodology or approach description',
      use: 'Process evidence for bids',
    },
    capability: {
      desc: 'Service or product capability statement',
      use: 'Capability evidence',
    },
    product_description: {
      desc: 'Product or service description',
      use: 'Marketing and technical detail',
    },
    other: {
      desc: "Content that doesn't fit other categories",
      use: 'Miscellaneous',
    },
  };

// Fallback for types added to schemas.ts but not yet in our description map
const DEFAULT_DESC = { desc: 'Generic content item', use: 'General knowledge' };

function inject(
  filePath: string,
  startMarker: string,
  endMarker: string,
  newContent: string,
) {
  const content = readFileSync(filePath, 'utf8');
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);

  if (startIndex === -1 || endIndex === -1) {
    console.warn(
      `Markers ${startMarker}/${endMarker} not found in ${filePath}. Skipping injection.`,
    );
    return false;
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

async function main() {
  console.log('Syncing plugin taxonomy from DB...');

  const canonicalMap = await fetchTaxonomyFromDB();

  // 1. Generate Classification Skill Taxonomy Tree
  let treeOutput =
    '### Full Taxonomy (' +
    canonicalMap.size +
    ' domains, ' +
    [...canonicalMap.values()].reduce((acc, val) => acc + val.length, 0) +
    ' subtopics)\n\n```\n';

  for (const [domain, subtopics] of canonicalMap.entries()) {
    // Preserve "Product-Feature" instead of "Product-feature"
    let domainName = domain.charAt(0).toUpperCase() + domain.slice(1);
    if (domainName === 'Product-feature') domainName = 'Product-Feature';

    treeOutput += `${domainName} (${subtopics.length} subtopics)\n`;
    subtopics.forEach((st, i) => {
      const prefix = i === subtopics.length - 1 ? '  └── ' : '  ├── ';
      treeOutput += `${prefix}${st.slug} (${st.desc})\n`;
    });
    treeOutput += '\n';
  }
  treeOutput = treeOutput.trim() + '\n```';

  // Actually, the existing format in SKILL.md has some extra descriptions in parentheses.
  // The parser doesn't capture those currently, and they might drift.
  // The spec says: "Convert the canonical taxonomy into the tree notation format used in classification/SKILL.md"
  // Let's refine the tree generation to include some hints if we can get them from the canonical source.

  // 2. Generate Search Strategy Domain Table
  let searchTable = '### Domain Filter Guidance\n\n';
  searchTable +=
    'The KB uses ' +
    canonicalMap.size +
    ' domains. Use the domain slug when filtering:\n\n';
  searchTable += '| If the query mentions... | Filter to domain |\n';
  searchTable += '|--------------------------|-----------------|\n';

  for (const [domain, subtopics] of canonicalMap.entries()) {
    // Collect signal words (subtopic slugs)
    const signals = subtopics.map((s) => s.slug.replace(/-/g, ' ')).join(', ');
    searchTable += `| ${signals.charAt(0).toUpperCase() + signals.slice(1)} | ${domain} |\n`;
  }

  searchTable += '\n**When NOT to filter:**';

  // 3. Generate Content Types Table
  let contentTypesTable = '## Content Types\n\n';
  contentTypesTable += 'Each KB item is classified with one content type:\n\n';
  contentTypesTable += '| Content Type | Description | Typical Use |\n';
  contentTypesTable += '|-------------|-------------|-------------|\n';

  for (const type of VALID_CONTENT_TYPES) {
    const info = CONTENT_TYPE_DESCRIPTIONS[type] || DEFAULT_DESC;
    contentTypesTable += `| **${type}** | ${info.desc} | ${info.use} |\n`;
  }

  // 4. Update Files
  const results = [
    {
      file: 'classification/SKILL.md (taxonomy)',
      changed: inject(
        CLASSIFICATION_SKILL_PATH,
        '<!-- TAXONOMY_INJECT_START -->',
        '<!-- TAXONOMY_INJECT_END -->',
        treeOutput,
      ),
    },
    {
      file: 'classification/SKILL.md (content-types)',
      changed: inject(
        CLASSIFICATION_SKILL_PATH,
        '<!-- CONTENT_TYPES_INJECT_START -->',
        '<!-- CONTENT_TYPES_INJECT_END -->',
        contentTypesTable,
      ),
    },
    {
      file: 'search-strategy/SKILL.md',
      changed: inject(
        SEARCH_SKILL_PATH,
        '<!-- TAXONOMY_INJECT_START -->',
        '<!-- TAXONOMY_INJECT_END -->',
        searchTable,
      ),
    },
  ];

  // 5. Update settings.template.json
  const settingsContent = readFileSync(SETTINGS_PATH, 'utf8');
  const settings = JSON.parse(settingsContent);
  const newDomains = [...canonicalMap.keys()].map(
    (d) => d.charAt(0).toUpperCase() + d.slice(1),
  );

  if (
    JSON.stringify(settings.taxonomy.primary_domains) !==
    JSON.stringify(newDomains)
  ) {
    settings.taxonomy.primary_domains = newDomains;
    writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
    results.push({ file: 'settings.template.json', changed: true });
  } else {
    results.push({ file: 'settings.template.json', changed: false });
  }

  results.forEach((r) => {
    console.log(`${r.changed ? 'UPDATED' : 'SKIPPED'} ${r.file}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
