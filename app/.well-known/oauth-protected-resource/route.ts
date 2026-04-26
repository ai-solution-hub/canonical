/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Tells MCP clients where to authenticate. Points to Supabase Auth
 * as the authorization server for this protected resource.
 */
import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from 'mcp-handler';
import { clientEnv } from '@/lib/env-client';

const handler = protectedResourceHandler({
  authServerUrls: [`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
  resourceUrl: clientEnv.NEXT_PUBLIC_APP_URL,
});

const corsHandler = metadataCorsOptionsRequestHandler();

export const maxDuration = 10;

export { handler as GET, corsHandler as OPTIONS };
