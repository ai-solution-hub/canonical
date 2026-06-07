import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  // Skill markdown is inlined at build time via
  // scripts/generate-skills-inline.ts (output: lib/ai/skills/inlined.generated.ts)
  // so no runtime FS access is required. The previous outputFileTracingIncludes
  // entry did not reliably copy lib/ai/skills/*.md into Vercel serverless
  // function bundles (App Router source-path glob mismatch + __dirname
  // resolution drift) and was the root cause of MCP classify_content ENOENT.
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Supabase Storage (project-specific — update per deployment)
      { protocol: 'https', hostname: '*.supabase.co' },
      // GitHub
      { protocol: 'https', hostname: 'opengraph.githubassets.com' },
      // General CDNs
      { protocol: 'https', hostname: '*.s3.amazonaws.com' },
      // News / intelligence article thumbnails
      { protocol: 'https', hostname: 'schoolsweek.co.uk' },
      { protocol: 'https', hostname: 'cdn.ps.emap.com' },
      { protocol: 'https', hostname: 'www.gov.uk' },
      { protocol: 'https', hostname: 'assets.publishing.service.gov.uk' },
    ],
  },
};

// Sentry release/upload config. Bare SENTRY_* names match the Vercel→Sentry
// integration's default outputs — no translation layer needed in CI. These
// are optional at build time (lib/env.ts marks them all `.optional()`); when
// unset, source-map upload is disabled and release tagging falls back to the
// commit SHA only. We read them via process.env (not serverEnv) because
// next.config.ts runs at build orchestration time and importing serverEnv
// would force a Zod parse of every required server var just to construct
// the Next config — needlessly tight coupling for optional Sentry knobs.
//
// Turbopack source-map upload (Next.js 16+ default bundler):
// `@sentry/nextjs@10.13.0+` uses Next.js's `runAfterProductionCompile` hook
// to upload source maps post-build, with content-deterministic debug IDs
// injected natively by Turbopack (`turbopack.debugIds = true` is set
// automatically by the SDK when sourcemaps.disable !== true). See
// `docs/audits/kh-production-readiness-phase-1/specs/wp-s8c.1-turbopack-sourcemap-spec.md`
// for the full investigation that produced this configuration shape.
export default withBundleAnalyzer(
  withSentryConfig(nextConfig, {
    // Verbose on CI so any upload failure shows in the build log; quiet
    // locally so dev builds aren't spammed with telemetry. Vercel sets CI=1
    // automatically. The previous `silent: true` made it impossible to
    // diagnose the S7/S9 prod symbolication regression (probe events
    // had release/env tags but unsymbolicated frames;
    // Sentry-CLI errors via SDK errorHandler are non-fatal so the build
    // exits 0 either way — the only signal is in stderr, which silent: true
    // suppressed for ~36h on prod).
    silent: !process.env.CI,
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    release: {
      // VERCEL_GIT_COMMIT_SHA is auto-injected as `release.name` into every
      // Sentry event via withSentryConfig's build-time variable substitution
      // (writes `_sentryRelease` into nextConfig.env). Release create+finalize
      // disabled because Turbopack debug IDs handle source-map correlation
      // independently of the Sentry release lifecycle — release-create is a
      // separate failure surface that doesn't impact symbolication.
      name: process.env.VERCEL_GIT_COMMIT_SHA,
      create: false,
      finalize: false,
    },
    sourcemaps: {
      // No SENTRY_AUTH_TOKEN → bundler plugin would attempt API call and
      // fail; we'd rather no-op explicitly. With the token set, the
      // post-production-compile hook uploads to Sentry using debug IDs.
      disable: !process.env.SENTRY_AUTH_TOKEN,
    },
  }),
);
