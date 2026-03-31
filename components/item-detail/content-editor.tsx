'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import CharacterCount from '@tiptap/extension-character-count';
import Placeholder from '@tiptap/extension-placeholder';
import UnderlineExt from '@tiptap/extension-underline';
import LinkExt from '@tiptap/extension-link';
import { useEffect, useCallback } from 'react';
import { EditorToolbar } from '@/components/item-detail/editor-toolbar';
import { cn } from '@/lib/utils';

interface ContentEditorProps {
  content: string;
  onChange: (html: string) => void;
  onSave?: (html: string) => void;
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
        underline: false,
      }),
      CharacterCount.configure({
        wordCounter: (text) => text.split(/\s+/).filter(Boolean).length,
      }),
      Placeholder.configure({ placeholder }),
      UnderlineExt,
      LinkExt.configure({ openOnClick: false }),
    ],
    content,
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
      onChange(e.getHTML());
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
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  // Ctrl+S / Cmd+S save shortcut
  const handleSave = useCallback(() => {
    if (onSave) {
      onSave(editor?.getHTML() ?? '');
    }
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
