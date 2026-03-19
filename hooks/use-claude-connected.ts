'use client';

import { useState, useEffect } from 'react';

/**
 * Checks whether the user has an active OAuth grant connecting
 * Knowledge Hub to Claude (Claude.ai, Claude Desktop, or CoWork).
 *
 * Returns `null` while loading, `true` if connected, `false` otherwise.
 */
export function useClaudeConnected(): boolean | null {
  const [connected, setConnected] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/oauth/grants')
      .then((res) => (res.ok ? res.json() : { grants: [] }))
      .then((data) => {
        const grants = data.grants ?? [];
        const hasClaudeGrant = grants.some(
          (g: { client?: { name?: string } }) =>
            g.client?.name?.toLowerCase().includes('claude') ||
            g.client?.name?.toLowerCase().includes('knowledge hub'),
        );
        setConnected(hasClaudeGrant);
      })
      .catch(() => setConnected(false));
  }, []);

  return connected;
}
