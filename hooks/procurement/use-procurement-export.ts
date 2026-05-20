'use client';

import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

/** @public */
export type ExportFormat = 'docx' | 'xlsx';

interface UseBidExportOptions {
  procurementId: string;
  procurementName: string;
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
 * Used by both ProcurementExportMenu (desktop) and MobileActionMenu.
 */
export function useBidExport({
  procurementId,
  procurementName,
}: UseBidExportOptions): UseBidExportReturn {
  const [exporting, setExporting] = useState<ExportFormat | null>(null);

  const exportMutation = useMutation({
    mutationFn: async (format: ExportFormat) => {
      const response = await fetch(
        `/api/procurement/${procurementId}/export/${format}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.error || `Export failed (${response.status})`,
        );
      }

      return { blob: await response.blob(), format };
    },
    onMutate: (format) => {
      setExporting(format);
    },
    onSuccess: ({ blob, format }) => {
      // Create blob and trigger download
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');

      const safeName = procurementName
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
    },
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'Export failed';
      toast.error(message);
    },
    onSettled: () => {
      setExporting(null);
    },
  });

  const { mutate: doExport } = exportMutation;

  const handleExport = useCallback(
    async (format: ExportFormat) => {
      doExport(format);
    },
    [doExport],
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
