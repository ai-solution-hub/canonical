'use client';

import { useRouter } from 'next/navigation';
import { ConceptHelp } from '@/components/ui/concept-help';
import { TemplateCoverageContent } from '@/components/coverage/template-coverage-content';
import { useUserRole } from '@/hooks/use-user-role';

// ---------------------------------------------------------------------------
// Main component
//
// ID-131.19 fix-Executor escalation 2 (DR-034, owner ruling): the
// content_items-era coverage feature (taxonomy heatmap, priority gaps,
// guides tabs + their backing RPCs) has been retired — only
// template-completion coverage survives. This component previously hosted
// a 4-tab `Tabs` shell (priority-gaps / taxonomy / templates / guides); it
// now renders the single surviving view directly. Kept as its own
// component (rather than folded into page.tsx) to preserve the existing
// access-gating test seam and minimise diff footprint.
// ---------------------------------------------------------------------------

export function CoveragePageTabs() {
  const { canEdit, loading } = useUserRole();
  const router = useRouter();

  // P1-11: Redirect viewers — coverage is editor+admin only.
  // Wait for role to load before deciding, to avoid flickering editors.
  // Placed after all hooks to satisfy React rules-of-hooks.
  if (!loading && !canEdit) {
    router.replace('/browse');
    return null;
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="flex items-center gap-1.5 text-xl font-semibold text-foreground">
          Coverage Dashboard
          <ConceptHelp concept="coverage" />
        </h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Measure knowledge base completeness
        </p>
      </div>

      <TemplateCoverageContent />
    </div>
  );
}
