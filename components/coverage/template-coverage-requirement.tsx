'use client';

import { useState } from 'react';
import { CheckCircle, AlertCircle, XCircle, Minus, Copy, Check } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ClaudePromptButton } from '@/components/content/claude-prompt-button';
import { cn } from '@/lib/utils';
import type { CoverageStatus, RequirementType } from '@/lib/templates/template-coverage';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TemplateCoverageRequirementProps {
  requirementId: string;
  requirementText: string;
  description: string | null;
  requirementType: RequirementType;
  coverageStatus: CoverageStatus;
  bestSimilarityScore: number;
  contentLengthMet: boolean;
  matchingContentIds: string[];
}

// ---------------------------------------------------------------------------
// Status config — icon + colour (WCAG: never colour alone)
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  CoverageStatus,
  { icon: typeof CheckCircle; label: string; dotClass: string; textClass: string }
> = {
  strong: {
    icon: CheckCircle,
    label: 'Strong',
    dotClass: 'bg-confidence-strong',
    textClass: 'text-confidence-strong',
  },
  partial: {
    icon: AlertCircle,
    label: 'Partial',
    dotClass: 'bg-confidence-partial',
    textClass: 'text-confidence-partial',
  },
  gap: {
    icon: XCircle,
    label: 'Gap',
    dotClass: 'bg-confidence-none',
    textClass: 'text-confidence-none',
  },
  na: {
    icon: Minus,
    label: 'N/A',
    dotClass: 'bg-muted-foreground/50',
    textClass: 'text-muted-foreground',
  },
};

// ---------------------------------------------------------------------------
// Type badge labels
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<RequirementType, string> = {
  policy: 'Policy',
  statement: 'Statement',
  evidence: 'Evidence',
  data: 'Data',
  narrative: 'Narrative',
  declaration: 'Declaration',
  reference: 'Reference',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TemplateCoverageRequirement({
  requirementText,
  description,
  requirementType,
  coverageStatus,
  contentLengthMet,
  matchingContentIds,
}: TemplateCoverageRequirementProps) {
  const [copied, setCopied] = useState(false);
  const config = STATUS_CONFIG[coverageStatus];
  const Icon = config.icon;

  const handleCopyGap = async () => {
    const text = [
      `Requirement: ${requirementText}`,
      description ? `Description: ${description}` : null,
      `Type: ${TYPE_LABELS[requirementType]}`,
    ]
      .filter(Boolean)
      .join('\n');

    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-md border px-3 py-2.5',
        coverageStatus === 'gap' && 'border-confidence-none-border bg-confidence-none-bg/50',
      )}
    >
      {/* Status indicator */}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className={cn('mt-0.5 flex shrink-0 items-center gap-1', config.textClass)}>
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="left">
          <p className="text-xs">
            {config.label}
            {coverageStatus !== 'na' && !contentLengthMet && coverageStatus !== 'gap' && (
              <> — content below length threshold</>
            )}
          </p>
        </TooltipContent>
      </Tooltip>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{requirementText}</p>
        {description && (
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        )}

        {/* Meta row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {TYPE_LABELS[requirementType]}
          </Badge>
          <span className={cn('text-[10px] font-medium', config.textClass)}>
            {config.label}
          </span>
          {matchingContentIds.length > 0 && coverageStatus !== 'na' && (
            <span className="text-[10px] text-muted-foreground">
              {matchingContentIds.length} matching {matchingContentIds.length === 1 ? 'item' : 'items'}
            </span>
          )}
        </div>
      </div>

      {/* Gap CTAs */}
      {coverageStatus === 'gap' && (
        <div className="flex shrink-0 items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyGap}
                className="shrink-0 gap-1.5 text-xs"
              >
                {copied ? (
                  <Check className="size-3" aria-hidden="true" />
                ) : (
                  <Copy className="size-3" aria-hidden="true" />
                )}
                {copied ? 'Copied' : 'Create content'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Copy requirement to clipboard for content creation</p>
            </TooltipContent>
          </Tooltip>
          <ClaudePromptButton
            prompt={`We need content to meet this requirement: "${requirementText}".${description ? ` Context: ${description}.` : ''} This is a ${TYPE_LABELS[requirementType].toLowerCase()} requirement. Search the KB for any related content, then help me draft material to fill this gap.`}
            label="Draft with Claude"
            size="sm"
          />
        </div>
      )}
    </div>
  );
}
