'use client';

import { useState } from 'react';
import { PenLine, Globe, FileUp, TableProperties } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateContentClient } from './create-content-client';
import { UrlIngestForm } from '@/components/create-content/url-ingest-form';
import { UploadTabContent } from '@/components/create-content/upload-tab-content';
import { FileUploadDialog } from '@/components/create-content/file-upload-dialog';
import { BatchCreateContent } from './batch/batch-create-client';

interface NewItemTabsProps {
  /** Which tab to show initially. Defaults to 'write'. */
  defaultTab?: 'write' | 'url' | 'upload' | 'batch';
}

/**
 * Tabbed interface for creating new content items.
 *
 * Four methods available:
 * - "Write content" — the existing manual create form
 * - "Import from URL" — fetch and extract from a web page
 * - "Upload file" — drag-and-drop file upload with review step
 * - "Batch Q&A" — paste multiple Q&A pairs from a spreadsheet
 *
 * The FileUploadDialog remains available for quick-upload from the Browse page.
 */
export function NewItemTabs({ defaultTab = 'write' }: NewItemTabsProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);
  const [showUploadDialog, setShowUploadDialog] = useState(false);

  return (
    <>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4 w-full sm:w-auto">
          <TabsTrigger value="write" className="gap-1.5">
            <PenLine className="size-4" aria-hidden="true" />
            Write content
          </TabsTrigger>
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

        <TabsContent value="write">
          <section aria-label="Write new content">
            <CreateContentClient />
            {/* Cross-method suggestion */}
            <div className="mx-auto mt-4 max-w-4xl px-4 sm:px-6">
              <p className="text-center text-xs text-muted-foreground">
                Have a file instead?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('upload')}
                  className="rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                >
                  Upload it
                </button>
              </p>
            </div>
          </section>
        </TabsContent>

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
              <UrlIngestForm onSuggestManual={() => setActiveTab('write')} />
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

      {/* Dialog still available for Browse page quick-upload */}
      <FileUploadDialog
        open={showUploadDialog}
        onOpenChange={setShowUploadDialog}
      />
    </>
  );
}
