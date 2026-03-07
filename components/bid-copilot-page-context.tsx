'use client';

import { useEffect } from 'react';
import { useCopilotPageContext } from '@/contexts/copilot-page-context';

/**
 * Sets the CopilotKit page context to 'bid-session' when mounted.
 * Resets to 'unknown' on unmount so the global sidebar reverts to defaults.
 */
export function BidCopilotPageContext() {
  const { setPage } = useCopilotPageContext();

  useEffect(() => {
    setPage('bid-session');
    return () => setPage('unknown');
  }, [setPage]);

  return null;
}
