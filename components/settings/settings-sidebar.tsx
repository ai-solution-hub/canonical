'use client';

import {
  User,
  Users,
  ShieldCheck,
  FolderTree,
  Menu,
  Plug,
  Network,
  BookOpen,
  UserCheck,
  Fingerprint,
  ClipboardCheck,
  Building2,
  Tags,
} from 'lucide-react';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';

// ---------------------------------------------------------------------------
// Section definitions
// ---------------------------------------------------------------------------

export type SettingsSection =
  | 'profile'
  | 'organisation'
  | 'connections'
  | 'content-organisation'
  | 'content-owners'
  | 'entities'
  | 'guides'
  | 'tag-morphology'
  | 'team'
  | 'governance'
  | 'reviewer-assignments'
  | 'provenance';

interface SectionDef {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'personal' | 'content' | 'system';
  /** When set, clicking navigates to this route instead of switching section. */
  href?: string;
  /** When true, section is hidden from viewers (admin + editor only). */
  adminOrEditorOnly?: boolean;
}

const ALL_SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Profile', icon: User, group: 'personal' },
  {
    id: 'organisation',
    label: 'Organisation',
    icon: Building2,
    group: 'personal',
    adminOrEditorOnly: true,
  },
  { id: 'connections', label: 'Connections', icon: Plug, group: 'personal' },
  {
    id: 'content-organisation',
    label: 'Content Organisation',
    icon: FolderTree,
    group: 'content',
  },
  {
    id: 'content-owners',
    label: 'Content Owners',
    icon: UserCheck,
    group: 'content',
  },
  {
    id: 'entities',
    label: 'Organisations & People',
    icon: Network,
    group: 'content',
  },
  { id: 'guides', label: 'Guides', icon: BookOpen, group: 'content' },
  {
    id: 'tag-morphology',
    label: 'Tag Morphology',
    icon: Tags,
    group: 'content',
    adminOrEditorOnly: true,
  },
  { id: 'team', label: 'Team', icon: Users, group: 'system' },
  {
    id: 'governance',
    label: 'Quality Review',
    icon: ShieldCheck,
    group: 'system',
  },
  {
    id: 'reviewer-assignments',
    label: 'Reviewer Assignments',
    icon: ClipboardCheck,
    group: 'system',
  },
  {
    id: 'provenance',
    label: 'Provenance',
    icon: Fingerprint,
    group: 'system',
    href: '/provenance',
  },
];

const GROUP_LABELS: Record<string, string> = {
  personal: 'Personal',
  content: 'Content Management',
  system: 'System',
};

const GROUP_ORDER = ['personal', 'content', 'system'] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getVisibleSections(isAdmin: boolean, canEdit = false): SectionDef[] {
  const isAdminOrEditor = isAdmin || canEdit;
  if (isAdmin) return ALL_SECTIONS;
  return ALL_SECTIONS.filter(
    (s) => s.group === 'personal' && (!s.adminOrEditorOnly || isAdminOrEditor),
  );
}

/** Legacy section IDs that map to their new equivalents */
const LEGACY_SECTION_MAP: Record<string, SettingsSection> = {
  taxonomy: 'content-organisation',
  tags: 'content-organisation',
  layers: 'content-organisation',
  integrations: 'connections',
  'developer-setup': 'connections',
};

export function getValidSection(
  param: string | null,
  isAdmin: boolean,
  canEdit = false,
): SettingsSection {
  // Map legacy section IDs to their new equivalents
  const resolved =
    param && LEGACY_SECTION_MAP[param] ? LEGACY_SECTION_MAP[param] : param;
  const visible = getVisibleSections(isAdmin, canEdit);
  const match = visible.find((s) => s.id === resolved);
  return match?.id ?? 'profile';
}

// ---------------------------------------------------------------------------
// Sidebar nav (shared between desktop and mobile)
// ---------------------------------------------------------------------------

function SidebarNav({
  sections,
  activeSection,
  onSelect,
}: {
  sections: SectionDef[];
  activeSection: SettingsSection;
  onSelect: (section: SettingsSection) => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const groups = GROUP_ORDER.filter((g) => sections.some((s) => s.group === g));

  return (
    <nav aria-label="Settings navigation" className="flex flex-col gap-1">
      {groups.map((group, groupIdx) => {
        const groupSections = sections.filter((s) => s.group === group);
        return (
          <div key={group}>
            {groupIdx > 0 && <div className="my-2 border-t border-border" />}
            <div role="group" aria-label={GROUP_LABELS[group]}>
              <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {GROUP_LABELS[group]}
              </p>
              {groupSections.map((section) => {
                const Icon = section.icon;
                const isActive = section.href
                  ? pathname === section.href
                  : activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() =>
                      section.href
                        ? router.push(section.href)
                        : onSelect(section.id)
                    }
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon className="size-4 shrink-0" />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Desktop sidebar
// ---------------------------------------------------------------------------

export function SettingsSidebar({
  isAdmin,
  canEdit = false,
  activeSection,
  onSectionChange,
}: {
  isAdmin: boolean;
  canEdit?: boolean;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const sections = getVisibleSections(isAdmin, canEdit);

  // If only one section visible, no sidebar needed
  if (sections.length <= 1) return null;

  return (
    <aside
      className="hidden w-56 shrink-0 md:block"
      aria-label="Settings navigation"
    >
      <SidebarNav
        sections={sections}
        activeSection={activeSection}
        onSelect={onSectionChange}
      />
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Mobile sidebar (Sheet / drawer)
// ---------------------------------------------------------------------------

export function SettingsMobileSidebar({
  isAdmin,
  canEdit = false,
  activeSection,
  onSectionChange,
}: {
  isAdmin: boolean;
  canEdit?: boolean;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const sections = getVisibleSections(isAdmin, canEdit);
  const [open, setOpen] = useState(false);

  // No mobile sidebar if only one section
  if (sections.length <= 1) return null;

  const activeDef = sections.find((s) => s.id === activeSection);

  return (
    <div className="md:hidden">
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <Menu className="size-4" />
            {activeDef?.label ?? 'Settings'}
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-[260px] px-4 pt-6">
          <SheetHeader className="mb-4">
            <SheetTitle>Settings</SheetTitle>
            <SheetDescription className="sr-only">
              Settings navigation
            </SheetDescription>
          </SheetHeader>
          <SidebarNav
            sections={sections}
            activeSection={activeSection}
            onSelect={(section) => {
              onSectionChange(section);
              setOpen(false);
            }}
          />
        </SheetContent>
      </Sheet>
    </div>
  );
}
