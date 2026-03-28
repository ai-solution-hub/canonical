'use client';

import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Link,
  Undo2,
  Redo2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useCallback, useMemo, useState } from 'react';
import { useModifierKey } from '@/hooks/ui/use-modifier-key';

interface EditorToolbarProps {
  editor: Editor | null;
}

interface ToolbarAction {
  icon: React.ElementType;
  label: string;
  shortcut?: string;
  action: (editor: Editor) => void;
  isActive?: (editor: Editor) => boolean;
  disabled?: (editor: Editor) => boolean;
}

function getFormattingActions(mod: string): ToolbarAction[] {
  return [
  {
    icon: Bold,
    label: 'Bold',
    shortcut: `${mod}+B`,
    action: (e) => e.chain().focus().toggleBold().run(),
    isActive: (e) => e.isActive('bold'),
  },
  {
    icon: Italic,
    label: 'Italic',
    shortcut: `${mod}+I`,
    action: (e) => e.chain().focus().toggleItalic().run(),
    isActive: (e) => e.isActive('italic'),
  },
  {
    icon: Underline,
    label: 'Underline',
    shortcut: `${mod}+U`,
    action: (e) => e.chain().focus().toggleUnderline().run(),
    isActive: (e) => e.isActive('underline'),
  },
  {
    icon: Strikethrough,
    label: 'Strikethrough',
    action: (e) => e.chain().focus().toggleStrike().run(),
    isActive: (e) => e.isActive('strike'),
  },
  ];
}

const HEADING_ACTIONS: ToolbarAction[] = [
  {
    icon: Heading1,
    label: 'Heading 1',
    action: (e) => e.chain().focus().toggleHeading({ level: 1 }).run(),
    isActive: (e) => e.isActive('heading', { level: 1 }),
  },
  {
    icon: Heading2,
    label: 'Heading 2',
    action: (e) => e.chain().focus().toggleHeading({ level: 2 }).run(),
    isActive: (e) => e.isActive('heading', { level: 2 }),
  },
  {
    icon: Heading3,
    label: 'Heading 3',
    action: (e) => e.chain().focus().toggleHeading({ level: 3 }).run(),
    isActive: (e) => e.isActive('heading', { level: 3 }),
  },
];

const LIST_ACTIONS: ToolbarAction[] = [
  {
    icon: List,
    label: 'Bullet list',
    action: (e) => e.chain().focus().toggleBulletList().run(),
    isActive: (e) => e.isActive('bulletList'),
  },
  {
    icon: ListOrdered,
    label: 'Numbered list',
    action: (e) => e.chain().focus().toggleOrderedList().run(),
    isActive: (e) => e.isActive('orderedList'),
  },
];

function getHistoryActions(mod: string): ToolbarAction[] {
  return [
    {
      icon: Undo2,
      label: 'Undo',
      shortcut: `${mod}+Z`,
      action: (e) => e.chain().focus().undo().run(),
      disabled: (e) => !e.can().undo(),
    },
    {
      icon: Redo2,
      label: 'Redo',
      shortcut: `${mod}+Shift+Z`,
      action: (e) => e.chain().focus().redo().run(),
      disabled: (e) => !e.can().redo(),
    },
  ];
}

function ToolbarButton({
  editor,
  action,
}: {
  editor: Editor;
  action: ToolbarAction;
}) {
  const Icon = action.icon;
  const isActive = action.isActive?.(editor) ?? false;
  const isDisabled = action.disabled?.(editor) ?? false;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={isActive ? 'secondary' : 'ghost'}
          size="icon-xs"
          onClick={() => action.action(editor)}
          disabled={isDisabled}
          aria-label={action.label}
          aria-pressed={isActive}
          type="button"
        >
          <Icon className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {action.label}
        {action.shortcut && (
          <span className="ml-1.5 text-muted-foreground">({action.shortcut})</span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function EditorToolbar({ editor }: EditorToolbarProps) {
  const [linkUrl, setLinkUrl] = useState('');
  const [showLinkInput, setShowLinkInput] = useState(false);
  const mod = useModifierKey();
  const FORMATTING_ACTIONS = useMemo(() => getFormattingActions(mod), [mod]);
  const HISTORY_ACTIONS = useMemo(() => getHistoryActions(mod), [mod]);

  const handleLinkToggle = useCallback(() => {
    if (!editor) return;

    if (editor.isActive('link')) {
      editor.chain().focus().unsetLink().run();
      return;
    }

    setShowLinkInput(true);
  }, [editor]);

  const handleLinkSubmit = useCallback(() => {
    if (!editor || !linkUrl) return;

    const url = linkUrl.startsWith('http') ? linkUrl : `https://${linkUrl}`;
    editor.chain().focus().setLink({ href: url }).run();
    setLinkUrl('');
    setShowLinkInput(false);
  }, [editor, linkUrl]);

  const handleLinkCancel = useCallback(() => {
    setLinkUrl('');
    setShowLinkInput(false);
  }, []);

  if (!editor) return null;

  return (
    <TooltipProvider>
      <div
        className="flex flex-wrap items-center gap-0.5 border-b px-2 py-1.5"
        role="toolbar"
        aria-label="Text formatting"
      >
        {/* Formatting */}
        <div className="flex items-center gap-0.5">
          {FORMATTING_ACTIONS.map((action) => (
            <ToolbarButton key={action.label} editor={editor} action={action} />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {/* Headings */}
        <div className="flex items-center gap-0.5">
          {HEADING_ACTIONS.map((action) => (
            <ToolbarButton key={action.label} editor={editor} action={action} />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {/* Lists */}
        <div className="flex items-center gap-0.5">
          {LIST_ACTIONS.map((action) => (
            <ToolbarButton key={action.label} editor={editor} action={action} />
          ))}
        </div>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {/* Link */}
        <div className="flex items-center gap-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={editor.isActive('link') ? 'secondary' : 'ghost'}
                size="icon-xs"
                onClick={handleLinkToggle}
                aria-label="Link"
                aria-pressed={editor.isActive('link')}
                type="button"
              >
                <Link className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {editor.isActive('link') ? 'Remove link' : 'Add link'}
            </TooltipContent>
          </Tooltip>

          {showLinkInput && (
            <div className="flex items-center gap-1 ml-1">
              <input
                type="url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkSubmit();
                  if (e.key === 'Escape') handleLinkCancel();
                }}
                placeholder="https://..."
                className="h-6 w-40 rounded border px-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                aria-label="Link URL"
              />
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleLinkSubmit}
                type="button"
                aria-label="Confirm link"
              >
                ✓
              </Button>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={handleLinkCancel}
                type="button"
                aria-label="Cancel link"
              >
                ✕
              </Button>
            </div>
          )}
        </div>

        <div className="mx-1 h-4 w-px bg-border" aria-hidden="true" />

        {/* History */}
        <div className="flex items-center gap-0.5">
          {HISTORY_ACTIONS.map((action) => (
            <ToolbarButton key={action.label} editor={editor} action={action} />
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
