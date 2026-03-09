'use client';

import { User, Users, ShieldCheck, Activity, FolderTree, Tags, Menu, Plug } from 'lucide-react';
import { useState } from 'react';
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
  | 'integrations'
  | 'taxonomy'
  | 'tags'
  | 'team'
  | 'governance'
  | 'activity';

interface SectionDef {
  id: SettingsSection;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group: 'personal' | 'content' | 'system';
}

const ALL_SECTIONS: SectionDef[] = [
  { id: 'profile', label: 'Profile', icon: User, group: 'personal' },
  { id: 'integrations', label: 'Integrations', icon: Plug, group: 'personal' },
  { id: 'taxonomy', label: 'Taxonomy', icon: FolderTree, group: 'content' },
  { id: 'tags', label: 'Tags', icon: Tags, group: 'content' },
  { id: 'team', label: 'Team', icon: Users, group: 'system' },
  { id: 'governance', label: 'Governance', icon: ShieldCheck, group: 'system' },
  { id: 'activity', label: 'Activity', icon: Activity, group: 'system' },
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

function getVisibleSections(isAdmin: boolean): SectionDef[] {
  if (isAdmin) return ALL_SECTIONS;
  return ALL_SECTIONS.filter((s) => s.group === 'personal');
}

export function getValidSection(
  param: string | null,
  isAdmin: boolean,
): SettingsSection {
  const visible = getVisibleSections(isAdmin);
  const match = visible.find((s) => s.id === param);
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
  const groups = GROUP_ORDER.filter((g) =>
    sections.some((s) => s.group === g),
  );

  return (
    <nav aria-label="Settings navigation" className="flex flex-col gap-1">
      {groups.map((group, groupIdx) => {
        const groupSections = sections.filter((s) => s.group === group);
        return (
          <div key={group}>
            {groupIdx > 0 && (
              <div className="my-2 border-t border-border" />
            )}
            <p className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {GROUP_LABELS[group]}
            </p>
            {groupSections.map((section) => {
              const Icon = section.icon;
              const isActive = activeSection === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => onSelect(section.id)}
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
  activeSection,
  onSectionChange,
}: {
  isAdmin: boolean;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const sections = getVisibleSections(isAdmin);

  // If only one section visible, no sidebar needed
  if (sections.length <= 1) return null;

  return (
    <aside className="hidden w-56 shrink-0 md:block">
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
  activeSection,
  onSectionChange,
}: {
  isAdmin: boolean;
  activeSection: SettingsSection;
  onSectionChange: (section: SettingsSection) => void;
}) {
  const sections = getVisibleSections(isAdmin);
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
