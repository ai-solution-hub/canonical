/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * Tells MCP clients where to authenticate. Points to Supabase Auth
 * as the authorization server for this protected resource.
 *
 * `resourceUrl` is intentionally omitted — `protectedResourceHandler`
 * auto-derives it from `X-Forwarded-Host` / `X-Forwarded-Proto` (standard
 * on Vercel). This lets each deployment (prod, preview, alias) self-
 * identify without depending on `NEXT_PUBLIC_APP_URL` being kept in
 * sync with the actual host the client connected to — the OAuth client's
 * origin check would otherwise reject when the configured URL drifts
 * from the deploy URL.
 */
import {
  protectedResourceHandler,
  metadataCorsOptionsRequestHandler,
} from 'mcp-handler';
import { clientEnv } from '@/lib/env-client';

const handler = protectedResourceHandler({
  authServerUrls: [`${clientEnv.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
});

const corsHandler = metadataCorsOptionsRequestHandler();

export const maxDuration = 10;

export { handler as GET, corsHandler as OPTIONS };
