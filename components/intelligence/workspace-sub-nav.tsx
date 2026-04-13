'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Rss,
  FileText,
  BarChart3,
  Settings2,
  Sliders,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-user-role';

interface WorkspaceSubNavProps {
  workspaceId: string;
}

const SUB_NAV_ITEMS = [
  { segment: '', label: 'Overview', icon: LayoutDashboard, adminOnly: false },
  { segment: '/sources', label: 'Sources', icon: Rss, adminOnly: false },
  { segment: '/articles', label: 'Articles', icon: FileText, adminOnly: false },
  { segment: '/metrics', label: 'Metrics', icon: BarChart3, adminOnly: false },
  {
    segment: '/filter-rules',
    label: 'Filter rules',
    icon: Settings2,
    adminOnly: true,
  },
  { segment: '/settings', label: 'Settings', icon: Sliders, adminOnly: false },
] as const;

export function WorkspaceSubNav({ workspaceId }: WorkspaceSubNavProps) {
  const pathname = usePathname();
  const { role } = useUserRole();
  const isAdmin = role === 'admin';
  const basePath = `/intelligence/${workspaceId}`;

  const visibleItems = SUB_NAV_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin,
  );

  return (
    <nav aria-label="Workspace sections" className="flex gap-1 border-b pb-px">
      {visibleItems.map(({ segment, label, icon: Icon }) => {
        const href = `${basePath}${segment}`;
        const isActive =
          segment === ''
            ? pathname === href
            : pathname === href || pathname?.startsWith(href + '/');

        return (
          <Link
            key={segment}
            href={href}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex items-center gap-1.5 rounded-t-md px-3 py-2 text-sm transition-colors',
              isActive
                ? '-mb-px border-b-2 border-foreground font-semibold text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
