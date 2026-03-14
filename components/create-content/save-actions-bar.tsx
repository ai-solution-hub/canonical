'use client';

import Link from 'next/link';
import {
  Loader2,
  Save,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';

export interface SaveActionsBarProps {
  autoClassify: boolean;
  setAutoClassify: (value: boolean) => void;
  autoSummarise: boolean;
  setAutoSummarise: (value: boolean) => void;
  saveAsDraft: boolean;
  setSaveAsDraft: (value: boolean) => void;
  canSave: boolean | string;
  isSaving: boolean;
  isSavingAndContinue: boolean;
  onSaveAndContinue: () => void;
}

/**
 * Bottom bar with AI options (classify, summarise, draft) and save buttons.
 */
export function SaveActionsBar({
  autoClassify,
  setAutoClassify,
  autoSummarise,
  setAutoSummarise,
  saveAsDraft,
  setSaveAsDraft,
  canSave,
  isSaving,
  isSavingAndContinue,
  onSaveAndContinue,
}: SaveActionsBarProps) {
  const saving = isSaving || isSavingAndContinue;

  return (
    <div className="space-y-6 border-t border-border pt-6">
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2">
            <Checkbox
              id="auto-classify"
              checked={autoClassify}
              onCheckedChange={(checked) =>
                setAutoClassify(checked === true)
              }
            />
            <Label htmlFor="auto-classify" className="text-sm font-normal">
              Classify automatically
            </Label>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="auto-summarise"
              checked={autoSummarise}
              onCheckedChange={(checked) =>
                setAutoSummarise(checked === true)
              }
            />
            <Label htmlFor="auto-summarise" className="text-sm font-normal">
              Generate summary
            </Label>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox
            id="save-as-draft"
            checked={saveAsDraft}
            onCheckedChange={(checked) =>
              setSaveAsDraft(checked === true)
            }
          />
          <Label htmlFor="save-as-draft" className="text-sm font-normal">
            Save as draft (hidden from search and matching)
          </Label>
        </div>
      </div>

      {/* Actions — visually separated from options */}
      <div className="flex items-center justify-end gap-3 border-t border-border pt-4">
        <Button
          type="button"
          variant="ghost"
          asChild
        >
          <Link href="/browse">Cancel</Link>
        </Button>
        <div className="inline-flex items-stretch">
          <Button
            type="submit"
            size="lg"
            disabled={!canSave || saving}
            className="rounded-r-none"
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 size-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 size-4" />
                Save
              </>
            )}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="lg"
                disabled={!canSave || saving}
                className="rounded-l-none border-l border-primary-foreground/20 px-2"
                aria-label="More save options"
              >
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={onSaveAndContinue}
                disabled={!canSave || saving}
              >
                {isSavingAndContinue ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
                Save and Continue Editing
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </div>
  );
}
