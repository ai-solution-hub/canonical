import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { tryQuery } from '@/lib/supabase/safe';
import { logBestEffortWarn } from '@/lib/supabase/telemetry';
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

  // Check user role. Use tryQuery so a Supabase failure surfaces a
  // structured warning instead of silently treating the user as a viewer
  // (the safe-default fall-through still applies for "no row" / failure).
  const roleResult = await tryQuery(
    supabase.from('user_roles').select('role').eq('user_id', user.id).single(),
    'item.new.user_role',
  );
  if (!roleResult.ok) {
    logBestEffortWarn(
      'item.new.user_role',
      'user_roles lookup failed; falling back to viewer',
      {
        userId: user.id,
        err: roleResult.error.message,
        code: roleResult.error.code,
      },
    );
  }
  const role = roleResult.ok ? (roleResult.data?.role ?? 'viewer') : 'viewer';

  if (role === 'viewer') {
    redirect('/browse');
  }

  const { tab } = await searchParams;
  const defaultTab: ValidTab = VALID_TABS.includes(tab as ValidTab)
    ? (tab as ValidTab)
    : 'write';

  return <NewItemTabs defaultTab={defaultTab} />;
}
