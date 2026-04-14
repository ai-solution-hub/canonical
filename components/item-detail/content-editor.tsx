'use client';

import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExt from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { EditorToolbar } from '@/components/item-detail/editor-toolbar';
import {
  SAVE_SAFETY_BLOCK_MESSAGE,
  shouldBlockSave,
} from '@/lib/editor/save-safety';
import { cn } from '@/lib/utils';

// Re-export for call sites/tests that still reach for these here. The
// canonical home is `@/lib/editor/save-safety`.
export {
  SAVE_SAFETY_MIN_RATIO,
  SAVE_SAFETY_BLOCK_MESSAGE,
  shouldBlockSave,
} from '@/lib/editor/save-safety';

/**
 * Canonical Tiptap extension list for the ContentEditor.
 *
 * Exported so tests can exercise the SAME schema the production component
 * registers, rather than a duplicated array that could drift. This is the
 * single source of truth for which nodes/marks the editor supports.
 *
 * The four `Table*` extensions (added in S169) are load-bearing — without
 * them, `@tiptap/markdown` silently drops GFM tables at parse time because
 * the schema has no `table`/`tableRow`/`tableCell`/`tableHeader` nodes.
 * Reproducer: item 08726af7-27ec-4540-bf24-9f8332f22b17.
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

interface ContentEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  /**
   * Optional Cmd+S / Ctrl+S save handler. When provided, the shortcut is
   * active and the save-safety guard runs first. This is a secondary line
   * of defence — the primary guard on the Save-button path is wired in the
   * parent (see `InlineContentEditor` in content-tabs.tsx).
   */
  onSave?: (markdown: string) => void;
  /**
   * Length (in characters) of the last-persisted canonical markdown. Used as
   * the save-safety baseline. If omitted, falls back to `content.length`,
   * which is correct when `content` is the last-saved value rather than a
   * two-way-bound edit buffer. Call sites that bind `content` to an in-flight
   * edit buffer MUST pass this explicitly (e.g. `item.content?.length`).
   */
  baselineLength?: number;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  autofocus?: boolean;
  labelId?: string;
  /**
   * @internal Test-only hook. Invoked once the Tiptap editor instance is
   * ready so tests can drive it directly (e.g. `editor.commands.setContent`).
   * Not intended for production use — keyed edits should go via `onChange`.
   */
  onEditorReady?: (editor: Editor) => void;
}

export function ContentEditor({
  content,
  onChange,
  onSave,
  baselineLength,
  readOnly = false,
  placeholder = 'Start writing...',
  minHeight = '300px',
  className,
  autofocus = false,
  labelId,
  onEditorReady,
}: ContentEditorProps) {
  const editor = useEditor({
    extensions: buildExtensions(placeholder),
    content,
    contentType: 'markdown',
    editable: !readOnly,
    immediatelyRender: false,
    autofocus: autofocus ? 'end' : false,
    editorProps: {
      attributes: {
        ...(labelId && { 'aria-labelledby': labelId }),
        role: 'textbox',
        'aria-multiline': 'true',
      },
    },
    onUpdate: ({ editor: e }) => {
      onChange(e.getMarkdown());
    },
  });

  // Sync editable state
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // Sync content from parent
  useEffect(() => {
    if (editor && content !== editor.getMarkdown()) {
      editor.commands.setContent(content, { contentType: 'markdown' });
    }
  }, [content, editor]);

  // Test-only: hand back the editor instance once it's ready. Called exactly
  // once per mount. Skipped when the prop isn't provided (production path).
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Ctrl+S / Cmd+S save shortcut with the save-safety guard. Baseline is
  // `baselineLength` (last-persisted markdown length), falling back to the
  // current `content` prop's length for call sites that bind `content` to
  // the saved value. We compare against `editor.getMarkdown().length` so
  // both sides are measured in canonical markdown units.
  const handleSave = useCallback(() => {
    if (!onSave) return;
    const nextMarkdown = editor?.getMarkdown() ?? '';
    const baseline = baselineLength ?? content?.length ?? 0;
    if (shouldBlockSave(baseline, nextMarkdown.length)) {
      toast.error(SAVE_SAFETY_BLOCK_MESSAGE);
      return;
    }
    onSave(nextMarkdown);
  }, [editor, onSave, baselineLength, content]);

  useEffect(() => {
    if (!editor || readOnly || !onSave) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor, readOnly, handleSave, onSave]);

  const wordCount = editor?.storage.characterCount.words() ?? 0;

  return (
    <div className={cn('rounded-md border bg-card', className)}>
      {!readOnly && <EditorToolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className={cn(
          'prose prose-sm max-w-none px-4 py-3',
          'focus-within:outline-none',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:float-left',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:h-0',
        )}
        style={{ minHeight }}
      />
      <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
        <span
          className="tabular-nums text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          {wordCount} {wordCount === 1 ? 'word' : 'words'}
        </span>
      </div>
    </div>
  );
}
