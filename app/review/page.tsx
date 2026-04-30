import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ReviewTabs } from '@/components/review/review-tabs';

export default async function ReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not authenticated: redirect to login
  if (!user) {
    redirect('/login');
  }

  // Check role: viewers cannot access the review page
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const role = roleData?.role ?? 'viewer';

  if (role === 'viewer') {
    // Redirect viewers to browse with a query param the client can use
    // to show a toast message
    redirect('/browse?notice=review_requires_editor');
  }

  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-label="Loading review"
          className="flex items-center justify-center py-20"
        >
          <div className="size-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
          <span className="sr-only">Loading review...</span>
        </div>
      }
    >
      {/* S215 W1: Suspense child swap — ReviewTabs hosts the Radix Tabs
          surface and mounts ReviewContent for tabs 1-5 +
          PublicationReviewQueue for tab 6. Spec:
          docs/specs/review-page-tabs-refactor-spec.md §4. */}
      <ReviewTabs />
    </Suspense>
  );
}
