'use client';

import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Concept vocabulary
// ---------------------------------------------------------------------------

/**
 * Keys for the 8 platform concepts surfaced in ConceptHelp tooltips.
 * Kept as a union so the component only accepts known concepts and each
 * concept gets reviewed copy.
 */
export type ConceptKey =
  | 'coverage'
  | 'priority-gaps'
  | 'governance-review'
  | 'workspace'
  | 'layer'
  | 'domain'
  | 'stream'
  | 'freshness';

interface ConceptCopy {
  /** Human label used in the accessible name of the trigger. */
  label: string;
  /** One-to-two-sentence explanation shown in the tooltip body. */
  body: string;
}

/**
 * Copy map for ConceptHelp. UK English, plain language — tuned for
 * onboarding personas (Rachel/Tom) rather than power users.
 *
 * Note: "layer" in this product means **content depth** (Summary, Standard,
 * Technical Detail), not content type — see
 * docs/product-functionality/knowledge-organisation/user-journeys.md.
 */
const CONCEPT_COPY: Record<ConceptKey, ConceptCopy> = {
  coverage: {
    label: 'coverage',
    body: 'How well each part of your knowledge base is populated against its template.',
  },
  'priority-gaps': {
    label: 'priority gaps',
    body: 'Missing content flagged as important by your template structure.',
  },
  'governance-review': {
    label: 'governance review',
    body: 'Periodic checks that content stays current and owned.',
  },
  workspace: {
    label: 'workspace',
    body: 'A collection of sources and content scoped to one sector or client.',
  },
  layer: {
    label: 'layer',
    body: 'A depth level for content (e.g. Summary, Standard, Technical Detail) — the same knowledge at different levels of detail.',
  },
  domain: {
    label: 'domain',
    body: 'A top-level subject area in your taxonomy (e.g. Quality, Safety, HR).',
  },
  stream: {
    label: 'stream',
    body: 'A continuous feed of external information (RSS, web, API).',
  },
  freshness: {
    label: 'freshness',
    body: 'How recently a piece of content was updated or verified.',
  },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export interface ConceptHelpProps {
  /** Which platform concept to explain. */
  concept: ConceptKey;
  /** Optional extra classes applied to the trigger button. */
  className?: string;
  /** Tooltip side — defaults to `'top'` to match existing patterns. */
  side?: React.ComponentProps<typeof TooltipContent>['side'];
}

/**
 * Launch-level onboarding helper. Renders a small `?` icon that, on hover
 * or keyboard focus, reveals a one-sentence explanation of a platform
 * concept. Always place beside the PRIMARY label for the concept.
 *
 * Relies on the global `<TooltipProvider>` mounted in `app/layout.tsx`.
 */
export function ConceptHelp({
  concept,
  className,
  side = 'top',
}: ConceptHelpProps) {
  const copy = CONCEPT_COPY[concept];

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={`What does ${copy.label} mean?`}
          className={cn(
            'inline-flex size-4 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
            className,
          )}
        >
          <HelpCircle className="size-4" aria-hidden="true" />
        </button>
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs">
        {copy.body}
      </TooltipContent>
    </Tooltip>
  );
}

// Exported for tests and potential documentation surfaces.
export { CONCEPT_COPY };
