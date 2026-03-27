#!/usr/bin/env bun
/**
 * Update all @/components/ import paths after component restructure.
 * Run this after files have been moved to their new directories.
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const ROOT = process.cwd();

// filename (no ext) → target group
const FILE_TO_GROUP: Record<string, string> = {
  // bid/
  'bid-context-provider': 'bid',
  'bid-creation-form': 'bid',
  'bid-creation-wizard': 'bid',
  'bid-export-menu': 'bid',
  'bid-list-card': 'bid',
  'bid-outcome': 'bid',
  'bid-state-indicator': 'bid',
  'question-list': 'bid',
  'question-navigator': 'bid',
  'question-review': 'bid',
  'question-row': 'bid',
  'response-actions': 'bid',
  'response-editor': 'bid',
  'response-version-history': 'bid',
  'tender-metadata-prompt': 'bid',
  'tender-upload': 'bid',
  'template-completion-summary': 'bid',
  'template-field-review': 'bid',
  'template-fill-progress': 'bid',
  'kb-integration-review': 'bid',
  // item-detail/
  'metadata-sidebar': 'item-detail',
  'item-action-bar': 'item-detail',
  'summary-tabs': 'item-detail',
  'content-editor': 'item-detail',
  'content-renderer': 'item-detail',
  'content-tabs': 'item-detail',
  'organise-section': 'item-detail',
  'related-by-entities': 'item-detail',
  'related-by-tags': 'item-detail',
  'temporal-references-section': 'item-detail',
  'table-of-contents': 'item-detail',
  'version-diff': 'item-detail',
  'version-history': 'item-detail',
  'verification-history': 'item-detail',
  'entity-badges': 'item-detail',
  'entity-co-occurrence': 'item-detail',
  'editor-toolbar': 'item-detail',
  // shared/
  'confidence-badge': 'shared',
  'domain-badge': 'shared',
  'freshness-badge': 'shared',
  'governance-badge': 'shared',
  'quality-badge': 'shared',
  'quality-score': 'shared',
  'quality-score-breakdown': 'shared',
  'similarity-badge': 'shared',
  'verification-badge': 'shared',
  'content-type-icon': 'shared',
  'content-type-header': 'shared',
  'priority-selector': 'shared',
  'highlight': 'shared',
  'error-boundary': 'shared',
  'dedup-warning': 'shared',
  'star-button': 'shared',
  'read-toggle-button': 'shared',
  'thumbnail': 'shared',
  'tag-autocomplete': 'shared',
  'user-tag-input': 'shared',
  'expiry-date-display': 'shared',
  'streaming-phase-indicator': 'shared',
  'ai-processing-indicators': 'shared',
  // content/
  'content-card': 'content',
  'content-grid': 'content',
  'content-list': 'content',
  'content-row': 'content',
  'content-library-drawer': 'content',
  'content-library-result': 'content',
  'content-owner-badge': 'content',
  'content-owner-selector': 'content',
  'content-layer-selector': 'content',
  'delete-content-dialog': 'content',
  'layer-suggestion-banner': 'content',
  'citation-panel': 'content',
  'quick-assign-button': 'content',
  'quick-review-actions': 'content',
  'claude-prompt-button': 'content',
  // browse/
  'browse-states': 'browse',
  'filter-bar': 'browse',
  'filter-badges': 'browse',
  'filter-panel': 'browse',
  'filter-section': 'browse',
  'search-bar': 'browse',
  'author-filter': 'browse',
  'domain-filter': 'browse',
  'subtopic-filter': 'browse',
  'platform-filter': 'browse',
  'content-type-filter': 'browse',
  'coverage-layer-filter': 'browse',
  'preset-bar': 'browse',
  'save-preset-dialog': 'browse',
  'manage-presets-dialog': 'browse',
  'bulk-action-toolbar': 'browse',
  'bulk-actions': 'browse',
  'topic-layer-comparison': 'browse',
  // create-content/
  'file-upload': 'create-content',
  'file-upload-dialog': 'create-content',
  'upload-review-step': 'create-content',
  'upload-tab-content': 'create-content',
  'url-ingest-form': 'create-content',
  'ingestion-progress': 'create-content',
  'ingestion-success-card': 'create-content',
  // coverage/
  'coverage-cell': 'coverage',
  'coverage-domain-section': 'coverage',
  'coverage-gap-cell': 'coverage',
  'coverage-guide-card': 'coverage',
  'coverage-guide-tab': 'coverage',
  'coverage-heatmap-view': 'coverage',
  'coverage-summary-cards': 'coverage',
  'coverage-target-editor': 'coverage',
  'coverage-target-progress': 'coverage',
  'template-coverage-content': 'coverage',
  'template-coverage-requirement': 'coverage',
  'template-coverage-section': 'coverage',
  'cost-estimate-dialog': 'coverage',
  'template-upload': 'coverage',
  // shell/
  'auth-aware-chrome': 'shell',
  'breadcrumb-nav': 'shell',
  'site-header': 'shell',
  'notification-bell': 'shell',
  'command-palette': 'shell',
  'keyboard-shortcuts-overlay': 'shell',
  'keyboard-shortcuts-provider': 'shell',
  'theme-provider': 'shell',
  'theme-settings': 'shell',
  'session-guard': 'shell',
  'collapsible-group': 'shell',
  // dashboard/
  'activity-feed': 'dashboard',
  'certification-summary-card': 'dashboard',
  'framework-summary-card': 'dashboard',
  // qa/
  'qa-answer-display': 'qa',
  'qa-preview-list': 'qa',
  'qa-row': 'qa',
  'batch-qa-preview-table': 'qa',
  // review/
  'review-action-bar': 'review',
  'review-card': 'review',
  'review-filters': 'review',
  'review-progress-bar': 'review',
  'review-queue-panel': 'review',
  // reader/
  'floating-reader': 'reader',
  'iframe-viewer': 'reader',
  'image-gallery': 'reader',
  'pdf-reader-view': 'reader',
  'pdf-viewer': 'reader',
  'reader-panel': 'reader',
  'reader-view': 'reader',
  'transcript-reader': 'reader',
  'source-metadata': 'reader',
  // source-document/
  'source-document-diff-review': 'source-document',
  'source-document-history': 'source-document',
  'source-document-info': 'source-document',
  'diff-highlighted-text': 'source-document',
  'reupload-banner': 'source-document',
  // workspace/
  'workspace-card': 'workspace',
  'workspace-colour-picker': 'workspace',
  'workspace-create-dialog': 'workspace',
  'workspace-detail-sheet': 'workspace',
  'workspace-icon-picker': 'workspace',
  'workspace-selector': 'workspace',
  // digest/
  'digest-domain-section': 'digest',
  'digest-export-menu': 'digest',
  'digest-view': 'digest',
  // guide/
  'guide-section-banner': 'guide',
};

const SCAN_DIRS = ['app', 'components', 'lib', 'hooks', 'contexts', 'types', '__tests__', 'mcp-apps', 'e2e'];

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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build regex replacements sorted by length (longest first to avoid partial matches)
const sortedEntries = Object.entries(FILE_TO_GROUP).sort((a, b) => b[0].length - a[0].length);
const replacements = sortedEntries.map(([name, group]) => ({
  pattern: new RegExp(`@/components/${escapeRegex(name)}(?=['"\`)])`, 'g'),
  replacement: `@/components/${group}/${name}`,
}));

console.log('Scanning source files...');
const sourceFiles = getAllSourceFiles();
console.log(`Found ${sourceFiles.length} files to scan`);

let updated = 0;
for (const sourceFile of sourceFiles) {
  let content = readFileSync(sourceFile, 'utf-8');
  let modified = false;

  for (const { pattern, replacement } of replacements) {
    pattern.lastIndex = 0;
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      content = newContent;
      modified = true;
    }
  }

  if (modified) {
    writeFileSync(sourceFile, content);
    updated++;
    console.log(`  Updated: ${sourceFile.replace(ROOT + '/', '')}`);
  }
}

console.log(`\nDone! Updated ${updated} files.`);
