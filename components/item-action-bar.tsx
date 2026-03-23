'use client';

import {
  ExternalLink,
  FileText,
  BookOpen,
  Copy,
  Pencil,
  Eye,
  MoreHorizontal,
  Trash2,
  ChevronDown,
} from 'lucide-react';
import { ReadToggleButton } from '@/components/read-toggle-button';
import { StarButton } from '@/components/star-button';
import { PrioritySelector, type Priority } from '@/components/priority-selector';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { DeleteContentDialog } from '@/components/delete-content-dialog';
import dynamic from 'next/dynamic';

import type { ItemData } from '@/app/item/[id]/item-detail-client';

const PdfViewer = dynamic(
  () => import('@/components/pdf-viewer').then((mod) => mod.PdfViewer),
  { ssr: false, loading: () => <div className="h-9 w-24 animate-pulse rounded bg-accent" /> },
);

export interface ItemActionBarProps {
  item: ItemData;
  canEdit: boolean;
  canAdmin: boolean;
  isEditing: boolean;
  isQAPair: boolean;
  isAnalysing: boolean;
  copied: boolean;
  hasReaderContent: boolean;
  title: string;
  readerOpen: boolean;
  enterEditMode: () => void;
  cancelEditMode: () => void;
  handleCopyLink: () => void;
  handleCopyAnswer: (variant?: 'standard' | 'advanced') => void;
  handleVisionAnalysis: () => void;
  toggleReader: () => void;
  setItem: React.Dispatch<React.SetStateAction<ItemData>>;
}

export function ItemActionBar({
  item,
  canEdit,
  canAdmin,
  isEditing,
  isQAPair,
  isAnalysing,
  copied,
  hasReaderContent,
  title,
  readerOpen,
  enterEditMode,
  cancelEditMode,
  handleCopyLink,
  handleCopyAnswer,
  handleVisionAnalysis,
  toggleReader,
  setItem,
}: ItemActionBarProps) {
  return (
    <div className="sticky top-0 z-10 mb-6 flex flex-wrap items-center gap-2 bg-background py-2 sm:static sm:z-auto">
      <ReadToggleButton itemId={item.id as string} />
      {canEdit && (
        <Button
          variant={isEditing ? 'outline' : 'default'}
          size="sm"
          onClick={isEditing ? cancelEditMode : enterEditMode}
          className="gap-1.5"
        >
          <Pencil className="size-3.5" />
          {isEditing ? 'Cancel edit' : 'Edit'}
        </Button>
      )}
      {isQAPair ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Copy className="size-3.5" />
              Copy answer
              <ChevronDown className="size-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {item.answer_standard && (
              <DropdownMenuItem onClick={() => handleCopyAnswer('standard')}>
                Copy Standard
              </DropdownMenuItem>
            )}
            {item.answer_advanced && (
              <DropdownMenuItem onClick={() => handleCopyAnswer('advanced')}>
                Copy Advanced
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => handleCopyAnswer()}>
              Copy All
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => handleCopyAnswer()}
          aria-label="Copy content to clipboard"
        >
          <Copy className="size-3.5" />
          Copy content
        </Button>
      )}
      <StarButton
        itemId={item.id}
        starred={item.metadata?.starred === true}
        size="md"
      />
      <PrioritySelector
        itemId={item.id}
        priority={(item.priority as Priority) ?? null}
        size="md"
        onChanged={(p) => setItem((prev) => ({ ...prev, priority: p }))}
      />

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="size-9 p-0" aria-label="More actions">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasReaderContent && (
            <DropdownMenuItem onClick={toggleReader}>
              <BookOpen className="size-4" />
              {readerOpen ? 'Close Reader' : 'Open Reader'}
            </DropdownMenuItem>
          )}
          {item.source_url && (
            <DropdownMenuItem onClick={() => window.open(item.source_url as string, '_blank')}>
              <ExternalLink className="size-4" />
              Open original
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={handleCopyLink}>
            <Copy className="size-4" />
            {copied ? 'Copied!' : 'Copy link'}
          </DropdownMenuItem>
          {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
            <DropdownMenuItem onClick={() => {
              const btn = document.querySelector<HTMLButtonElement>('[data-pdf-trigger]');
              btn?.click();
            }}>
              <FileText className="size-4" />
              View PDF
            </DropdownMenuItem>
          )}
          {item.content_type === 'pdf' && (
            <DropdownMenuItem onClick={handleVisionAnalysis} disabled={isAnalysing}>
              <Eye className="size-4" />
              {isAnalysing ? 'Analysing\u2026' : 'Visual Analysis'}
            </DropdownMenuItem>
          )}
          {canAdmin && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => {
                  const btn = document.querySelector<HTMLButtonElement>('[data-delete-trigger]');
                  btn?.click();
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Hidden triggers for dynamic components */}
      {item.content_type === 'pdf' && (item.source_url || item.file_path) && (
        <div className="hidden">
          <PdfViewer
            sourceUrl={item.source_url ?? undefined}
            filePath={item.file_path ?? undefined}
            title={title}
          />
        </div>
      )}
      {canAdmin && (
        <div className="hidden">
          <DeleteContentDialog
            itemId={item.id}
            itemTitle={title}
          />
        </div>
      )}
    </div>
  );
}
