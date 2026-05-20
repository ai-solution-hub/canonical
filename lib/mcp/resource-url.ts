/**
 * Resolves the canonical public URL of the current deployment for
 * OAuth 2.0 Protected Resource Metadata (RFC 9728).
 *
 * The MCP auth flow requires that the 401 WWW-Authenticate challenge
 * advertises the SAME origin as the resource the client is trying to
 * access. If a deployment advertises a different origin (e.g. a stale
 * NEXT_PUBLIC_APP_URL pointing at the canonical prod URL while the
 * server actually runs at a preview-deploy alias), Claude Code's MCP
 * client rejects the challenge with
 * `Protected resource <advertised> does not match expected <actual>`.
 *
 * Preference order:
 *   1. `request.headers['x-forwarded-host']` / `host` — always matches
 *      what the client actually connected to. Preferred when a Request
 *      is available.
 *   2. `NEXT_PUBLIC_APP_URL` — explicit override for local/staging
 *      setups where the forwarded host is unreliable.
 *   3. `VERCEL_PROJECT_PRODUCTION_URL` — auto-set per-project by
 *      Vercel, so each project self-identifies without any env
 *      configuration.
 *   4. `VERCEL_URL` — per-deployment URL (preview deploys).
 *   5. `http://localhost:3000` — dev fallback.
 */
export function resolveResourceUrl(request?: Request): string {
  if (request) {
    const host =
      request.headers.get('x-forwarded-host') ?? request.headers.get('host');
    if (host) {
      const proto =
        request.headers.get('x-forwarded-proto') ??
        (host.startsWith('localhost') || host.startsWith('127.')
          ? 'http'
          : 'https');
      return `${proto}://${host}`;
    }
  }

  if (process.env.NEXT_PUBLIC_APP_URL) {
    return process.env.NEXT_PUBLIC_APP_URL;
  }

  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return 'http://localhost:3000';
}
