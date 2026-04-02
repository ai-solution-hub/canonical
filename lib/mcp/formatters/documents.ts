/**
 * Document diff formatters for MCP tool responses.
 */
import { truncate } from './shared';

// ---------------------------------------------------------------------------
// Document diff
// ---------------------------------------------------------------------------

export interface DocumentDiffData {
  old_filename: string;
  new_filename: string;
  diff_mode?: 'qa' | 'full_text';
  summary: {
    added: number;
    removed: number;
    modified: number;
    unchanged: number;
    total_old: number;
    total_new: number;
  };
  entries: Array<{
    diff_type: 'added' | 'removed' | 'modified' | 'unchanged';
    diff_mode?: 'qa' | 'full_text';
    old_question?: string;
    new_question?: string;
    old_content?: string;
    new_content?: string;
    similarity_score?: number;
    affected_item?: { id: string; title: string } | null;
  }>;
}

/** Maximum length for content fields in diff tables */
const CONTENT_TRUNCATE_LENGTH = 200;

export function formatDocumentDiff(data: DocumentDiffData): string {
  const lines: string[] = [];
  const mode = data.diff_mode ?? 'qa';
  const isFullText = mode === 'full_text';

  // Unit labels differ by mode
  const unit = isFullText ? 'block' : 'Q&A pair';
  const units = (count: number) => (count === 1 ? unit : `${unit}s`);

  lines.push(
    `# Document Diff: ${data.old_filename} \u2192 ${data.new_filename}`,
  );
  lines.push('');

  // Summary
  lines.push('## Summary');
  lines.push(
    `- **Added:** ${data.summary.added} new ${units(data.summary.added)}`,
  );
  lines.push(
    `- **Removed:** ${data.summary.removed} ${units(data.summary.removed)}`,
  );
  lines.push(
    `- **Modified:** ${data.summary.modified} ${units(data.summary.modified)} changed`,
  );
  lines.push(
    `- **Unchanged:** ${data.summary.unchanged} ${units(data.summary.unchanged)} identical`,
  );
  if (isFullText) {
    lines.push(`- **Mode:** Full-text diff (line-level comparison)`);
  }
  lines.push('');

  const added = data.entries.filter((e) => e.diff_type === 'added');
  const modified = data.entries.filter((e) => e.diff_type === 'modified');
  const removed = data.entries.filter((e) => e.diff_type === 'removed');

  if (isFullText) {
    // Full-text mode: use "Text block" columns instead of "Question | Answer"

    // Added section
    if (added.length > 0) {
      lines.push(`### Added (${added.length})`);
      lines.push('');
      lines.push('| # | Text block |');
      lines.push('|---|-----------|');
      for (let i = 0; i < added.length; i++) {
        const entry = added[i];
        const content = truncate(
          entry.new_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        lines.push(`| ${i + 1} | ${content} |`);
      }
      lines.push('');
    }

    // Modified section
    if (modified.length > 0) {
      lines.push(`### Modified (${modified.length})`);
      lines.push('');
      lines.push('| # | Old text | New text |');
      lines.push('|---|----------|----------|');
      for (let i = 0; i < modified.length; i++) {
        const entry = modified[i];
        const oldText = truncate(
          entry.old_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const newText = truncate(
          entry.new_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        lines.push(`| ${i + 1} | ${oldText} | ${newText} |`);
      }
      lines.push('');
    }

    // Removed section
    if (removed.length > 0) {
      lines.push(`### Removed (${removed.length})`);
      lines.push('');
      lines.push('| # | Text block |');
      lines.push('|---|-----------|');
      for (let i = 0; i < removed.length; i++) {
        const entry = removed[i];
        const content = truncate(
          entry.old_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        lines.push(`| ${i + 1} | ${content} |`);
      }
      lines.push('');
    }
  } else {
    // Q&A mode: original Question | Answer columns

    // Added section
    if (added.length > 0) {
      lines.push(`### Added (${added.length})`);
      lines.push('');
      lines.push('| # | Question | Answer |');
      lines.push('|---|----------|--------|');
      for (let i = 0; i < added.length; i++) {
        const entry = added[i];
        const question = truncate(
          entry.new_question ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const answer = truncate(
          entry.new_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        lines.push(`| ${i + 1} | ${question} | ${answer} |`);
      }
      lines.push('');
    }

    // Modified section
    if (modified.length > 0) {
      lines.push(`### Modified (${modified.length})`);
      lines.push('');
      lines.push(
        '| # | Old Question | New Question | Similarity | Affected KB Item |',
      );
      lines.push(
        '|---|-------------|-------------|-----------|-----------------|',
      );
      for (let i = 0; i < modified.length; i++) {
        const entry = modified[i];
        const oldQ = truncate(
          entry.old_question ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const newQ = truncate(
          entry.new_question ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const similarity =
          entry.similarity_score !== undefined
            ? `${Math.round(entry.similarity_score * 100)}%`
            : 'N/A';
        const affected = entry.affected_item
          ? truncate(entry.affected_item.title, CONTENT_TRUNCATE_LENGTH)
          : '\u2014';
        lines.push(
          `| ${i + 1} | ${oldQ} | ${newQ} | ${similarity} | ${affected} |`,
        );
      }
      lines.push('');
    }

    // Removed section
    if (removed.length > 0) {
      lines.push(`### Removed (${removed.length})`);
      lines.push('');
      lines.push('| # | Question | Answer | Affected KB Item |');
      lines.push('|---|----------|--------|-----------------|');
      for (let i = 0; i < removed.length; i++) {
        const entry = removed[i];
        const question = truncate(
          entry.old_question ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const answer = truncate(
          entry.old_content ?? '',
          CONTENT_TRUNCATE_LENGTH,
        );
        const affected = entry.affected_item
          ? truncate(entry.affected_item.title, CONTENT_TRUNCATE_LENGTH)
          : '\u2014';
        lines.push(`| ${i + 1} | ${question} | ${answer} | ${affected} |`);
      }
      lines.push('');
    }
  }

  // If no changes at all
  if (added.length === 0 && modified.length === 0 && removed.length === 0) {
    lines.push('No changes detected between the two document versions.');
    lines.push('');
  }

  return lines.join('\n');
}
