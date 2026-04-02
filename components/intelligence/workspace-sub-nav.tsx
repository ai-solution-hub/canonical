'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Rss,
  FileText,
  BarChart3,
  Settings2,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface WorkspaceSubNavProps {
  workspaceId: string;
}

const SUB_NAV_ITEMS = [
  { segment: '', label: 'Overview', icon: LayoutDashboard },
  { segment: '/sources', label: 'Sources', icon: Rss },
  { segment: '/articles', label: 'Articles', icon: FileText },
  { segment: '/metrics', label: 'Metrics', icon: BarChart3 },
  { segment: '/prompts', label: 'Prompts', icon: Settings2 },
] as const;

export function WorkspaceSubNav({ workspaceId }: WorkspaceSubNavProps) {
  const pathname = usePathname();
  const basePath = `/intelligence/${workspaceId}`;

  return (
    <nav aria-label="Workspace sections" className="flex gap-1 border-b pb-px">
      {SUB_NAV_ITEMS.map(({ segment, label, icon: Icon }) => {
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
