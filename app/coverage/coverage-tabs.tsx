'use client';

import { useState, useCallback } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import {
  BarChart3,
  BookOpen,
  FileText,
  Target,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConceptHelp } from '@/components/ui/concept-help';
import { CoverageContent } from './coverage-content';
import { TemplateCoverageContent } from '@/components/coverage/template-coverage-content';
import { CoverageGuideTab } from '@/components/coverage/coverage-guide-tab';
import { PriorityGapsTab } from '@/components/coverage/priority-gaps-tab';
import { useUserRole } from '@/hooks/use-user-role';

// ---------------------------------------------------------------------------
// Valid tab values — used to validate the ?tab= query param
// ---------------------------------------------------------------------------

const VALID_TABS = new Set([
  'priority-gaps',
  'taxonomy',
  'templates',
  'guides',
]);

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoveragePageTabs() {
  const { canEdit, loading } = useUserRole();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const tabParam = searchParams.get('tab');
  const initialTab =
    tabParam && VALID_TABS.has(tabParam) ? tabParam : 'priority-gaps';

  const [activeTab, setActiveTab] = useState(initialTab);

  const handleTabChange = useCallback(
    (value: string) => {
      setActiveTab(value);
      // Persist the tab selection in the URL for deep-linking
      const params = new URLSearchParams(searchParams.toString());
      if (value === 'priority-gaps') {
        params.delete('tab');
      } else {
        params.set('tab', value);
      }
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ''}`, { scroll: false });
    },
    [searchParams, router, pathname],
  );

  // P1-11: Redirect viewers — coverage is editor+admin only.
  // Wait for role to load before deciding, to avoid flickering editors.
  // Placed after all hooks to satisfy React rules-of-hooks.
  if (!loading && !canEdit) {
    router.replace('/browse');
    return null;
  }

  return (
    <Tabs value={activeTab} onValueChange={handleTabChange}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-1.5 text-xl font-semibold text-foreground">
            Coverage Dashboard
            <ConceptHelp concept="coverage" />
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Measure knowledge base completeness
          </p>
        </div>

        <TabsList>
          <TabsTrigger value="priority-gaps" className="gap-1.5">
            <Target className="size-3.5" aria-hidden="true" />
            Priority Gaps
          </TabsTrigger>
          <TabsTrigger value="taxonomy" className="gap-1.5">
            <BarChart3 className="size-3.5" aria-hidden="true" />
            Domain Coverage
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText className="size-3.5" aria-hidden="true" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="guides" className="gap-1.5">
            <BookOpen className="size-3.5" aria-hidden="true" />
            Guides
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="priority-gaps" className="mt-6">
        <PriorityGapsTab />
      </TabsContent>

      <TabsContent value="taxonomy" className="mt-6">
        <CoverageContent />
      </TabsContent>

      <TabsContent value="templates" className="mt-6">
        <TemplateCoverageContent />
      </TabsContent>

      <TabsContent value="guides" className="mt-6">
        <CoverageGuideTab />
      </TabsContent>
    </Tabs>
  );
}
