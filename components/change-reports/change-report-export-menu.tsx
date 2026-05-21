'use client';

import { useState } from 'react';
import { Download, FileText, Copy, Printer, Mail, Loader2 } from 'lucide-react';
import { BRANDING } from '@/lib/client-config';
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
  changeReportToMarkdown,
  downloadChangeReportDocx,
} from '@/lib/change-reports/change-reports-export';
import { changeReportFrequencyLabel } from '@/lib/change-reports/change-reports-helpers';
import { safeErrorMessage } from '@/lib/error';
import type { ChangeReport } from '@/types/change-reports';

interface ChangeReportExportMenuProps {
  digest: ChangeReport;
}

export function ChangeReportExportMenu({ digest }: ChangeReportExportMenuProps) {
  const [downloadingDocx, setDownloadingDocx] = useState(false);

  async function handleCopyMarkdown() {
    try {
      const md = changeReportToMarkdown(digest);
      await navigator.clipboard.writeText(md);
      toast.success('Copied as Markdown');
    } catch (err) {
      console.error('Failed to copy change report as Markdown:', err);
      toast.error(safeErrorMessage(err, 'Failed to copy to clipboard'));
    }
  }

  async function handleDownloadDocx() {
    setDownloadingDocx(true);
    try {
      await downloadChangeReportDocx(digest);
      toast.success('DOCX downloaded');
    } catch (err) {
      console.error('Failed to generate DOCX:', err);
      toast.error(safeErrorMessage(err, 'Failed to generate DOCX'));
    } finally {
      setDownloadingDocx(false);
    }
  }

  function handlePrint() {
    window.print();
  }

  function handleEmail() {
    const label = changeReportFrequencyLabel(digest.digest_type);
    const subject = encodeURIComponent(`${label} — ${BRANDING.productName}`);
    const md = changeReportToMarkdown(digest);
    const body = encodeURIComponent(md);
    window.open(`mailto:?subject=${subject}&body=${body}`, '_self');
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" data-no-print>
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

        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleEmail}>
          <Mail className="size-4" />
          Email
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
