/**
 * Bundle the Knowledge Hub plugin into a ZIP string constant for Vercel.
 *
 * Reads the plugin directory, builds a ZIP archive, and exports it as a
 * base64 string constant in lib/mcp/plugin-bundle.ts. This allows the
 * /api/plugin/download endpoint to serve the plugin on Vercel without
 * filesystem reads (the .claude/ directory is gitignored).
 *
 * Usage: bun run scripts/bundle-plugin.ts
 */
import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { VALID_CONTENT_TYPES } from '../lib/validation/schemas';
import {
  parseCanonicalTaxonomy,
  parsePluginTaxonomy,
  parsePluginDomainSlugs,
  parsePluginContentTypes,
  compareSets,
} from './lib/taxonomy-parser';

const PROJECT_ROOT = join(import.meta.dirname, '..');
const PLUGIN_DIR = join(
  PROJECT_ROOT,
  '.claude',
  'plugins',
  'knowledge-hub',
  '1.0.0',
);
const OUTPUT_PATH = join(PROJECT_ROOT, 'lib', 'mcp', 'plugin-bundle.ts');

const EXCLUDED = new Set(['.DS_Store', 'node_modules', '.git']);

/**
 * Recursively collect all files in a directory.
 */
async function collectFiles(
  dir: string,
  basePath: string,
): Promise<Array<{ path: string; content: Uint8Array }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ path: string; content: Uint8Array }> = [];

  for (const entry of entries) {
    if (EXCLUDED.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    const relativePath = relative(basePath, fullPath);

    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, basePath);
      files.push(...nested);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      files.push({ path: relativePath, content: new Uint8Array(content) });
    }
  }

  return files;
}

/**
 * CRC-32 for ZIP integrity.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Build a ZIP from file entries.
 */
function buildZip(
  files: Array<{ path: string; content: Uint8Array }>,
): Uint8Array {
  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = new TextEncoder().encode(file.path);
    const crc = crc32(file.content);

    const local = new Uint8Array(30 + nameBytes.length + file.content.length);
    const localView = new DataView(local.buffer);

    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, 0, true);
    localView.setUint16(12, 0, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.content.length, true);
    localView.setUint32(22, file.content.length, true);
    localView.setUint16(26, nameBytes.length, true);
    localView.setUint16(28, 0, true);

    local.set(nameBytes, 30);
    local.set(file.content, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);

    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0, true);
    centralView.setUint16(10, 0, true);
    centralView.setUint16(12, 0, true);
    centralView.setUint16(14, 0, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.content.length, true);
    centralView.setUint32(24, file.content.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint16(30, 0, true);
    centralView.setUint16(32, 0, true);
    centralView.setUint16(34, 0, true);
    centralView.setUint16(36, 0, true);
    centralView.setUint32(38, 0, true);
    centralView.setUint32(42, offset, true);

    central.set(nameBytes, 46);

    localHeaders.push(local);
    centralHeaders.push(central);
    offset += local.length;
  }

  const centralDirOffset = offset;
  const centralDirSize = centralHeaders.reduce((sum, h) => sum + h.length, 0);

  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);

  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(4, 0, true);
  endView.setUint16(6, 0, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralDirSize, true);
  endView.setUint32(16, centralDirOffset, true);
  endView.setUint16(20, 0, true);

  const totalSize = offset + centralDirSize + 22;
  const zip = new Uint8Array(totalSize);
  let pos = 0;

  for (const header of localHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }
  for (const header of centralHeaders) {
    zip.set(header, pos);
    pos += header.length;
  }
  zip.set(endRecord, pos);

  return zip;
}

/**
 * Validate taxonomy consistency before bundling.
 */
function validate(): void {
  // DB-derived artefact homed in MAIN ({114.6}); no docs-site bridge required.
  const CANONICAL_PATH = join(
    PROJECT_ROOT,
    'lib',
    'ai',
    'taxonomy',
    'canonical-taxonomy.generated.md',
  );
  const CLASSIFICATION_SKILL_PATH = join(
    PLUGIN_DIR,
    'skills/classification/SKILL.md',
  );
  const SEARCH_SKILL_PATH = join(PLUGIN_DIR, 'skills/search-strategy/SKILL.md');

  const canonicalMap = parseCanonicalTaxonomy(CANONICAL_PATH);
  const canonicalDomains = new Set(canonicalMap.keys());
  let errors = 0;

  // 1. Check Domains
  const pluginMap = parsePluginTaxonomy(CLASSIFICATION_SKILL_PATH);
  const pluginDomains = new Set(pluginMap.keys());
  const { missing: mD, extra: eD } = compareSets(
    canonicalDomains,
    pluginDomains,
  );

  if (mD.length || eD.length) {
    console.error(
      `❌ Mismatch in domains! Missing: ${mD.join(', ')} | Extra: ${eD.join(', ')}`,
    );
    errors++;
  }

  // 2. Check Subtopics
  for (const [domain, canonicalSubtopics] of canonicalMap.entries()) {
    const pluginSubtopics = new Set(pluginMap.get(domain) || []);
    const canonicalSlugs = new Set(canonicalSubtopics.map((s) => s.slug));
    const { missing, extra } = compareSets(canonicalSlugs, pluginSubtopics);

    if (missing.length || extra.length) {
      console.error(
        `❌ Mismatch in subtopics for domain "${domain}"! Missing: ${missing.join(', ')} | Extra: ${extra.join(', ')}`,
      );
      errors++;
    }
  }

  // 3. Check Domain Slugs in Search Strategy
  const pluginSlugs = new Set(parsePluginDomainSlugs(SEARCH_SKILL_PATH));
  const { missing: mS, extra: eS } = compareSets(canonicalDomains, pluginSlugs);
  if (mS.length || eS.length) {
    console.error(
      `❌ Mismatch in search-strategy domain slugs! Missing: ${mS.join(', ')} | Extra: ${eS.join(', ')}`,
    );
    errors++;
  }

  // 4. Check Content Types
  const pluginTypes = new Set(
    parsePluginContentTypes(CLASSIFICATION_SKILL_PATH),
  );
  const canonicalTypes = new Set(VALID_CONTENT_TYPES);
  const { missing: mT, extra: eT } = compareSets(canonicalTypes, pluginTypes);
  if (mT.length || eT.length) {
    console.error(
      `❌ Mismatch in content types! Missing: ${mT.join(', ')} | Extra: ${eT.join(', ')}`,
    );
    errors++;
  }

  if (errors > 0) {
    console.error(`\n❌ Validation failed with ${errors} errors.`);
    console.error(
      '👉 Run "bun run sync:plugin-taxonomy" to fix automatically.',
    );
    process.exit(1);
  }

  console.log('✅ Taxonomy validation passed.');
}

async function main(): Promise<void> {
  // Perform validation first
  validate();

  // Verify plugin directory exists
  try {
    await stat(PLUGIN_DIR);
  } catch {
    console.error(`Plugin directory not found: ${PLUGIN_DIR}`);
    process.exit(1);
  }

  const files = await collectFiles(PLUGIN_DIR, PLUGIN_DIR);
  console.log(`Found ${files.length} files in plugin directory`);

  const zip = buildZip(files);
  const base64 = Buffer.from(zip).toString('base64');

  const output = [
    '/**',
    ' * Auto-generated Knowledge Hub plugin ZIP bundle.',
    ' * DO NOT EDIT — regenerated by scripts/bundle-plugin.ts',
    ' * Run: bun run build:plugin',
    ' */',
    '',
    `export const PLUGIN_ZIP_BASE64 = '${base64}';`,
    '',
    `export const PLUGIN_ZIP_SIZE = ${zip.length};`,
    '',
  ].join('\n');

  await writeFile(OUTPUT_PATH, output);
  console.log(
    `Written ${base64.length} chars (${zip.length} bytes ZIP) to ${OUTPUT_PATH}`,
  );
}

main().catch((err) => {
  console.error('Failed to bundle plugin:', err);
  process.exit(1);
});
