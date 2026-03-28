'use client';

import { useState } from 'react';
import { ShieldCheck, Flag, Loader2 } from 'lucide-react';
import { useQuickReview, type OnOptimisticUpdate } from '@/hooks/review/use-quick-review';
import { useUserRole } from '@/hooks/use-user-role';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuickReviewActionsProps {
  itemId: string;
  itemTitle: string;
  /** Current verification state — determines verify vs unverify button */
  verifiedAt: string | null | undefined;
  /** Whether the item currently has a quality flag */
  hasQualityFlag?: boolean;
  /** Callback for optimistic state updates (passed through to useQuickReview) */
  onOptimisticUpdate?: OnOptimisticUpdate;
  /** When provided, skip internal useUserRole call */
  canEdit?: boolean;
  /** Additional className for the wrapper */
  className?: string;
}

// ---------------------------------------------------------------------------
// Shared button class
// ---------------------------------------------------------------------------

const actionButtonClass =
  'inline-flex items-center justify-center rounded-md p-1 transition-all duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-90 min-h-[44px] min-w-[44px]';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function QuickReviewActions({
  itemId,
  itemTitle,
  verifiedAt,
  hasQualityFlag,
  onOptimisticUpdate,
  canEdit: canEditProp,
  className,
}: QuickReviewActionsProps) {
  // Resolve edit permission: use prop if provided, else fall back to hook
  const { canEdit: canEditFromHook } = useUserRole();
  const canEdit = canEditProp !== undefined ? canEditProp : canEditFromHook;

  const { quickVerify, quickUnverify, quickFlag, quickUnflag, isPending, pendingItems } =
    useQuickReview({ onOptimisticUpdate });

  const [flagPopoverOpen, setFlagPopoverOpen] = useState(false);
  const [flagReason, setFlagReason] = useState('');

  // Role-gated: render nothing for viewers
  if (!canEdit) return null;

  const isVerified = Boolean(verifiedAt);
  const isFlagged = Boolean(hasQualityFlag);
  const pendingAction = pendingItems.get(itemId);
  const verifyPending = pendingAction === 'verify' || pendingAction === 'unverify';
  const flagPending = pendingAction === 'flag' || pendingAction === 'unflag';
  const anyPending = Boolean(pendingAction);

  const handleVerifyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPending(itemId)) return;

    if (isVerified) {
      quickUnverify(itemId, itemTitle);
    } else {
      quickVerify(itemId, itemTitle);
    }
  };

  const handleFlagClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPending(itemId)) return;

    if (isFlagged) {
      // Direct unflag — no popover
      quickUnflag(itemId, itemTitle);
    }
    // If not flagged, the popover opens via PopoverTrigger
  };

  const handleFlagSubmit = (e?: React.MouseEvent | React.FormEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const reason = flagReason.trim();
    quickFlag(itemId, itemTitle, reason || undefined);
    setFlagPopoverOpen(false);
    setFlagReason('');
  };

  const handleFlagKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      handleFlagSubmit();
    }
  };

  const handleCancelFlag = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setFlagPopoverOpen(false);
    setFlagReason('');
  };

  return (
    <div className={cn('inline-flex items-center gap-1', className)}>
      {/* Verify / Unverify button */}
      <button
        type="button"
        aria-label={isVerified ? 'Unverify' : 'Verify'}
        disabled={anyPending}
        className={actionButtonClass}
        onClick={handleVerifyClick}
      >
        {verifyPending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
        ) : (
          <ShieldCheck
            className={cn(
              'size-4 transition-colors',
              isVerified
                ? 'text-status-success'
                : 'text-muted-foreground hover:text-status-success',
            )}
            aria-hidden="true"
          />
        )}
      </button>

      {/* Flag / Unflag button */}
      {isFlagged ? (
        // Already flagged: direct unflag button (no popover)
        <button
          type="button"
          aria-label="Resolve flag"
          disabled={anyPending}
          className={actionButtonClass}
          onClick={handleFlagClick}
        >
          {flagPending ? (
            <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
          ) : (
            <Flag
              className="size-4 text-quality-severity-warning transition-colors"
              aria-hidden="true"
            />
          )}
        </button>
      ) : (
        // Not flagged: popover trigger for flag reason
        <Popover open={flagPopoverOpen} onOpenChange={setFlagPopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Flag for review"
              disabled={anyPending}
              className={actionButtonClass}
              onClick={(e) => {
                // Stop propagation to prevent Link navigation.
                // Do NOT call preventDefault — Radix PopoverTrigger needs the event.
                e.stopPropagation();
              }}
            >
              {flagPending ? (
                <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <Flag
                  className="size-4 text-muted-foreground transition-colors hover:text-quality-severity-warning"
                  aria-hidden="true"
                />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            side="bottom"
            align="end"
            className="w-72 p-3"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="flex flex-col gap-2">
              <label htmlFor={`flag-reason-${itemId}`} className="text-sm font-medium text-foreground">
                Reason (optional):
              </label>
              <Input
                id={`flag-reason-${itemId}`}
                placeholder="Why does this need attention?"
                maxLength={500}
                className="h-8 text-sm"
                value={flagReason}
                onChange={(e) => setFlagReason(e.target.value)}
                onKeyDown={handleFlagKeyDown}
                onClick={(e) => e.stopPropagation()}
              />
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8"
                  onClick={handleCancelFlag}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  className="h-8"
                  onClick={handleFlagSubmit}
                >
                  Submit
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
