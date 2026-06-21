import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExt from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';

/**
 * Canonical Tiptap extension list shared by every markdown editor in the app
 * (`ContentEditor`, `ResponseEditor`). Single source of truth for which
 * nodes/marks the editors support — re-inlining this array anywhere risks the
 * two editors' schemas drifting apart.
 *
 * The four `Table*` extensions (added in S169) are load-bearing — without them,
 * `@tiptap/markdown` silently drops GFM tables at parse time because the schema
 * has no `table`/`tableRow`/`tableCell`/`tableHeader` nodes.
 * Reproducer: item 08726af7-27ec-4540-bf24-9f8332f22b17.
 *
 * `CharacterCount` is deliberately configured WITHOUT a `limit` (S152B WP14
 * #16): a hard limit made Tiptap silently truncate overflowing content from the
 * FRONT on every `setContent`, so a streamed AI draft exceeding the cap lost
 * its opening paragraphs. Word limits are surfaced as soft, warning-only
 * indicators by the consuming component instead.
 */
export function buildExtensions(placeholder = 'Start writing...') {
  return [
    StarterKit.configure({
      link: false,
    }),
    Markdown,
    CharacterCount.configure({
      wordCounter: (text) => text.split(/\s+/).filter(Boolean).length,
    }),
    Placeholder.configure({ placeholder }),
    LinkExt.configure({ openOnClick: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
  ];
}
