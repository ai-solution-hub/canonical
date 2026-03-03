'use client';

import { useState } from 'react';
import {
  Download,
  FileText,
  Copy,
  Printer,
  Mail,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  digestToMarkdown,
  downloadDigestDocx,
  digestTypeLabel,
} from '@/lib/digest-export';
import type { Digest, SharedDigest } from '@/types/digest';

interface DigestExportMenuProps {
  digest: Digest | SharedDigest;
  shareUrl?: string | null;
}

export function DigestExportMenu({ digest, shareUrl }: DigestExportMenuProps) {
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  async function handleCopyMarkdown() {
    try {
      const md = digestToMarkdown(digest);
      await navigator.clipboard.writeText(md);
      toast.success('Copied as Markdown');
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  }

  async function handleDownloadDocx() {
    setDownloadingDocx(true);
    try {
      await downloadDigestDocx(digest);
      toast.success('DOCX downloaded');
    } catch {
      toast.error('Failed to generate DOCX');
    } finally {
      setDownloadingDocx(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function handleEmail() {
    const subject = encodeURIComponent(digestTypeLabel(digest.digest_type));
    const body = shareUrl
      ? encodeURIComponent(`View digest at: ${shareUrl}`)
      : encodeURIComponent(digestTypeLabel(digest.digest_type));
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          data-no-print
        >
          <Download className="size-3.5" />
          Export
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={handleCopyMarkdown}>
          <Copy className="size-4" />
          Copy as Markdown
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={handleDownloadDocx}
          disabled={downloadingDocx}
        >
          {downloadingDocx ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileText className="size-4" />
          )}
          Download DOCX
        </DropdownMenuItem>

        <DropdownMenuItem onClick={handlePrint}>
          <Printer className="size-4" />
          Print / Save as PDF
        </DropdownMenuItem>

        {shareUrl && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleEmail}>
              <Mail className="size-4" />
              Email
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
