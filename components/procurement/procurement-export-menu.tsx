'use client';

import { Download, FileText, Sheet, Printer, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useProcurementExport } from '@/hooks/procurement/use-procurement-export';

interface ProcurementExportMenuProps {
  procurementId: string;
  procurementName: string;
  hasQuestions: boolean;
}

export function ProcurementExportMenu({
  procurementId,
  procurementName,
  hasQuestions,
}: ProcurementExportMenuProps) {
  const { exporting, isExporting, handleExport, handlePrint } =
    useProcurementExport({
      procurementId,
      procurementName,
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={!hasQuestions || isExporting}
          aria-label="Export responses"
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
