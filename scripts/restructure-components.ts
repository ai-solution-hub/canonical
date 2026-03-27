#!/usr/bin/env bun
/**
 * Component folder restructure script
 * Moves flat component files into domain subdirectories and updates all imports.
 *
 * Usage: bun run scripts/restructure-components.ts [--dry-run] [--group=name]
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();
const COMPONENTS = join(ROOT, 'components');

// ── Complete file-to-directory mapping ──────────────────────────────────────

const MAPPING: Record<string, string[]> = {
  bid: [
    'bid-context-provider.tsx',
    'bid-creation-form.tsx',
    'bid-creation-wizard.tsx',
    'bid-export-menu.tsx',
    'bid-list-card.tsx',
    'bid-outcome.tsx',
    'bid-state-indicator.tsx',
    'question-list.tsx',
    'question-navigator.tsx',
    'question-review.tsx',
    'question-row.tsx',
    'response-actions.tsx',
    'response-editor.tsx',
    'response-version-history.tsx',
    'tender-metadata-prompt.tsx',
    'tender-upload.tsx',
    'template-completion-summary.tsx',
    'template-field-review.tsx',
    'template-fill-progress.tsx',
    'kb-integration-review.tsx',
  ],
  'item-detail': [
    'metadata-sidebar.tsx',
    'item-action-bar.tsx',
    'summary-tabs.tsx',
    'content-editor.tsx',
    'content-renderer.tsx',
    'content-tabs.tsx',
    'organise-section.tsx',
    'related-by-entities.tsx',
    'related-by-tags.tsx',
    'temporal-references-section.tsx',
    'table-of-contents.tsx',
    'version-diff.tsx',
    'version-history.tsx',
    'verification-history.tsx',
    'entity-badges.tsx',
    'entity-co-occurrence.tsx',
    'editor-toolbar.tsx',
  ],
  shared: [
    'confidence-badge.tsx',
    'domain-badge.tsx',
    'freshness-badge.tsx',
    'governance-badge.tsx',
    'quality-badge.tsx',
    'quality-score.tsx',
    'quality-score-breakdown.tsx',
    'similarity-badge.tsx',
    'verification-badge.tsx',
    'content-type-icon.tsx',
    'content-type-header.tsx',
    'priority-selector.tsx',
    'highlight.tsx',
    'error-boundary.tsx',
    'dedup-warning.tsx',
    'star-button.tsx',
    'read-toggle-button.tsx',
    'thumbnail.tsx',
    'tag-autocomplete.tsx',
    'user-tag-input.tsx',
    'expiry-date-display.tsx',
    'streaming-phase-indicator.tsx',
    'ai-processing-indicators.tsx',
  ],
  content: [
    'content-card.tsx',
    'content-grid.tsx',
    'content-list.tsx',
    'content-row.tsx',
    'content-library-drawer.tsx',
    'content-library-result.tsx',
    'content-owner-badge.tsx',
    'content-owner-selector.tsx',
    'content-layer-selector.tsx',
    'delete-content-dialog.tsx',
    'layer-suggestion-banner.tsx',
    'citation-panel.tsx',
    'quick-assign-button.tsx',
    'quick-review-actions.tsx',
    'claude-prompt-button.tsx',
  ],
  browse: [
    'browse-states.tsx',
    'filter-bar.tsx',
    'filter-badges.tsx',
    'filter-panel.tsx',
    'filter-section.tsx',
    'search-bar.tsx',
    'author-filter.tsx',
    'domain-filter.tsx',
    'subtopic-filter.tsx',
    'platform-filter.tsx',
    'content-type-filter.tsx',
    'coverage-layer-filter.tsx',
    'preset-bar.tsx',
    'save-preset-dialog.tsx',
    'manage-presets-dialog.tsx',
    'bulk-action-toolbar.tsx',
    'bulk-actions.tsx',
    'topic-layer-comparison.tsx',
  ],
  'create-content': [
    'file-upload.tsx',
    'file-upload-dialog.tsx',
    'upload-review-step.tsx',
    'upload-tab-content.tsx',
    'url-ingest-form.tsx',
    'ingestion-progress.tsx',
    'ingestion-success-card.tsx',
  ],
  coverage: [
    'coverage-cell.tsx',
    'coverage-domain-section.tsx',
    'coverage-gap-cell.tsx',
    'coverage-guide-card.tsx',
    'coverage-guide-tab.tsx',
    'coverage-heatmap-view.tsx',
    'coverage-summary-cards.tsx',
    'coverage-target-editor.tsx',
    'coverage-target-progress.tsx',
    'template-coverage-content.tsx',
    'template-coverage-requirement.tsx',
    'template-coverage-section.tsx',
    'cost-estimate-dialog.tsx',
    'template-upload.tsx',
  ],
  shell: [
    'auth-aware-chrome.tsx',
    'breadcrumb-nav.tsx',
    'site-header.tsx',
    'notification-bell.tsx',
    'command-palette.tsx',
    'keyboard-shortcuts-overlay.tsx',
    'keyboard-shortcuts-provider.tsx',
    'theme-provider.tsx',
    'theme-settings.tsx',
    'session-guard.tsx',
    'collapsible-group.tsx',
  ],
  dashboard: [
    'activity-feed.tsx',
    'certification-summary-card.tsx',
    'framework-summary-card.tsx',
  ],
  qa: [
    'qa-answer-display.tsx',
    'qa-preview-list.tsx',
    'qa-row.tsx',
    'batch-qa-preview-table.tsx',
  ],
  review: [
    'review-action-bar.tsx',
    'review-card.tsx',
    'review-filters.tsx',
    'review-progress-bar.tsx',
    'review-queue-panel.tsx',
  ],
  reader: [
    'floating-reader.tsx',
    'iframe-viewer.tsx',
    'image-gallery.tsx',
    'pdf-reader-view.tsx',
    'pdf-viewer.tsx',
    'reader-panel.tsx',
    'reader-view.tsx',
    'transcript-reader.tsx',
    'source-metadata.tsx',
  ],
  'source-document': [
    'source-document-diff-review.tsx',
    'source-document-history.tsx',
    'source-document-info.tsx',
    'diff-highlighted-text.tsx',
    'reupload-banner.tsx',
  ],
  workspace: [
    'workspace-card.tsx',
    'workspace-colour-picker.tsx',
    'workspace-create-dialog.tsx',
    'workspace-detail-sheet.tsx',
    'workspace-icon-picker.tsx',
    'workspace-selector.tsx',
  ],
  digest: [
    'digest-domain-section.tsx',
    'digest-export-menu.tsx',
    'digest-view.tsx',
  ],
  guide: [
    'guide-section-banner.tsx',
  ],
};

// ── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const groupArg = args.find(a => a.startsWith('--group='))?.split('=')[1];

// ── Validation ──────────────────────────────────────────────────────────────

function validate(): boolean {
  let valid = true;
  const allFiles = new Set<string>();

  for (const [group, files] of Object.entries(MAPPING)) {
    for (const file of files) {
      if (allFiles.has(file)) {
        console.error(`DUPLICATE: ${file} appears in multiple groups`);
        valid = false;
      }
      allFiles.add(file);

      const src = join(COMPONENTS, file);
      if (!existsSync(src)) {
        console.error(`MISSING: ${src} does not exist`);
        valid = false;
      }
    }
  }

  // Check for flat files NOT in the mapping
  const flatFiles = readdirSync(COMPONENTS).filter(f =>
    f.endsWith('.tsx') || f.endsWith('.ts')
  );

  for (const f of flatFiles) {
    if (!allFiles.has(f)) {
      console.warn(`UNMAPPED: ${f} is not in any group`);
    }
  }

  return valid;
}

// ── Directories to scan for import updates ──────────────────────────────────

const SCAN_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts', 'types', '__tests__', 'mcp-apps', 'e2e'];

function getAllSourceFiles(): string[] {
  const files: string[] = [];

  function walk(dir: string) {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.next' || entry.name === '.git') continue;
        walk(full);
      } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
        files.push(full);
      }
    }
  }

  for (const d of SCAN_DIRS) {
    walk(join(ROOT, d));
  }
  return files;
}

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n=== Component Restructure ${dryRun ? '(DRY RUN)' : ''} ===\n`);

  // Validate mapping
  if (!validate()) {
    console.error('\nValidation failed. Fix errors above before proceeding.');
    process.exit(1);
  }

  const groups = groupArg ? { [groupArg]: MAPPING[groupArg] } : MAPPING;

  if (groupArg && !MAPPING[groupArg]) {
    console.error(`Unknown group: ${groupArg}`);
    process.exit(1);
  }

  // Count totals
  let totalMoves = 0;
  let totalImportUpdates = 0;

  for (const [, files] of Object.entries(groups)) {
    totalMoves += files.length;
  }

  console.log(`Files to move: ${totalMoves}`);
  console.log(`Groups: ${Object.keys(groups).join(', ')}\n`);

  // Build complete replacement map: oldImportSuffix → newImportSuffix
  // Process ALL groups to build the map, even if only moving one group
  const replacements: Array<{ pattern: RegExp; replacement: string }> = [];

  for (const [group, files] of Object.entries(MAPPING)) {
    for (const file of files) {
      const name = file.replace(/\.tsx?$/, '');
      // Match @/components/NAME when followed by quote or closing paren
      // but NOT when already preceded by a slash (already in subdir)
      const regex = new RegExp(
        `(@/components/)${escapeRegex(name)}(?=['"\`)])`,
        'g'
      );
      replacements.push({
        pattern: regex,
        replacement: `$1${group}/${name}`,
      });
    }
  }

  // Process each group — move files
  for (const [group, files] of Object.entries(groups)) {
    const targetDir = join(COMPONENTS, group);

    console.log(`\n── ${group}/ (${files.length} files) ──`);

    // Create directory if needed
    if (!existsSync(targetDir)) {
      console.log(`  Creating directory: components/${group}/`);
      if (!dryRun) {
        mkdirSync(targetDir, { recursive: true });
      }
    }

    // Move files
    for (const file of files) {
      const src = join(COMPONENTS, file);
      const dest = join(targetDir, file);

      if (!existsSync(src)) {
        console.log(`  SKIP (already moved): ${file}`);
        continue;
      }

      console.log(`  mv ${file} → ${group}/${file}`);
      if (!dryRun) {
        renameSync(src, dest);
      }
    }
  }

  // Re-scan source files AFTER all moves so we find files at their new paths
  console.log('\nScanning source files for imports (post-move)...');
  const sourceFiles = getAllSourceFiles();
  console.log(`Found ${sourceFiles.length} source files to scan`);

  // Update ALL imports across the codebase
  console.log('\n── Updating imports ──');

  // Only apply replacements for groups we're processing
  const activeReplacements = groupArg
    ? replacements.filter(r => {
        const group = Object.keys(groups)[0];
        return r.replacement.includes(`$1${group}/`);
      })
    : replacements;

  for (const sourceFile of sourceFiles) {
    if (!existsSync(sourceFile)) continue;
    let content = readFileSync(sourceFile, 'utf-8');
    let modified = false;

    for (const { pattern, replacement } of activeReplacements) {
      const newContent = content.replace(pattern, replacement);
      if (newContent !== content) {
        content = newContent;
        modified = true;
      }
    }

    if (modified) {
      totalImportUpdates++;
      const relPath = sourceFile.replace(ROOT + '/', '');
      if (dryRun) {
        console.log(`  Would update: ${relPath}`);
      }
      if (!dryRun) {
        writeFileSync(sourceFile, content);
      }
    }
  }

  console.log(`\n=== Summary ===`);
  console.log(`Files moved: ${totalMoves}`);
  console.log(`Files with import updates: ${totalImportUpdates}`);

  if (dryRun) {
    console.log('\nThis was a dry run. No changes were made.');
    console.log('Run without --dry-run to apply changes.');
  } else {
    console.log('\nDone! Run `bun run test` and `bun lint` to verify.');
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

main();
