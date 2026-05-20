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
import { Button } from '@/components/ui/button';
import { EditorToolbar } from '@/components/item-detail/editor-toolbar';
import { cn } from '@/lib/utils';

export type { Editor };

interface ResponseEditorProps {
  content: string;
  wordLimit?: number | null;
  onChange: (markdown: string) => void;
  onSave: (markdown: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
  /** Callback to expose the Tiptap editor instance for external use (e.g., content insertion) */
  onEditorReady?: (editor: Editor) => void;
}

export function ResponseEditor({
  content,
  wordLimit,
  onChange,
  onSave,
  readOnly = false,
  placeholder = 'Start writing your response...',
  className,
  onEditorReady,
}: ResponseEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        link: false,
      }),
      Markdown,
      // S152B WP14 #16: `limit` removed. The previous `limit: wordLimit * 6`
      // caused Tiptap to silently truncate overflowing content from the FRONT
      // on every `setContent` — so a streamed AI draft that exceeded the cap
      // would lose its opening paragraphs. The word limit is now a soft,
      // warning-only indicator shown in the footer (`isOverLimit` branch).
      CharacterCount.configure({
        wordCounter: (text) => text.split(/\s+/).filter(Boolean).length,
      }),
      Placeholder.configure({ placeholder }),
      LinkExt.configure({ openOnClick: false }),
      // Table extensions are load-bearing — without them, @tiptap/markdown
      // silently drops GFM tables at parse time (see content-editor.tsx:38-40).
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content,
    contentType: 'markdown',
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor: e }) => {
      onChange(e.getMarkdown());
    },
  });

  // Expose editor instance to parent
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Sync editable state (e.g., when streaming locks/unlocks the editor)
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  // Sync content from parent (e.g., when AI draft arrives)
  useEffect(() => {
    if (editor && content !== editor.getMarkdown()) {
      editor.commands.setContent(content, { contentType: 'markdown' });
    }
  }, [content, editor]);

  const wordCount = editor?.storage.characterCount.words() ?? 0;
  const isOverLimit = wordLimit ? wordCount > wordLimit : false;
  const isUnderTarget = wordLimit ? wordCount < wordLimit * 0.7 : false;

  const handleSave = useCallback(() => {
    onSave(editor?.getMarkdown() ?? '');
  }, [editor, onSave]);

  // Ctrl+S / Cmd+S save shortcut
  useEffect(() => {
    if (!editor || readOnly) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSave();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editor, readOnly, handleSave]);

  return (
    <div className={cn('rounded-md border bg-card', className)}>
      {!readOnly && <EditorToolbar editor={editor} />}
      <EditorContent
        editor={editor}
        className={cn(
          'prose prose-sm max-w-none px-4 py-3',
          'min-h-[200px]',
          'focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:text-muted-foreground',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)]',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:float-left',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:pointer-events-none',
          '[&_.tiptap_p.is-editor-empty:first-child::before]:h-0',
        )}
      />
      <div className="flex items-center justify-between border-t px-4 py-2 text-sm">
        <span
          className={cn(
            'tabular-nums',
            isOverLimit && 'font-semibold text-destructive',
            isUnderTarget && 'text-status-warning',
            !isOverLimit && !isUnderTarget && 'text-muted-foreground',
          )}
          role="status"
          aria-live="polite"
        >
          {wordCount}
          {wordLimit ? ` / ${wordLimit}` : ''} words
          {isOverLimit && ' — over limit'}
          {isUnderTarget &&
            wordLimit &&
            ` — ${Math.round((wordCount / wordLimit) * 100)}% of target`}
        </span>
        {!readOnly && (
          <Button onClick={handleSave} size="sm" type="button">
            Save
          </Button>
        )}
      </div>
    </div>
  );
}
