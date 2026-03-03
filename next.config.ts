import type { NextConfig } from 'next';

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

export default nextConfig;
