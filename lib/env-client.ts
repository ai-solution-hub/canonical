/**
 * Boot-time validation of `NEXT_PUBLIC_*` env vars (browser-safe).
 *
 * Split from `lib/env.ts` so server-only `process.env` reads (and the Zod
 * schema referencing them) never get pulled into client bundles. Importing
 * just `lib/env-client.ts` from a client component cannot drag in any
 * `serverSchema` field name — the build verifier scans
 * `.next/static/chunks/*.js` for leaked server var names.
 *
 * **Fail-fast contract.** The schema is parsed at module load. Missing or
 * malformed required vars throw immediately with a message identifying the
 * offending field(s). The first import in the dependency graph triggers
 * validation; the build then fails loudly rather than producing a silently-
 * broken deployment.
 *
 * **Test-environment note.** Because parsing happens at module load, calling
 * `vi.stubEnv()` *after* import has no retroactive effect on the cached
 * `clientEnv` export. Tests that need to exercise the parsing logic itself
 * should:
 *   1. Call `vi.stubEnv()` for required vars **before** dynamic-importing
 *      this module: `await import('@/lib/env-client')`.
 *   2. Use `vi.resetModules()` between scenarios so each `await import()` re-
 *      evaluates the schema against the freshly-stubbed `process.env`.
 *
 * Direct consumers should always go through the exported `clientEnv` rather
 * than touching `process.env.X` directly, so the type system enforces the
 * boundary.
 *
 * **No barrel re-exports.** Per CLAUDE.md, always import directly from
 * `@/lib/env-client` (or `@/lib/env`, which re-exports `clientEnv` for
 * backwards compatibility).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Client-exposed env schema (NEXT_PUBLIC_*) — readable from browser bundles.
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required'),
  NEXT_PUBLIC_APP_URL: z
    .string()
    .url('NEXT_PUBLIC_APP_URL must be a valid URL'),
  /**
   * Identifies the client tenant; drives BRANDING.organisationName and
   * downstream certification-holder derivation.
   *
   * REQUIRED — missing this var caused the S196 incident: BRANDING fell
   * back to "Knowledge Hub", which corrupted entity_mention metadata
   * (35 production rows lost before rollback). See
   * `feedback_branding_client_id_env.md` in user memory.
   */
  NEXT_PUBLIC_CLIENT_ID: z
    .string()
    .min(
      1,
      'NEXT_PUBLIC_CLIENT_ID is REQUIRED — missing causes BRANDING fallback corruption (S196 incident)',
    ),
  /** Public Sentry DSN — optional in dev, required in production deploys. */
  NEXT_PUBLIC_SENTRY_DSN: z
    .string()
    .url('NEXT_PUBLIC_SENTRY_DSN must be a valid URL')
    .optional()
    .or(z.literal('')),
  /** E2E flag — disables CopilotKit during Playwright runs. */
  NEXT_PUBLIC_E2E: z.enum(['true', 'false']).optional().or(z.literal('')),
});

export type ClientEnv = z.infer<typeof clientSchema>;

// ---------------------------------------------------------------------------
// Parse helper — single source of truth for the failure-message format.
// ---------------------------------------------------------------------------

export function formatZodErrors(error: z.ZodError): string {
  const fieldErrors = error.flatten().fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const lines: string[] = [];
  for (const [field, messages] of Object.entries(fieldErrors)) {
    if (!messages || messages.length === 0) continue;
    lines.push(`  - ${field}: ${messages.join('; ')}`);
  }
  return lines.join('\n');
}

function parseClientEnv(): ClientEnv {
  // Each `process.env.NEXT_PUBLIC_X` MUST be a literal accessor — Next.js
  // statically substitutes literal accesses with their build-time string at
  // compile time. Passing the whole `process.env` object to `safeParse` does
  // NOT trigger substitution (the compiler can't see which keys you'll read),
  // so at browser runtime `process.env` is the empty polyfill `{}` and Zod
  // throws with every field undefined. P0 production bug; fixed by enumerating
  // each field literal here.
  const result = clientSchema.safeParse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_CLIENT_ID: process.env.NEXT_PUBLIC_CLIENT_ID,
    NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
    NEXT_PUBLIC_E2E: process.env.NEXT_PUBLIC_E2E,
  });
  if (!result.success) {
    throw new Error(
      `Invalid client env (NEXT_PUBLIC_*) — fix the following:\n${formatZodErrors(result.error)}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Public export — parses at module load (fail-fast).
// ---------------------------------------------------------------------------

/**
 * Validated `NEXT_PUBLIC_*` env vars. Safe to read from any execution
 * context (server, client, edge). All values are typed and required ones
 * are guaranteed non-empty by Zod.
 */
export const clientEnv: ClientEnv = parseClientEnv();
