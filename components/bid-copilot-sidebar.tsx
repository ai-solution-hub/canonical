'use client';

import { CopilotSidebar } from '@copilotkit/react-ui';
import { buildBidSystemPrompt } from '@/lib/copilotkit/system-prompt';
import { ReactNode } from 'react';

interface BidCopilotSidebarProps {
  /** Whether the sidebar starts open */
  defaultOpen?: boolean;
  /** Bid name for system prompt context */
  bidName?: string;
  /** Buyer name for system prompt context */
  buyerName?: string;
  /** Content to render alongside the sidebar (wrapper pattern) */
  children: ReactNode;
}

/**
 * CopilotSidebar wrapper for the bid workspace.
 *
 * Uses the documented wrapper pattern where CopilotSidebar wraps its children.
 * This ensures proper layout push/resize behaviour when the sidebar is
 * expanded or collapsed, rather than overlaying content.
 */
export function BidCopilotSidebar({
  defaultOpen = false,
  bidName,
  buyerName,
  children,
}: BidCopilotSidebarProps) {
  return (
    <CopilotSidebar
      defaultOpen={defaultOpen}
      clickOutsideToClose={true}
      makeSystemMessage={buildBidSystemPrompt(bidName, buyerName)}
      labels={{
        title: 'Bid Assistant',
        initial:
          'I can help you search the knowledge base, draft responses, or improve existing content. What would you like to work on?',
        placeholder:
          'Ask about this bid, search the KB, or request help with a response...',
        stopGenerating: 'Stop',
        regenerateResponse: 'Try again',
      }}
      className="bid-copilot-sidebar"
    >
      {children}
    </CopilotSidebar>
  );
}
