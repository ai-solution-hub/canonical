'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TaxonomySection } from '@/components/settings/taxonomy-section';
import { TagsSection } from '@/components/settings/tags-section';
import { LayersSection } from '@/components/settings/layers-section';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContentOrganisationTab = 'categories' | 'tags' | 'depth-levels';

const VALID_TABS: ContentOrganisationTab[] = [
  'categories',
  'tags',
  'depth-levels',
];

interface ContentOrganisationSectionProps {
  defaultTab?: ContentOrganisationTab;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContentOrganisationSection({
  defaultTab = 'categories',
}: ContentOrganisationSectionProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Read tab from URL, falling back to the defaultTab prop
  const tabParam = searchParams.get('tab');
  const activeTab: ContentOrganisationTab =
    tabParam && VALID_TABS.includes(tabParam as ContentOrganisationTab)
      ? (tabParam as ContentOrganisationTab)
      : defaultTab;

  function handleTabChange(value: string) {
    const newParams = new URLSearchParams(searchParams.toString());
    newParams.set('tab', value);
    // Ensure we stay on the content-organisation section
    newParams.set('section', 'content-organisation');
    router.replace(`/settings?${newParams.toString()}`, { scroll: false });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-foreground">
          Content Organisation
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">
          How your knowledge is categorised, tagged, and layered.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList>
          <TabsTrigger value="categories">Categories</TabsTrigger>
          <TabsTrigger value="tags">Tags</TabsTrigger>
          <TabsTrigger value="depth-levels">Depth Levels</TabsTrigger>
        </TabsList>

        <TabsContent value="categories" className="mt-4">
          <TaxonomySection />
        </TabsContent>

        <TabsContent value="tags" className="mt-4">
          <TagsSection />
        </TabsContent>

        <TabsContent value="depth-levels" className="mt-4">
          <LayersSection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
