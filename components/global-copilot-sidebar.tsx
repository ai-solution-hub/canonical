'use client';

import { createContext, useContext, useCallback, useMemo, type ReactNode } from 'react';
import { CopilotSidebar, useChatContext } from '@copilotkit/react-ui';
import { useCopilotPageContext, type CopilotPage } from '@/contexts/copilot-page-context';
import { buildSystemPrompt } from '@/lib/copilotkit/system-prompt';
import { useHydrated } from '@/hooks/use-hydrated';

// ---------------------------------------------------------------------------
// Sidebar open state context (shared with header toggle)
// ---------------------------------------------------------------------------

interface SidebarContextValue {
  isOpen: boolean;
  toggle: () => void;
}

const SidebarContext = createContext<SidebarContextValue>({
  isOpen: false,
  toggle: () => {},
});

export function useCopilotSidebar() {
  return useContext(SidebarContext);
}

// ---------------------------------------------------------------------------
// Bridge: reads CopilotKit's internal open state and exposes it via context
// ---------------------------------------------------------------------------

function SidebarContextBridge({ children }: { children: ReactNode }) {
  const { open, setOpen } = useChatContext();

  const toggle = useCallback(() => {
    setOpen(!open);
  }, [open, setOpen]);

  const value = useMemo(() => ({ isOpen: open, toggle }), [open, toggle]);

  return (
    <SidebarContext.Provider value={value}>
      {children}
    </SidebarContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Per-page sidebar labels
// ---------------------------------------------------------------------------

interface SidebarLabels {
  title: string;
  initial: string;
  placeholder: string;
}

function getSidebarLabels(page: CopilotPage): SidebarLabels {
  switch (page) {
    case 'homepage':
      return {
        title: 'Knowledge Hub',
        initial: 'What would you like to know? I can search the knowledge base or help you find what you need.',
        placeholder: 'Ask about your KB, bids, or recent activity...',
      };
    case 'browse':
      return {
        title: 'Content Browser',
        initial: 'I can help you find, classify, or understand content. What are you looking for?',
        placeholder: 'Search content, explain items, suggest tags...',
      };
    case 'library':
      return {
        title: 'Q&A Library',
        initial: 'I can help you find Q&A pairs, check coverage, or suggest improvements.',
        placeholder: 'Search Q&A pairs, explain coverage...',
      };
    case 'item-detail':
      return {
        title: 'Content Assistant',
        initial: 'I can help you understand this item, find related content, or search the knowledge base.',
        placeholder: 'Ask about this item or find related content...',
      };
    case 'bid-session':
      return {
        title: 'Bid Assistant',
        initial: 'I can help you search the knowledge base, draft responses, or improve existing content. What would you like to work on?',
        placeholder: 'Ask about this bid, search the KB, or request help with a response...',
      };
    case 'review':
      return {
        title: 'Review Assistant',
        initial: 'I can help you work through the review queue faster. Want me to explain the flags on this item?',
        placeholder: 'Ask about quality flags, get verify recommendations...',
      };
    case 'coverage':
      return {
        title: 'Coverage Analyst',
        initial: 'I can identify gaps, suggest content to create, or explain coverage metrics.',
        placeholder: 'Ask about coverage gaps or compare domains...',
      };
    default:
      return {
        title: 'Knowledge Hub',
        initial: 'I can search the knowledge base or answer questions about your content.',
        placeholder: 'Search the KB or ask a question...',
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function GlobalCopilotSidebar({ children }: { children: ReactNode }) {
  const hydrated = useHydrated();
  const { page, pageMetadata } = useCopilotPageContext();

  const labels = getSidebarLabels(page);
  const systemPrompt = buildSystemPrompt(page, pageMetadata);

  // Before hydration, render children directly — CopilotKit context
  // is not available yet (see CopilotKitProvider hydration guard).
  if (!hydrated) {
    return <>{children}</>;
  }

  return (
    <CopilotSidebar
      defaultOpen={false}
      clickOutsideToClose={true}
      makeSystemMessage={systemPrompt}
      labels={{
        title: labels.title,
        initial: labels.initial,
        placeholder: labels.placeholder,
        stopGenerating: 'Stop',
        regenerateResponse: 'Try again',
      }}
      className="global-copilot-sidebar"
    >
      <SidebarContextBridge>
        {children}
      </SidebarContextBridge>
    </CopilotSidebar>
  );
}
