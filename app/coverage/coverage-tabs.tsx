'use client';

import { useState } from 'react';
import {
  BarChart3,
  BookOpen,
  FileText,
  Target,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageContent } from './coverage-content';
import { TemplateCoverageContent } from '@/components/coverage/template-coverage-content';
import { CoverageGuideTab } from '@/components/coverage/coverage-guide-tab';
import { PriorityGapsTab } from '@/components/coverage/priority-gaps-tab';

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CoveragePageTabs() {
  const [activeTab, setActiveTab] = useState('priority-gaps');

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">
            Coverage Dashboard
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
