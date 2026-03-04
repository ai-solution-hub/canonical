'use client';

import { useState } from 'react';
import {
  Download,
  FileText,
  Sheet,
  Printer,
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

type ExportFormat = 'docx' | 'xlsx' | null;

interface BidExportMenuProps {
  bidId: string;
  bidName: string;
  hasQuestions: boolean;
}

export function BidExportMenu({
  bidId,
  bidName,
  hasQuestions,
}: BidExportMenuProps) {
  const [exporting, setExporting] = useState<ExportFormat>(null);

  async function handleExport(format: 'docx' | 'xlsx') {
    setExporting(format);
    try {
      const response = await fetch(`/api/bids/${bidId}/export/${format}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `Export failed (${response.status})`,
        );
      }

      // Create blob and trigger download
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const safeName = bidName
        .replace(/[^a-zA-Z0-9\s-]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase()
        .slice(0, 50);

      link.href = url;
      link.download = `${safeName}-responses.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const formatLabel = format === 'docx' ? 'Word' : 'Excel';
      toast.success(`${formatLabel} export downloaded`);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Export failed';
      toast.error(message);
    } finally {
      setExporting(null);
    }
  }

  function handlePrint() {
    window.print();
  }

  const isExporting = exporting !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!hasQuestions || isExporting}
          aria-label="Export bid responses"
          data-no-print
        >
          {isExporting ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="size-3.5" aria-hidden="true" />
          )}
          Export
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem
          onClick={() => handleExport('docx')}
          disabled={isExporting}
        >
          {exporting === 'docx' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <FileText className="size-4" aria-hidden="true" />
          )}
          Word (.docx)
        </DropdownMenuItem>

        <DropdownMenuItem
          onClick={() => handleExport('xlsx')}
          disabled={isExporting}
        >
          {exporting === 'xlsx' ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Sheet className="size-4" aria-hidden="true" />
          )}
          Excel (.xlsx)
        </DropdownMenuItem>

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={handlePrint} disabled={isExporting}>
          <Printer className="size-4" aria-hidden="true" />
          Print / Save as PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
