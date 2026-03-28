'use client';

import { useState, useCallback } from 'react';
import { toast } from 'sonner';

export type ExportFormat = 'docx' | 'xlsx';

interface UseBidExportOptions {
  bidId: string;
  bidName: string;
}

interface UseBidExportReturn {
  /** Which format is currently being exported, or null if idle */
  exporting: ExportFormat | null;
  /** True when any export is in progress */
  isExporting: boolean;
  /** Trigger an export in the given format */
  handleExport: (format: ExportFormat) => Promise<void>;
  /** Trigger the browser print dialogue */
  handlePrint: () => void;
}

/**
 * Shared hook for bid export logic — fetch, download blob,
 * sanitise filename, toast feedback, and print.
 *
 * Used by both BidExportMenu (desktop) and MobileActionMenu.
 */
export function useBidExport({
  bidId,
  bidName,
}: UseBidExportOptions): UseBidExportReturn {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const handleExport = useCallback(
    async (format: ExportFormat) => {
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
    },
    [bidId, bidName],
  );

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  return {
    exporting,
    isExporting: exporting !== null,
    handleExport,
    handlePrint,
  };
}
