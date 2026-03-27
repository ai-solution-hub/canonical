#!/usr/bin/env bun
/**
 * lib/ folder restructure script
 * Moves domain-clustered files into subdirectories and updates all imports.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const LIB = join(ROOT, 'lib');

const MAPPING: Record<string, string[]> = {
  bid: [
    'bid-export-data.ts',
    'bid-export-docx.ts',
    'bid-export-types.ts',
    'bid-export-xlsx.ts',
    'bid-helpers.ts',
    'bid-queries.ts',
    'bid-state-machine.ts',
  ],
  taxonomy: [
    'taxonomy-format.ts',
    'taxonomy-server.ts',
    'taxonomy.ts',
  ],
  quality: [
    'quality-score.ts',
    'quality-actions.ts',
    'qa-detection.ts',
  ],
  entities: [
    'entity-aliases.ts',
    'entity-dedup.ts',
  ],
  digest: [
    'digest-export.ts',
    'digest-helpers.ts',
  ],
  'source-documents': [
    'source-document-impact.ts',
    'source-document-notifications.ts',
    'document-diff.ts',
  ],
  templates: [
    'template-auto-map.ts',
    'template-coverage.ts',
  ],
  content: [
    'content-suggestions.ts',
    'content-templates.ts',
  ],
  coverage: [
    'coverage-heatmap.ts',
    'cost-estimation.ts',
    'gap-scoring.ts',
  ],
};

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// Validate
let valid = true;
const allFiles = new Set<string>();
for (const [group, files] of Object.entries(MAPPING)) {
  for (const file of files) {
    if (allFiles.has(file)) { console.error(`DUPLICATE: ${file}`); valid = false; }
    allFiles.add(file);
    if (!existsSync(join(LIB, file))) { console.error(`MISSING: lib/${file}`); valid = false; }
  }
}
if (!valid) { console.error('Validation failed'); process.exit(1); }

// Count
const totalMoves = Object.values(MAPPING).reduce((n, f) => n + f.length, 0);
console.log(`\n=== lib/ Restructure ${dryRun ? '(DRY RUN)' : ''} ===`);
console.log(`Files to move: ${totalMoves}\n`);

// Move files
for (const [group, files] of Object.entries(MAPPING)) {
  const targetDir = join(LIB, group);
  console.log(`── ${group}/ (${files.length} files) ──`);

  if (!existsSync(targetDir)) {
    console.log(`  Creating directory: lib/${group}/`);
    if (!dryRun) mkdirSync(targetDir, { recursive: true });
  }

  for (const file of files) {
    const src = join(LIB, file);
    const dest = join(targetDir, file);
    if (!existsSync(src)) { console.log(`  SKIP: ${file}`); continue; }
    console.log(`  mv ${file} → ${group}/${file}`);
    if (!dryRun) renameSync(src, dest);
  }
}

if (dryRun) { console.log('\nDry run complete.'); process.exit(0); }

// Build replacements (longest name first)
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const fileToGroup: Record<string, string> = {};
for (const [group, files] of Object.entries(MAPPING)) {
  for (const f of files) fileToGroup[f.replace(/\.ts$/, '')] = group;
}

const sorted = Object.entries(fileToGroup).sort((a, b) => b[0].length - a[0].length);
const replacements = sorted.map(([name, group]) => ({
  pattern: new RegExp(`@/lib/${escapeRegex(name)}(?=['"\`)])`, 'g'),
  replacement: `@/lib/${group}/${name}`,
}));

// Scan and update imports
const SCAN_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts', 'types', '__tests__', 'mcp-apps', 'e2e', 'scripts'];

function getAllSourceFiles(): string[] {
  const files: string[] = [];
  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (['node_modules', '.next', '.git'].includes(entry.name)) continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  }
  for (const d of SCAN_DIRS) walk(join(ROOT, d));
  return files;
}

console.log('\nScanning source files...');
const sourceFiles = getAllSourceFiles();
console.log(`Found ${sourceFiles.length} files to scan`);

let updated = 0;
for (const sourceFile of sourceFiles) {
  let content = readFileSync(sourceFile, 'utf-8');
  let modified = false;

  for (const { pattern, replacement } of replacements) {
    pattern.lastIndex = 0;
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) { content = newContent; modified = true; }
  }

  if (modified) {
    writeFileSync(sourceFile, content);
    updated++;
    console.log(`  Updated: ${sourceFile.replace(ROOT + '/', '')}`);
  }
}

console.log(`\nDone! Moved ${totalMoves} files, updated ${updated} imports.`);
