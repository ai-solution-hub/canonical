import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { getAuthenticatedClient } from '@/lib/auth/client';
import { CorpusSearchContent } from './search-content';

/**
 * `/search` — corpus search/browse page (ID-135 {135.9}, Surface A).
 *
 * Authenticated, read-only server shell (TECH §2, §3 BI-1, BI-7):
 * `getAuthenticatedClient()` → an explicit `auth.success` check redirects an
 * unauthenticated visitor to `/login`. This is defence-in-depth alongside
 * `proxy.ts` `publicRoutes` — `/search` is deliberately OMITTED from that
 * allowlist (this route is authenticated, not public), and that omission is
 * what makes the middleware itself redirect an unauthenticated request
 * before this component ever runs (BI-1). `authFailureResponse()` returns a
 * `NextResponse`, which is not a valid Server Component return type here —
 * `redirect('/login')` is the page-component-correct equivalent, matching
 * the established `app/workspaces/page.tsx` pattern.
 *
 * Wraps the client `CorpusSearchContent` in `Suspense` — Next.js requires a
 * boundary above any `useSearchParams()` consumer (mirrors
 * `app/reference/page.tsx`). Renders NO create/update/delete affordance
 * (BI-1); `/search` is a distinct read-only surface linking INTO `/library`,
 * `/documents/[id]` and `/reference/[id]` (RD-1).
 *
 * Spec: TECH §2, §3 BI-1, BI-7; PRODUCT.md BI-1, BI-7.
 */
export default async function SearchPage() {
  const auth = await getAuthenticatedClient();
  if (!auth.success) {
    redirect('/login');
  }

  return (
    <Suspense fallback={<SearchPageSkeleton />}>
      <CorpusSearchContent />
    </Suspense>
  );
}

function SearchPageSkeleton() {
  return (
    <div
      className="mx-auto max-w-7xl px-4 py-8 sm:px-6"
      role="status"
      aria-label="Loading search page"
    >
      <span className="sr-only">Loading search page...</span>
      <div className="h-7 w-48 animate-pulse rounded-md bg-accent" />
      <div className="mt-4 h-9 w-full animate-pulse rounded-md bg-accent" />
      <div
        className="mt-6 grid gap-4"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}
      >
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border bg-card p-3"
          >
            <div className="h-5 w-16 animate-pulse rounded-full bg-accent" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-accent" />
            <div className="h-3 w-full animate-pulse rounded bg-accent" />
            <div className="h-3 w-1/2 animate-pulse rounded bg-accent" />
          </div>
        ))}
      </div>
    </div>
  );
}
