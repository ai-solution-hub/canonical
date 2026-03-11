'use client';

import { BarChart3, FileText } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoverageContent } from './coverage-content';
import { TemplateCoverageContent } from '@/components/template-coverage-content';

export function CoveragePageTabs() {
  return (
    <Tabs defaultValue="taxonomy">
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
          <TabsTrigger value="taxonomy" className="gap-1.5">
            <BarChart3 className="size-3.5" aria-hidden="true" />
            Taxonomy
          </TabsTrigger>
          <TabsTrigger value="templates" className="gap-1.5">
            <FileText className="size-3.5" aria-hidden="true" />
            Templates
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="taxonomy" className="mt-6">
        <CoverageContent />
      </TabsContent>

      <TabsContent value="templates" className="mt-6">
        <TemplateCoverageContent />
      </TabsContent>
    </Tabs>
  );
}
