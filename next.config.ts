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

export default withBundleAnalyzer(withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.OBSERVABILITY_SENTRY_ORG,
  project: process.env.OBSERVABILITY_SENTRY_PROJECT,
  authToken: process.env.OBSERVABILITY_SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.OBSERVABILITY_SENTRY_AUTH_TOKEN,
  },
}));
