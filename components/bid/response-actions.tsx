'use client';

import { useState } from 'react';
import {
  Check,
  RefreshCw,
  Save,
  PenLine,
  Flag,
  Loader2,
  MoreHorizontal,
  SkipForward,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ResponseAction =
  | 'accept'
  | 'save'
  | 'regenerate'
  | 'author_manually'
  | 'flag_for_review';

interface ResponseActionsProps {
  onAction: (action: ResponseAction, instructions?: string) => void;
  reviewStatus: string | null;
  isLoading?: boolean;
  loadingAction?: ResponseAction | null;
  hasDraft?: boolean;
  className?: string;
  /** Index of the next unanswered question, or -1 if none */
  nextUnansweredIndex?: number;
  /** Callback to navigate to the next unanswered question */
  onNextUnanswered?: () => void;
}

export function ResponseActions({
  onAction,
  reviewStatus,
  isLoading = false,
  loadingAction = null,
  hasDraft = false,
  className,
  nextUnansweredIndex = -1,
  onNextUnanswered,
}: ResponseActionsProps) {
  const [showRegenerateInput, setShowRegenerateInput] = useState(false);
  const [regenerateInstructions, setRegenerateInstructions] = useState('');

  const isApproved = reviewStatus === 'approved';

  const handleRegenerate = () => {
    if (!showRegenerateInput) {
      setShowRegenerateInput(true);
      return;
    }
    onAction('regenerate', regenerateInstructions || undefined);
    setRegenerateInstructions('');
    setShowRegenerateInput(false);
  };

  const hasWriteGroup = hasDraft && (!isApproved || true);
  const hasNextUnanswered = nextUnansweredIndex >= 0 && onNextUnanswered;

  return (
    <TooltipProvider>
      <div className={cn('space-y-2', className)}>
        <div
          className="flex flex-wrap items-center gap-2"
          role="toolbar"
          aria-label="Response actions"
        >
          {/* ── Write group: Accept / Save ── */}
          {hasDraft && !isApproved && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => onAction('accept')}
                  disabled={isLoading}
                  size="sm"
                  className="bg-status-success hover:bg-status-success/90 text-primary-foreground"
                  type="button"
                >
                  {loadingAction === 'accept' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Check className="size-4" />
                  )}
                  Accept
                </Button>
              </TooltipTrigger>
              <TooltipContent>Approve this response as final</TooltipContent>
            </Tooltip>
          )}

          {hasDraft && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => onAction('save')}
                  disabled={isLoading}
                  size="sm"
                  type="button"
                >
                  {loadingAction === 'save' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Save className="size-4" />
                  )}
                  Save
                </Button>
              </TooltipTrigger>
              <TooltipContent>Save current edits</TooltipContent>
            </Tooltip>
          )}

          {/* Next unanswered — appears after write actions */}
          {hasNextUnanswered && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={onNextUnanswered}
                  disabled={isLoading}
                  size="sm"
                  type="button"
                  className="gap-1"
                >
                  <SkipForward className="size-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Next unanswered</span>
                  <span className="sm:hidden">Next</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                Jump to question {nextUnansweredIndex + 1}
              </TooltipContent>
            </Tooltip>
          )}

          {/* ── Separator between write and generate groups ── */}
          {hasWriteGroup && (
            <Separator orientation="vertical" className="mx-0.5 h-5" />
          )}

          {/* ── Generate group: Regenerate ── */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                onClick={handleRegenerate}
                disabled={isLoading}
                size="sm"
                type="button"
              >
                {loadingAction === 'regenerate' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                {showRegenerateInput ? 'Send' : 'Regenerate'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              Re-draft with different instructions
            </TooltipContent>
          </Tooltip>

          {/* ── Separator between generate and tools groups ── */}
          {(!hasDraft || (hasDraft && !isApproved)) && (
            <Separator orientation="vertical" className="mx-0.5 h-5" />
          )}

          {/* ── Tools group: More (Author Manually / Flag) ── */}
          {(!hasDraft || (hasDraft && !isApproved)) && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isLoading}
                      type="button"
                    >
                      <MoreHorizontal className="size-4" />
                      More
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent>More actions</TooltipContent>
              </Tooltip>
              <DropdownMenuContent align="end">
                {!hasDraft && (
                  <DropdownMenuItem onClick={() => onAction('author_manually')}>
                    <PenLine className="mr-2 size-4" aria-hidden="true" />
                    Author Manually
                  </DropdownMenuItem>
                )}
                {hasDraft && !isApproved && (
                  <DropdownMenuItem onClick={() => onAction('flag_for_review')}>
                    {loadingAction === 'flag_for_review' ? (
                      <Loader2
                        className="mr-2 size-4 animate-spin"
                        aria-hidden="true"
                      />
                    ) : (
                      <Flag className="mr-2 size-4" aria-hidden="true" />
                    )}
                    Flag for Review
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {/* Regenerate instructions input */}
        {showRegenerateInput && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={regenerateInstructions}
              onChange={(e) => setRegenerateInstructions(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRegenerate();
                if (e.key === 'Escape') {
                  setShowRegenerateInput(false);
                  setRegenerateInstructions('');
                }
              }}
              placeholder="E.g. Focus more on ISO 27001 compliance..."
              className="h-8 flex-1 rounded-md border px-3 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              aria-label="Regeneration instructions"
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setShowRegenerateInput(false);
                setRegenerateInstructions('');
              }}
              type="button"
            >
              Cancel
            </Button>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}
