'use client';

import { useState, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { PdfDocument } from '@/components/reader/pdf-document';

interface PdfViewerProps {
  /** External URL (existing items) */
  sourceUrl?: string;
  /** Supabase Storage path (uploaded items) */
  filePath?: string;
  title: string;
}

/**
 * Modal PDF viewer triggered by a "View PDF" button. Thin wrapper over the
 * shared `<PdfDocument>` engine inside a `<Dialog>`. The engine is keyed to a
 * per-open counter so page/zoom state reset each time the dialog opens, and
 * keyboard navigation is gated on the dialog being open so a closed viewer does
 * not capture arrow/zoom keys.
 */
export function PdfViewer({ sourceUrl, filePath, title }: PdfViewerProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [openCount, setOpenCount] = useState(0);

  const handleDialogOpenChange = useCallback((open: boolean) => {
    setDialogOpen(open);
    if (open) {
      // Bump the key so the engine remounts with fresh page/zoom state.
      setOpenCount((c) => c + 1);
    }
  }, []);

  return (
    <Dialog open={dialogOpen} onOpenChange={handleDialogOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-pdf-trigger
        >
          <FileText className="size-3.5" />
          View PDF
        </Button>
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-5xl"
        aria-describedby="pdf-viewer-description"
      >
        <DialogHeader>
          <DialogTitle className="truncate">{title}</DialogTitle>
          <DialogDescription id="pdf-viewer-description" className="sr-only">
            Embedded PDF viewer for {title}
          </DialogDescription>
        </DialogHeader>
        <div className="h-[80vh] w-full">
          <PdfDocument
            key={openCount}
            sourceUrl={sourceUrl}
            filePath={filePath}
            keyboardNavEnabled={dialogOpen}
            contentPaddingClassName="p-4"
            toolbarPaddingClassName="px-2"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
