import { diffWords } from 'diff';

/**
 * Generate a programmatic diff description for content item changes.
 *
 * Compares old and new state for a single field and returns a human-readable
 * summary of what changed. When multiple fields change, call this per-field
 * and join the results.
 */

interface FieldChange {
  field: string;
  oldValue: unknown;
  newValue: unknown;
}

/**
 * Count words that were added or removed between two strings using word-level diff.
 */
function countWordChanges(oldText: string, newText: string): number {
  const changes = diffWords(oldText, newText);
  let changedWords = 0;
  for (const part of changes) {
    if (part.added || part.removed) {
      // Count words in the changed part
      const words = part.value.trim().split(/\s+/).filter(Boolean);
      changedWords += words.length;
    }
  }
  return changedWords;
}

/**
 * Summarise a single field change as a human-readable string.
 */
function summariseFieldChange(change: FieldChange): string {
  const { field, oldValue, newValue } = change;

  switch (field) {
    case 'suggested_title': {
      const oldTitle = String(oldValue ?? '');
      const newTitle = String(newValue ?? '');
      if (oldTitle && newTitle && oldTitle !== newTitle) {
        return `Title updated from '${oldTitle}' to '${newTitle}'`;
      }
      if (!oldTitle && newTitle) {
        return `Title set to '${newTitle}'`;
      }
      return `Title cleared`;
    }

    case 'content': {
      const oldContent = String(oldValue ?? '');
      const newContent = String(newValue ?? '');
      const wordCount = countWordChanges(oldContent, newContent);
      return `Content updated (${wordCount} word${wordCount === 1 ? '' : 's'} changed)`;
    }

    case 'ai_keywords':
    case 'user_tags': {
      const label = field === 'ai_keywords' ? 'Keywords' : 'User tags';
      const oldKeywords = Array.isArray(oldValue) ? oldValue : [];
      const newKeywords = Array.isArray(newValue) ? newValue : [];
      const oldSet = new Set(oldKeywords);
      const newSet = new Set(newKeywords);
      const added = newKeywords.filter((k: string) => !oldSet.has(k));
      const removed = oldKeywords.filter((k: string) => !newSet.has(k));

      const parts: string[] = [];
      if (added.length > 0) parts.push(`added [${added.join(', ')}]`);
      if (removed.length > 0) parts.push(`removed [${removed.join(', ')}]`);

      if (parts.length === 0) return `${label} unchanged`;
      return `${label} updated: ${parts.join(', ')}`;
    }

    case 'primary_domain':
    case 'primary_subtopic': {
      const oldVal = String(oldValue ?? 'none');
      const newVal = String(newValue ?? 'none');
      const label = field === 'primary_domain' ? 'domain' : 'subtopic';
      return `Reclassified ${label} from ${oldVal} to ${newVal}`;
    }

    case 'secondary_domain':
    case 'secondary_subtopic': {
      const oldVal = String(oldValue ?? 'none');
      const newVal = String(newValue ?? 'none');
      const label =
        field === 'secondary_domain'
          ? 'secondary domain'
          : 'secondary subtopic';
      return `Secondary classification changed: ${label} from ${oldVal} to ${newVal}`;
    }

    case 'priority': {
      const oldPriority = oldValue ? String(oldValue) : 'unset';
      const newPriority = newValue ? String(newValue) : 'unset';
      return `Priority changed from ${oldPriority} to ${newPriority}`;
    }

    case 'summary': {
      return 'Summary updated';
    }

    case 'content_type': {
      return `Content type changed from ${String(oldValue ?? 'unknown')} to ${String(newValue ?? 'unknown')}`;
    }

    case 'platform': {
      return `Platform changed from ${String(oldValue ?? 'unknown')} to ${String(newValue ?? 'unknown')}`;
    }

    case 'author_name': {
      return `Author changed from '${String(oldValue ?? '')}' to '${String(newValue ?? '')}'`;
    }

    default:
      return `${field} updated`;
  }
}

/**
 * Generate a change summary from a list of field changes.
 * Returns a comma-separated summary of all changes.
 */
export function generateChangeSummary(changes: FieldChange[]): string {
  if (changes.length === 0) return 'No changes detected';
  return changes.map(summariseFieldChange).join(', ');
}

/**
 * Generate a change summary for a single field change.
 * Convenience wrapper for the single-field PATCH pattern used in the API.
 */
export function generateSingleFieldChangeSummary(
  field: string,
  oldValue: unknown,
  newValue: unknown,
): string {
  return summariseFieldChange({ field, oldValue, newValue });
}
