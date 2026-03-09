/**
 * MCP server authentication and Supabase client helpers.
 *
 * For MVP, the MCP server uses a service-role Supabase client that bypasses RLS.
 * OAuth 2.0 authentication can be layered on as a follow-up.
 */
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Creates a Supabase service client for MCP tool operations.
 * Uses the service role key to bypass RLS — suitable for admin-level queries.
 */
export function createMcpServiceClient() {
  return createServiceClient();
}
