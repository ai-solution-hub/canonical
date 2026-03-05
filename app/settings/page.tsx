'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Settings, Loader2 } from 'lucide-react';
import { useUserRole } from '@/hooks/use-user-role';
import { ProfileSection } from '@/components/settings/profile-section';
import { TeamSection } from '@/components/settings/team-section';
import { GovernanceSection } from '@/components/settings/governance-section';
import { ActivitySection } from '@/components/settings/activity-section';
import { TaxonomySection } from '@/components/settings/taxonomy-section';
import {
  SettingsSidebar,
  SettingsMobileSidebar,
  getValidSection,
} from '@/components/settings/settings-sidebar';
import type { SettingsSection } from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'profile':
      return <ProfileSection />;
    case 'taxonomy':
      return <TaxonomySection />;
    case 'team':
      return <TeamSection />;
    case 'governance':
      return <GovernanceSection />;
    case 'activity':
      return <ActivitySection />;
    default:
      return <ProfileSection />;
  }
}

// ---------------------------------------------------------------------------
// Settings Page Content
// ---------------------------------------------------------------------------

function SettingsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loading, canAdmin } = useUserRole();

  // Support both ?section= and legacy ?tab= parameters
  const sectionParam = searchParams.get('section') ?? searchParams.get('tab');
  const activeSection = getValidSection(sectionParam, canAdmin);

  function handleSectionChange(section: SettingsSection) {
    const newParams = new URLSearchParams(searchParams.toString());
    // Remove legacy tab param if present
    newParams.delete('tab');
    newParams.set('section', section);
    router.replace(`/settings?${newParams.toString()}`, { scroll: false });
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-16 sm:px-6">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Non-admin: simple layout, no sidebar
  if (!canAdmin) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <div className="mb-6 flex items-center gap-3">
          <Settings className="size-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">Settings</h1>
            <p className="text-sm text-muted-foreground">
              Manage your profile
            </p>
          </div>
        </div>
        <ProfileSection />
      </div>
    );
  }

  // Admin: sidebar layout
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center gap-3">
        <Settings className="size-6 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your profile and system configuration
          </p>
        </div>
        <SettingsMobileSidebar
          isAdmin={canAdmin}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
      </div>

      <div className="flex gap-8">
        <SettingsSidebar
          isAdmin={canAdmin}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
        />
        <main className="min-w-0 flex-1">
          <SectionContent section={activeSection} />
        </main>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page skeleton
// ---------------------------------------------------------------------------

function SettingsPageSkeleton() {
  return (
    <div className="mx-auto flex max-w-3xl items-center justify-center px-4 py-16 sm:px-6">
      <Loader2 className="size-6 animate-spin text-muted-foreground" />
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<SettingsPageSkeleton />}>
      <SettingsContent />
    </Suspense>
  );
}
