'use client';

import { MessageSquare, X } from 'lucide-react';
import { useCopilotSidebar } from '@/hooks/use-copilot-sidebar';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Floating AI assistant toggle button, fixed to the bottom-right of the
 * viewport. Replaces the CopilotKit built-in button, which was appearing in
 * the wrong position due to the .copilotKitWindow top-offset CSS override.
 *
 * Must be rendered inside GlobalCopilotSidebar so it has access to the
 * SidebarContext provided by SidebarContextBridge.
 */
export function FloatingCopilotButton() {
  const hydrated = useHydrated();
  const { isOpen, toggle } = useCopilotSidebar();

  // Don't render until hydrated — useCopilotSidebar depends on CopilotKit
  // context which is guarded by useHydrated in GlobalCopilotSidebar.
  if (!hydrated) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? 'Close AI assistant' : 'Open AI assistant'}
      title="AI Assistant"
      className="fixed bottom-20 right-5 z-50 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-all hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:bottom-5"
    >
      {isOpen ? (
        <X className="size-5" aria-hidden="true" />
      ) : (
        <MessageSquare className="size-5" aria-hidden="true" />
      )}
    </button>
  );
}
