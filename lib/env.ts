/**
 * Boot-time environment-variable validation via Zod.
 *
 * Two parsed objects are exported:
 *   - `clientEnv` — `NEXT_PUBLIC_*` vars only; safe to read from any context.
 *   - `serverEnv` — server-only secrets and config; gated behind a
 *     `typeof window === 'undefined'` check so no key can leak into the
 *     client bundle even if a consumer mistakenly imports it.
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
 * `clientEnv` / `serverEnv` exports. Tests that need to exercise the parsing
 * logic itself should:
 *   1. Call `vi.stubEnv()` for required vars **before** dynamic-importing
 *      this module: `await import('@/lib/env')`.
 *   2. Use `vi.resetModules()` between scenarios so each `await import()` re-
 *      evaluates the schema against the freshly-stubbed `process.env`.
 *
 * Direct consumers (e.g. `lib/client-config.ts`) should always go through the
 * exported `clientEnv` / `serverEnv` rather than touching `process.env.X`
 * directly, so the type system enforces the boundary.
 *
 * **No barrel re-exports.** Per CLAUDE.md, always import directly from
 * `@/lib/env` — there is no `lib/index.ts` re-exporting these.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Client-exposed env schema (NEXT_PUBLIC_*) — readable from browser bundles.
// ---------------------------------------------------------------------------

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z
    .string()
    .url('NEXT_PUBLIC_SUPABASE_URL must be a valid URL'),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z
    .string()
    .min(1, 'NEXT_PUBLIC_SUPABASE_ANON_KEY is required'),
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
  NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN: z
    .string()
    .url('NEXT_PUBLIC_OBSERVABILITY_SENTRY_DSN must be a valid URL')
    .optional()
    .or(z.literal('')),
  /** E2E flag — disables CopilotKit during Playwright runs. */
  NEXT_PUBLIC_E2E: z.enum(['true', 'false']).optional().or(z.literal('')),
});

export type ClientEnv = z.infer<typeof clientSchema>;

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
  SUPABASE_ANON_KEY: z.string().min(1).optional().or(z.literal('')),
  SUPABASE_SECRET_KEY: z
    .string()
    .min(1, 'SUPABASE_SECRET_KEY is required (service-role key)'),
  SUPABASE_DBPASSWORD: z
    .string()
    .min(1, 'SUPABASE_DBPASSWORD is required for CLI migrations'),

  // -- AI providers
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),
  OPENAI_API_KEY: z.string().min(1, 'OPENAI_API_KEY is required'),

  // -- Intelligence pipeline
  FIRECRAWL_API_KEY: z.string().optional().or(z.literal('')),
  CRON_SECRET: z
    .string()
    .min(1, 'CRON_SECRET is required for Vercel Cron auth'),

  // -- Classification batch sizing (coerced from string env value)
  CLASSIFICATION_BATCH_SIZE: z.coerce
    .number()
    .int()
    .positive()
    .default(25),

  // -- Taxonomy sync
  GITHUB_SYNC_TOKEN: z.string().min(1).optional().or(z.literal('')),
  TAXONOMY_SYNC_CALLBACK_SECRET: z.string().min(1).optional().or(z.literal('')),

  // -- Sentry server-side (release tagging, source-map upload)
  OBSERVABILITY_SENTRY_AUTH_TOKEN: z.string().min(1).optional().or(z.literal('')),
  OBSERVABILITY_SENTRY_ORG: z.string().min(1).optional().or(z.literal('')),
  OBSERVABILITY_SENTRY_PROJECT: z.string().min(1).optional().or(z.literal('')),

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
// Parse helpers — single source of truth for the failure-message format.
// ---------------------------------------------------------------------------

function formatZodErrors(error: z.ZodError): string {
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
  const result = clientSchema.safeParse(process.env);
  if (!result.success) {
    throw new Error(
      `Invalid client env (NEXT_PUBLIC_*) — fix the following:\n${formatZodErrors(result.error)}`,
    );
  }
  return result.data;
}

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
// Public exports — both parse at module load (fail-fast).
// ---------------------------------------------------------------------------

/**
 * Validated `NEXT_PUBLIC_*` env vars. Safe to read from any execution
 * context (server, client, edge). All values are typed and required ones
 * are guaranteed non-empty by Zod.
 */
export const clientEnv: ClientEnv = parseClientEnv();

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
