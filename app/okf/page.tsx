/**
 * `/okf` — the Concepts landing index route (ID-132 {132.32} G-LANDING-IMPL,
 * OKF-LANDING.md LI-1). A net-new route: enumerates ALL configured bundles
 * and hosts the full-bundle file explorer (LI-14/LI-15) — distinct from, and
 * complementary to (LI-18), the existing `/okf/[bundleId]` concept-graph
 * viewer, which is unchanged (LI-13).
 *
 * AUTHED — deliberately NOT added to `proxy.ts` `publicRoutes` (LI-2); the
 * Next.js auth middleware already redirects an unauthenticated visitor to
 * `/login` for any non-public route, and every backing API route re-checks
 * auth server-side (defense in depth, matching `/okf/[bundleId]`).
 *
 * A thin server shell — all landing data (bundle list / file tree / file
 * content) loads client-side through `<OkfLanding>`'s TanStack Query hooks
 * against the authed API routes; this page does no direct filesystem read
 * itself (mirrors `app/okf/[bundleId]/page.tsx`'s shape).
 */
import { OkfLanding } from '@/components/okf/okf-landing';

export default function OkfIndexPage() {
  return (
    <div className="h-[calc(100vh-4rem)]">
      <OkfLanding className="h-full" />
    </div>
  );
}
