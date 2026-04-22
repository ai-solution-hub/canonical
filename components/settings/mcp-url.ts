/**
 * Shared MCP URL derivation used by ConnectionsSection.
 */
export function getMcpUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL
    ? `${process.env.NEXT_PUBLIC_APP_URL}/api/mcp/mcp`
    : typeof window !== 'undefined'
      ? `${window.location.origin}/api/mcp/mcp`
      : '/api/mcp/mcp';
}
