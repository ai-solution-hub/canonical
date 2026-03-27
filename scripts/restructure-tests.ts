#!/usr/bin/env bun
/**
 * __tests__/ root cleanup — move 41 test files to appropriate subdirectories.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const TESTS = join(ROOT, '__tests__');

const MAPPING: Record<string, string[]> = {
  lib: [
    'ai-classify-entities.test.ts',
    'ai-parse.test.ts',
    'attention.test.ts',
    'bid-export-docx.test.ts',
    'bid-export-xlsx.test.ts',
    'bid-matching.test.ts',
    'bid-state-machine.test.ts',
    'change-summary.test.ts',
    'citations.test.ts',
    'client-config.test.ts',
    'cost-estimation.test.ts',
    'cron-auth.test.ts',
    'digest-export.test.ts',
    'editor-utils.test.ts',
    'entity-dedup.test.ts',
    'format.test.ts',
    'freshness.test.ts',
    'jsonb.test.ts',
    'notifications.test.ts',
    'quality-check.test.ts',
    'template-auto-map.test.ts',
    'template-coverage.test.ts',
    'utils.test.ts',
  ],
  mcp: [
    'mcp-app-contracts.test.ts',
    'mcp-app-formatters.test.ts',
    'mcp-app-trigger-tools.test.ts',
    'mcp-app-ui-logic.test.ts',
    'mcp-entity-formatters.test.ts',
    'mcp-new-tools.test.ts',
    'mcp-tools-entity.test.ts',
    'plugin-taxonomy-consistency.test.ts',
  ],
  validation: [
    'bid-schemas.test.ts',
    'content-metadata-schema.test.ts',
    'schemas.test.ts',
    'template-schemas.test.ts',
    'validation.test.ts',
  ],
  api: [
    'batch-reclassify.test.ts',
    'bid-drafting-pipeline.test.ts',
    'bid-drafting.test.ts',
    'draft-and-tags.test.ts',
    'tag-management-rpcs.test.ts',
  ],
};

const dryRun = process.argv.includes('--dry-run');

// Validate
let valid = true;
const all = new Set<string>();
for (const [, files] of Object.entries(MAPPING)) {
  for (const f of files) {
    if (all.has(f)) { console.error(`DUPLICATE: ${f}`); valid = false; }
    all.add(f);
    if (!existsSync(join(TESTS, f))) { console.error(`MISSING: __tests__/${f}`); valid = false; }
  }
}
if (!valid) process.exit(1);

const total = Object.values(MAPPING).reduce((n, f) => n + f.length, 0);
console.log(`\n=== __tests__/ Cleanup ${dryRun ? '(DRY RUN)' : ''} — ${total} files ===\n`);

// Move files
for (const [group, files] of Object.entries(MAPPING)) {
  const targetDir = join(TESTS, group);
  console.log(`── ${group}/ (${files.length} files) ──`);

  if (!existsSync(targetDir)) {
    console.log(`  Creating: __tests__/${group}/`);
    if (!dryRun) mkdirSync(targetDir, { recursive: true });
  }

  for (const file of files) {
    const src = join(TESTS, file);
    const dest = join(targetDir, file);
    if (!existsSync(src)) { console.log(`  SKIP: ${file}`); continue; }
    console.log(`  mv ${file} → ${group}/${file}`);
    if (!dryRun) renameSync(src, dest);
  }
}

if (dryRun) { console.log('\nDry run complete.'); process.exit(0); }

// Fix relative imports in moved files
// ai-classify-entities.test.ts: ./helpers/mock-supabase → ../helpers/mock-supabase
const aiClassify = join(TESTS, 'lib', 'ai-classify-entities.test.ts');
if (existsSync(aiClassify)) {
  let content = readFileSync(aiClassify, 'utf-8');
  content = content.replace("from './helpers/mock-supabase'", "from '../helpers/mock-supabase'");
  writeFileSync(aiClassify, content);
  console.log('\nFixed relative import in lib/ai-classify-entities.test.ts');
}

// plugin-taxonomy-consistency.test.ts: ../lib/ → ../../lib/, ../scripts/ → ../../scripts/
const pluginTax = join(TESTS, 'mcp', 'plugin-taxonomy-consistency.test.ts');
if (existsSync(pluginTax)) {
  let content = readFileSync(pluginTax, 'utf-8');
  content = content.replace(/from '\.\.\/lib\//g, "from '../../lib/");
  content = content.replace(/from '\.\.\/scripts\//g, "from '../../scripts/");
  writeFileSync(pluginTax, content);
  console.log('Fixed relative imports in mcp/plugin-taxonomy-consistency.test.ts');
}

console.log(`\nDone! Moved ${total} files.`);
