'use client';

import { useState } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { BRANDING } from '@/lib/client-config';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClaudePromptButtonProps {
  /** The prompt text to copy to clipboard */
  prompt: string;
  /** Button label text */
  label?: string;
  /** Size variant */
  size?: 'sm' | 'default';
  /** Optional className override */
  className?: string;
  /** Whether to also open claude.ai in a new tab */
  openClaude?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CLAUDE_NEW_CHAT_URL = 'https://claude.ai/new';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Reusable button that copies a contextual Claude prompt to clipboard
 * and optionally opens claude.ai in a new tab.
 *
 * Follows the established CopyButton pattern from integrations-section.tsx.
 */
export function ClaudePromptButton({
  prompt,
  label = 'Take action',
  size = 'sm',
  className,
  openClaude = true,
}: ClaudePromptButtonProps) {
  const [copied, setCopied] = useState(false);

  async function handleClick(e: React.MouseEvent) {
    // Prevent parent link navigation (e.g. when inside an AttentionCard)
    e.preventDefault();
    e.stopPropagation();

    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      toast.success('Prompt copied — paste into Claude');

      if (openClaude) {
        window.open(CLAUDE_NEW_CHAT_URL, '_blank', 'noopener,noreferrer');
      }

      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy prompt');
    }
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size={size}
            onClick={handleClick}
            aria-label={`Copy prompt: ${label}`}
            className={cn(
              'gap-1.5 text-muted-foreground hover:text-foreground',
              className,
            )}
          >
            {copied ? (
              <Check
                className="size-3.5 text-quality-good"
                aria-hidden="true"
              />
            ) : (
              <Copy className="size-3.5" aria-hidden="true" />
            )}
            <span className="text-xs" aria-live="polite">
              {copied ? 'Copied' : label}
            </span>
            {!copied && openClaude && (
              <ExternalLink className="size-3" aria-hidden="true" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs">
          <p className="text-xs">
            Copies a prompt to your clipboard and opens Claude. Works best with
            the {BRANDING.productName} connector.
          </p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
