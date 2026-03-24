'use client';

import { lazy, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Settings, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useUserRole } from '@/hooks/use-user-role';
import { ProfileSection } from '@/components/settings/profile-section';
import { ConnectionsSection } from '@/components/settings/connections-section';
import {
  SettingsSidebar,
  SettingsMobileSidebar,
  getValidSection,
} from '@/components/settings/settings-sidebar';
import type { SettingsSection } from '@/components/settings/settings-sidebar';

// ---------------------------------------------------------------------------
// Lazy-loaded admin-only sections — kept out of the main bundle for non-admin
// users. lazy() requires a default export, so we re-export the named
// export from each module.
// ---------------------------------------------------------------------------

const LazyTeamSection = lazy(() =>
  import('@/components/settings/team-section').then((m) => ({ default: m.TeamSection }))
);
const LazyGovernanceSection = lazy(() =>
  import('@/components/settings/governance-section').then((m) => ({ default: m.GovernanceSection }))
);
const LazyActivitySection = lazy(() =>
  import('@/components/settings/activity-section').then((m) => ({ default: m.ActivitySection }))
);
const LazyTaxonomySection = lazy(() =>
  import('@/components/settings/taxonomy-section').then((m) => ({ default: m.TaxonomySection }))
);
const LazyTagsSection = lazy(() =>
  import('@/components/settings/tags-section').then((m) => ({ default: m.TagsSection }))
);
const LazyEntitiesSection = lazy(() =>
  import('@/components/settings/entities-section').then((m) => ({ default: m.EntitiesSection }))
);
const LazyGuidesSection = lazy(() =>
  import('@/components/settings/guides-section').then((m) => ({ default: m.GuidesSection }))
);
const LazyLayersSection = lazy(() =>
  import('@/components/settings/layers-section').then((m) => ({ default: m.LayersSection }))
);
const LazyDeveloperSetupSection = lazy(() =>
  import('@/components/settings/developer-setup-section').then((m) => ({ default: m.DeveloperSetupSection }))
);

// ---------------------------------------------------------------------------
// Section loading skeleton — shown briefly while a lazy section chunk loads
// ---------------------------------------------------------------------------

function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-6 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-72 animate-pulse rounded bg-muted" />
      <div className="mt-6 space-y-3">
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
        <div className="h-10 w-full animate-pulse rounded bg-muted" />
        <div className="h-10 w-3/4 animate-pulse rounded bg-muted" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section renderer
// ---------------------------------------------------------------------------

function SectionContent({ section }: { section: SettingsSection }) {
  switch (section) {
    case 'profile':
      return <ProfileSection />;
    case 'connections':
      return <ConnectionsSection />;
    case 'developer-setup':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyDeveloperSetupSection />
        </Suspense>
      );
    case 'taxonomy':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyTaxonomySection />
        </Suspense>
      );
    case 'tags':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyTagsSection />
        </Suspense>
      );
    case 'entities':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyEntitiesSection />
        </Suspense>
      );
    case 'guides':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyGuidesSection />
        </Suspense>
      );
    case 'layers':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyLayersSection />
        </Suspense>
      );
    case 'team':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyTeamSection />
        </Suspense>
      );
    case 'governance':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyGovernanceSection />
        </Suspense>
      );
    case 'activity':
      return (
        <Suspense fallback={<SectionSkeleton />}>
          <LazyActivitySection />
        </Suspense>
      );
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

  return (
    <div className={cn('mx-auto px-4 py-8 sm:px-6', canAdmin ? 'max-w-5xl' : 'max-w-3xl')}>
      <div className="mb-6 flex items-center gap-3">
        <Settings className="size-6 text-muted-foreground" aria-hidden="true" />
        <div className="flex-1">
          <h1 className="text-xl font-semibold">Settings</h1>
          <p className="text-sm text-muted-foreground">
            {canAdmin
              ? 'Manage your profile and system configuration'
              : 'Manage your profile and connections'}
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
        <section className="min-w-0 flex-1" aria-label="Settings content">
          <SectionContent section={activeSection} />
        </section>
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
