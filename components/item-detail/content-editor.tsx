'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import LinkExt from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { useEffect, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { EditorToolbar } from '@/components/item-detail/editor-toolbar';
import { cn } from '@/lib/utils';

/**
 * Save-safety guard threshold. If the new markdown is shorter than
 * `SAVE_SAFETY_MIN_RATIO × previous markdown length` (and previous length > 0),
 * the save is blocked as a defence-in-depth check against silent data loss
 * from schema gaps in the Tiptap instance (e.g. tables pre-S169 table-extension
 * registration). Tune as needed; defaults to 0.8 (20% loss threshold).
 */
export const SAVE_SAFETY_MIN_RATIO = 0.8;

/**
 * Internal helper for guard decisions. Exported for unit tests.
 */
export function shouldBlockSave(
  previousLength: number,
  newLength: number,
  minRatio: number = SAVE_SAFETY_MIN_RATIO,
): boolean {
  if (previousLength <= 0) return false;
  return newLength < previousLength * minRatio;
}

interface ContentEditorProps {
  content: string;
  onChange: (markdown: string) => void;
  onSave?: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: string;
  className?: string;
  autofocus?: boolean;
  labelId?: string;
}

export function ContentEditor({
  content,
  onChange,
  onSave,
  readOnly = false,
  placeholder = 'Start writing...',
  minHeight = '300px',
  className,
  autofocus = false,
  labelId,
}: ContentEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Markdown,
      CharacterCount.configure({
        wordCounter: (text) => text.split(/\s+/).filter(Boolean).length,
      }),
      Placeholder.configure({ placeholder }),
      LinkExt.configure({ openOnClick: false }),
      // Tiptap v3 table node family — registered so GFM tables in markdown
      // parse into real table nodes and round-trip on save. Without these
      // the Tiptap schema has no `table`/`tableRow`/`tableCell`/`tableHeader`
      // nodes, and `@tiptap/markdown` silently drops table content at parse
      // time. Reproducer (pre-fix): item 08726af7-27ec-4540-bf24-9f8332f22b17.
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
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

  // Track the last known-safe markdown length (from parent's `content` prop,
  // which reflects the last-saved version). Used by the save-safety guard
  // below as the "previous length" baseline.
  const lastKnownLengthRef = useRef<number>(content?.length ?? 0);

  // Sync content from parent
  useEffect(() => {
    if (editor && content !== editor.getMarkdown()) {
      editor.commands.setContent(content, { contentType: 'markdown' });
    }
    // Update the save-guard baseline whenever the parent hands us a new
    // canonical value (typically after a successful save or initial load).
    lastKnownLengthRef.current = content?.length ?? 0;
  }, [content, editor]);

  // Ctrl+S / Cmd+S save shortcut with defence-in-depth save-safety guard.
  // If the new markdown is shorter than SAVE_SAFETY_MIN_RATIO × previous
  // length (and previous length > 0), block the save and surface an error —
  // this protects against future schema gaps that would silently drop nodes.
  const handleSave = useCallback(() => {
    if (!onSave) return;
    const nextMarkdown = editor?.getMarkdown() ?? '';
    const previousLength = lastKnownLengthRef.current;
    if (shouldBlockSave(previousLength, nextMarkdown.length)) {
      toast.error(
        'Could not save — content length dropped unexpectedly. Refresh and try again, or contact support if the problem persists.',
      );
      return;
    }
    onSave(nextMarkdown);
  }, [editor, onSave]);

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
