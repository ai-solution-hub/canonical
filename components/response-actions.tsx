'use client';

import { useState } from 'react';
import {
  Check,
  RefreshCw,
  Save,
  PenLine,
  Flag,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
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
}

export function ResponseActions({
  onAction,
  reviewStatus,
  isLoading = false,
  loadingAction = null,
  hasDraft = false,
  className,
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

  return (
    <TooltipProvider>
      <div className={cn('space-y-2', className)}>
        <div className="flex flex-wrap items-center gap-2">
          {/* Accept */}
          {hasDraft && !isApproved && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => onAction('accept')}
                  disabled={isLoading}
                  size="sm"
                  className="bg-status-success hover:bg-status-success/90 text-white"
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

          {/* Save */}
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

          {/* Regenerate */}
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
            <TooltipContent>Re-draft with different instructions</TooltipContent>
          </Tooltip>

          {/* Author Manually */}
          {!hasDraft && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  onClick={() => onAction('author_manually')}
                  disabled={isLoading}
                  size="sm"
                  type="button"
                >
                  <PenLine className="size-4" />
                  Author Manually
                </Button>
              </TooltipTrigger>
              <TooltipContent>Write this response from scratch</TooltipContent>
            </Tooltip>
          )}

          {/* Flag for Review */}
          {hasDraft && !isApproved && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={() => onAction('flag_for_review')}
                  disabled={isLoading}
                  size="sm"
                  type="button"
                >
                  {loadingAction === 'flag_for_review' ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Flag className="size-4" />
                  )}
                  Flag
                </Button>
              </TooltipTrigger>
              <TooltipContent>Flag for another reviewer</TooltipContent>
            </Tooltip>
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
