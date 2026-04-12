import { redirect } from 'next/navigation';
import { BRANDING } from '@/lib/client-config';
import { createClient } from '@/lib/supabase/server';
import { BatchCreateClient } from './batch-create-client';

export const metadata = {
  title: `Batch Create Q&A Pairs | ${BRANDING.productName}`,
  description:
    'Create multiple Q&A pairs at once by pasting from a spreadsheet.',
};

export default async function BatchCreatePage() {
  // Server-side auth check — editors and admins only
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Check user role
  const { data: roleData } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  const role = roleData?.role ?? 'viewer';

  if (role === 'viewer') {
    redirect('/browse');
  }

  return <BatchCreateClient />;
}
