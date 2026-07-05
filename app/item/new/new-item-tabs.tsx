'use client';

import { useState } from 'react';
import { Globe, FileUp, TableProperties } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { UrlIngestForm } from '@/components/create-content/url-ingest-form';
import { UploadTabContent } from '@/components/create-content/upload-tab-content';
import { BatchCreateContent } from './batch/batch-create-client';

type NewItemTab = 'url' | 'upload' | 'batch';

const VALID_TABS: readonly NewItemTab[] = ['url', 'upload', 'batch'];

interface NewItemTabsProps {
  /** Which tab to show initially. Defaults to 'url'. */
  defaultTab?: NewItemTab;
}

/**
 * Tabbed interface for creating new content items.
 *
 * Three methods available:
 * - "Import from URL" — fetch and extract from a web page
 * - "Upload file" — drag-and-drop file upload with review step
 * - "Batch Q&A" — paste multiple Q&A pairs from a spreadsheet
 *
 * The generic "Write content" manual-create path and its template-picker
 * chain were removed (ID-131.18 / BI-33 — S438 owner-ratified narrowing).
 */
export function NewItemTabs({ defaultTab = 'url' }: NewItemTabsProps) {
  const initialTab: NewItemTab = VALID_TABS.includes(defaultTab)
    ? defaultTab
    : 'url';
  const [activeTab, setActiveTab] = useState<string>(initialTab);

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="mb-4 w-full sm:w-auto">
        <TabsTrigger value="url" className="gap-1.5">
          <Globe className="size-4" aria-hidden="true" />
          Import from URL
        </TabsTrigger>
        <TabsTrigger value="upload" className="gap-1.5">
          <FileUp className="size-4" aria-hidden="true" />
          Upload file
        </TabsTrigger>
        <TabsTrigger value="batch" className="gap-1.5">
          <TableProperties className="size-4" aria-hidden="true" />
          Batch Q&A
        </TabsTrigger>
      </TabsList>

      <TabsContent value="url">
        <section aria-label="Import content from URL">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-foreground">
                Import from URL
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a web page URL to extract its content, classify it, and
                add it to the knowledge base automatically.
              </p>
            </div>
            <UrlIngestForm />
          </div>
        </section>
      </TabsContent>

      <TabsContent value="upload">
        <section aria-label="Upload documents">
          <UploadTabContent onSwitchTab={setActiveTab} />
        </section>
      </TabsContent>

      <TabsContent value="batch">
        <section aria-label="Batch Q&A creation">
          <BatchCreateContent />
        </section>
      </TabsContent>
    </Tabs>
  );
}
