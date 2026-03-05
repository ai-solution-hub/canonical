import type { Editor } from '@tiptap/react';

export interface InsertLibraryContentOptions {
  /** Tiptap editor instance (null if not yet mounted) */
  editor: Editor | null;
  /** HTML content to insert */
  html: string;
  /** UUID of the source KB item */
  sourceId: string;
  /** Human-readable title of the source KB item */
  sourceTitle: string;
  /** Whether to append a citation superscript (default true) */
  addCitation?: boolean;
}

/**
 * Inserts content from the Knowledge Base library into a Tiptap editor.
 * Focuses the editor, inserts the HTML at the cursor position, and optionally
 * appends a citation superscript marker with data attributes for tracking.
 *
 * Citation marker format:
 *   <sup class="citation-ref" data-source-id="uuid" data-source-title="Title">[Source: Title]</sup>
 */
export function insertLibraryContent({
  editor,
  html,
  sourceId,
  sourceTitle,
  addCitation = true,
}: InsertLibraryContentOptions): boolean {
  if (!editor) return false;

  const citationHtml = addCitation
    ? `<sup class="citation-ref" data-source-id="${sourceId}" data-source-title="${sourceTitle.replace(/"/g, '&quot;')}">[Source: ${sourceTitle}]</sup>`
    : '';

  const contentToInsert = addCitation ? `${html}${citationHtml}` : html;

  editor.chain().focus().insertContent(contentToInsert).run();
  return true;
}
