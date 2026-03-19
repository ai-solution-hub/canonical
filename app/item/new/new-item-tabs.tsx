'use client';

import { PenLine, Globe } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateContentClient } from './create-content-client';
import { UrlIngestForm } from '@/components/url-ingest-form';

/**
 * Tabbed interface for creating new content items.
 *
 * Two tabs:
 * - "Write content" — the existing manual create form
 * - "Import from URL" — fetch and extract from a web page
 */
export function NewItemTabs() {
  return (
    <Tabs defaultValue="write" className="w-full">
      <TabsList className="mb-4 w-full sm:w-auto">
        <TabsTrigger value="write" className="gap-1.5">
          <PenLine className="size-4" aria-hidden="true" />
          Write content
        </TabsTrigger>
        <TabsTrigger value="url" className="gap-1.5">
          <Globe className="size-4" aria-hidden="true" />
          Import from URL
        </TabsTrigger>
      </TabsList>

      <TabsContent value="write">
        <CreateContentClient />
      </TabsContent>

      <TabsContent value="url">
        <section aria-label="Import content from URL">
          <div className="mx-auto max-w-2xl">
            <div className="mb-6">
              <h2 className="text-lg font-semibold text-foreground">
                Import from URL
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Paste a web page URL to extract its content, classify it, and add
                it to the knowledge base automatically.
              </p>
            </div>
            <UrlIngestForm />
          </div>
        </section>
      </TabsContent>
    </Tabs>
  );
}
