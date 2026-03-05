import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { CreateContentClient } from './create-content-client';

export default async function NewItemPage() {
  // Server-side auth check
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

  return <CreateContentClient />;
}
