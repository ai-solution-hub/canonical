/**
 * Shared MCP URL derivation used by ConnectionsSection.
 *
 * Reads `NEXT_PUBLIC_APP_URL` from `clientEnv` (Zod-validated at boot in
 * `lib/env-client.ts`). Falls back to `window.location.origin` only when
 * running in a browser context where the env var is missing — which after
 * Zod validation should be unreachable; kept as defensive scaffolding.
 */
import { clientEnv } from '@/lib/env-client';

export function getMcpUrl(): string {
  return clientEnv.NEXT_PUBLIC_APP_URL
    ? `${clientEnv.NEXT_PUBLIC_APP_URL}/api/mcp/mcp`
    : typeof window !== 'undefined'
      ? `${window.location.origin}/api/mcp/mcp`
      : '/api/mcp/mcp';
}
