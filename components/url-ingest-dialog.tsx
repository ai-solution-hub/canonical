'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { UrlIngestForm } from '@/components/url-ingest-form';

interface UrlIngestDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Dialog wrapper for the URL ingestion form.
 *
 * Can be triggered from navigation, dashboard actions, or anywhere
 * a quick "import from URL" entry point is needed.
 */
export function UrlIngestDialog({ open, onOpenChange }: UrlIngestDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import from URL</DialogTitle>
          <DialogDescription>
            Paste a web page URL to extract and add its content to the knowledge base.
          </DialogDescription>
        </DialogHeader>
        <UrlIngestForm />
      </DialogContent>
    </Dialog>
  );
}
