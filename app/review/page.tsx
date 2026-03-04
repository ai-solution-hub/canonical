import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ReviewContent } from './review-content';

export default async function ReviewPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

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
    <Suspense fallback={null}>
      <ReviewContent />
    </Suspense>
  );
}
