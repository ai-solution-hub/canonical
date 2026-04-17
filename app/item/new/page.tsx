import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { NewItemTabs } from './new-item-tabs';

const VALID_TABS = ['write', 'url', 'upload', 'batch'] as const;
type ValidTab = (typeof VALID_TABS)[number];

interface Props {
  searchParams: Promise<{ tab?: string }>;
}

export default async function NewItemPage({ searchParams }: Props) {
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

  const { tab } = await searchParams;
  const defaultTab: ValidTab = VALID_TABS.includes(tab as ValidTab)
    ? (tab as ValidTab)
    : 'write';

  return <NewItemTabs defaultTab={defaultTab} />;
}
