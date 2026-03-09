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

const RESOURCE_URL = 'https://knowledge-hub-seven-kappa.vercel.app';

const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
  resourceUrl: RESOURCE_URL,
});

const corsHandler = metadataCorsOptionsRequestHandler();

export { handler as GET, corsHandler as OPTIONS };
