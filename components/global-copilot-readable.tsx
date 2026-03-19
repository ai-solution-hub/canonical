'use client';

import { useCopilotReadable } from '@copilotkit/react-core';
import { useCopilotPageContext } from '@/contexts/copilot-page-context';
import { useUserRole } from '@/hooks/use-user-role';
import { usePathname } from 'next/navigation';
import { useHydrated } from '@/hooks/use-hydrated';
import { isPublicRoute } from '@/lib/routes';

/**
 * Inner component that registers CopilotKit readables.
 * Only rendered after hydration when CopilotKit context is available.
 */
function CopilotReadableInner() {
  const { page, pageMetadata } = useCopilotPageContext();
  const { role, canEdit, canAdmin } = useUserRole();

  useCopilotReadable({
    description: 'Current user role and permissions',
    value: { role, canEdit, canAdmin },
  });

  useCopilotReadable({
    description: 'Current page context',
    value: { page, ...pageMetadata },
  });

  useCopilotReadable({
    description: 'Application identity',
    value: {
      name: 'Knowledge Hub',
      description: 'Knowledge base platform for bid management',
    },
  });

  return null;
}

/**
 * Always-available CopilotKit readable context.
 * Mounted at the root layout level, providing global context to all pages.
 * Deferred until after hydration so the CopilotKit provider is mounted.
 */
export function GlobalCopilotReadable() {
  const hydrated = useHydrated();
  const pathname = usePathname();

  // Skip when CopilotKit context is not available
  if (process.env.NEXT_PUBLIC_E2E === 'true') return null;
  if (isPublicRoute(pathname)) return null;
  if (!hydrated) return null;

  return <CopilotReadableInner />;
}
