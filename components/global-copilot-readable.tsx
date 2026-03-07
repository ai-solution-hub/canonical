'use client';

import { useCopilotReadable } from '@copilotkit/react-core';
import { useCopilotPageContext } from '@/contexts/copilot-page-context';
import { useUserRole } from '@/hooks/use-user-role';

/**
 * Always-available CopilotKit readable context.
 * Mounted at the root layout level, providing global context to all pages.
 */
export function GlobalCopilotReadable() {
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
