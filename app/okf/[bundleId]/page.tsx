/**
 * `/okf/[bundleId]` — the `{132.14}` G-VIEWER bundle-viewer page
 * (TECH-ADDENDUM-reference-agents.md Part 2 §Target TS surface).
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes`; the Next.js
 * auth middleware already redirects an unauthenticated visitor to `/login`
 * for any non-public route, and the backing `/api/okf/[bundleId]/graph`
 * route re-checks auth server-side (defense in depth).
 *
 * A thin server shell: all bundle data (graph/nav/log) loads client-side
 * through `<BundleViewer>`'s TanStack Query hooks against the authed API
 * route — this page does no direct Supabase/filesystem read itself.
 */
import { BundleViewer } from '@/components/okf/bundle-viewer';

export default async function OkfBundlePage({
  params,
}: {
  params: Promise<{ bundleId: string }>;
}) {
  const { bundleId } = await params;

  return (
    <div className="h-[calc(100vh-4rem)]">
      <BundleViewer bundleId={bundleId} />
    </div>
  );
}
