/**
 * Boot-time validation of server-only env vars (secrets + config) via Zod.
 *
 * The client-side schema (`NEXT_PUBLIC_*`) lives in `lib/env-client.ts` so
 * server-only field names cannot leak into the client bundle even if a
 * consumer mistakenly imports from this file. `clientEnv` and `ClientEnv`
 * are re-exported here for backwards compatibility — but new code SHOULD
 * import them from `@/lib/env-client` directly.
 *
 * **Fail-fast contract.** Both schemas are parsed at module load. Missing or
 * malformed required vars throw immediately with a message identifying the
 * offending field(s). The first import in the dependency graph (typically a
 * Next.js `app/layout.tsx` or a server-side entry point through
 * `lib/client-config.ts`) triggers validation; the build then fails loudly
 * rather than producing a silently-broken deployment.
 *
 * **Test-environment note.** Because parsing happens at module load, calling
 * `vi.stubEnv()` *after* import has no retroactive effect on the cached
 * `serverEnv` export. Tests that need to exercise the parsing logic itself
 * should:
 *   1. Call `vi.stubEnv()` for required vars **before** dynamic-importing
 *      this module: `await import('@/lib/env')`.
 *   2. Use `vi.resetModules()` between scenarios so each `await import()` re-
 *      evaluates the schema against the freshly-stubbed `process.env`.
 *
 * Direct consumers (e.g. `lib/client-config.ts`) should always go through the
 * exported `serverEnv` rather than touching `process.env.X` directly, so the
 * type system enforces the boundary.
 *
 * **No barrel re-exports.** Per CLAUDE.md, always import directly from
 * `@/lib/env` — there is no `lib/index.ts` re-exporting these.
 */

import { z } from 'zod';
import { formatZodErrors } from './env-client';

// Re-export client env for backwards compatibility. New code should import
// from `@/lib/env-client` directly to avoid pulling the server-side parser
// into client bundles.
export { clientEnv, type ClientEnv } from './env-client';

// ---------------------------------------------------------------------------
// Server-only env schema — secrets and config that MUST NOT reach the client.
// ---------------------------------------------------------------------------

const serverSchema = z.object({
  // -- Supabase (server-side variants used by Node scripts; the NEXT_PUBLIC_*
  //    URL is the canonical one for runtime, but scripts may set the bare
  //    name directly. Both kept optional with at least one required at
  //    consumer call sites.)
  SUPABASE_URL: z
    .string()
    .url('SUPABASE_URL must be a valid URL')
    .optional()
    .or(z.literal('')),
  /**
   * Legacy / scripts-only anon key. Coexists with `SUPABASE_PUBLISHABLE_KEY`
   * — both are optional here so scripts may set whichever the deployment
   * provides. The browser-facing publishable key lives in `clientEnv` as
   * `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
   */
  SUPABASE_ANON_KEY: z.string().min(1).optional().or(z.literal('')),
  /** Server-side publishable variant. Optional. */
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional().or(z.literal('')),
  SUPABASE_SERVICE_ROLE_KEY: z
    .string()
    .min(1, 'SUPABASE_SERVICE_ROLE_KEY is required (service-role key)'),
  POSTGRES_PASSWORD: z
    .string()
    .min(1, 'POSTGRES_PASSWORD is required for CLI migrations'),

  // -- AI providers
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // -- Intelligence pipeline
  FIRECRAWL_API_KEY: z.string().optional().or(z.literal('')),
  CRON_SECRET: z
    .string()
    .min(1, 'CRON_SECRET is required for Vercel Cron auth'),

  // -- Classification batch sizing (coerced from string env value)
  CLASSIFICATION_BATCH_SIZE: z.coerce.number().int().positive().default(25),

  // -- Taxonomy sync
  GITHUB_SYNC_TOKEN: z.string().min(1).optional().or(z.literal('')),
  TAXONOMY_SYNC_CALLBACK_SECRET: z.string().min(1).optional().or(z.literal('')),

  // -- Sentry server-side (release tagging, source-map upload).
  //    Vercel→Sentry integration emits these UN-prefixed by default;
  //    keeping the bare names avoids a translation layer in CI.
  SENTRY_AUTH_TOKEN: z.string().min(1).optional().or(z.literal('')),
  SENTRY_ORG: z.string().min(1).optional().or(z.literal('')),
  SENTRY_PROJECT: z.string().min(1).optional().or(z.literal('')),

  // -- AI model overrides (optional; defaults applied at consumer)
  AI_SUMMARY_MODEL: z.string().min(1).optional().or(z.literal('')),
  AI_CLASSIFICATION_MODEL: z.string().min(1).optional().or(z.literal('')),
  AI_EMBEDDING_MODEL: z.string().min(1).optional().or(z.literal('')),
  AI_EMBEDDING_DIMS: z.coerce.number().int().positive().optional(),

  // -- Test users (server-only; documented in `.env.example`)
  TEST_USER_1_EMAIL: z
    .string()
    .email('TEST_USER_1_EMAIL must be a valid email')
    .optional()
    .or(z.literal('')),
  TEST_USER_1_PASSWORD: z.string().min(1).optional().or(z.literal('')),
  TEST_USER_2_EMAIL: z
    .string()
    .email('TEST_USER_2_EMAIL must be a valid email')
    .optional()
    .or(z.literal('')),
  TEST_USER_2_PASSWORD: z.string().min(1).optional().or(z.literal('')),
  TEST_USER_3_EMAIL: z
    .string()
    .email('TEST_USER_3_EMAIL must be a valid email')
    .optional()
    .or(z.literal('')),
  TEST_USER_3_PASSWORD: z.string().min(1).optional().or(z.literal('')),
});

export type ServerEnv = z.infer<typeof serverSchema>;

// ---------------------------------------------------------------------------
// Parse helper — single source of truth for the failure-message format.
// ---------------------------------------------------------------------------

function parseServerEnv(): ServerEnv {
  const result = serverSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid server env — fix the following:\n${formatZodErrors(result.error)}`,
    );
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// Public export — parses at module load (fail-fast).
// ---------------------------------------------------------------------------

/**
 * Validated server-only env vars (secrets + config).
 *
 * Gated behind `typeof window === 'undefined'`: any client-bundle import
 * resolves to `null as never`, so attempting to read `serverEnv.X` from
 * browser code triggers a runtime crash rather than silently leaking — the
 * type system reflects the same contract via `ServerEnv`.
 */
export const serverEnv: ServerEnv =
  typeof window === 'undefined' ? parseServerEnv() : (null as never);
