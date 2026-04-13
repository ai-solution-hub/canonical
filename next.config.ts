import { withSentryConfig } from '@sentry/nextjs';
import bundleAnalyzer from '@next/bundle-analyzer';
import type { NextConfig } from 'next';

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const nextConfig: NextConfig = {
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Supabase Storage (project-specific — update per deployment)
      { protocol: 'https', hostname: '*.supabase.co' },
      // GitHub
      { protocol: 'https', hostname: 'opengraph.githubassets.com' },
      // General CDNs
      { protocol: 'https', hostname: '*.s3.amazonaws.com' },
    ],
  },
};

export default withBundleAnalyzer(withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
}));
