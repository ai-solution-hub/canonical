'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  return new Date().toISOString().slice(0, 10);
}

function sanitizeDateInput(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
}

export default function ExportAuditPdfButton() {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function handleExport() {
    const safeFrom = sanitizeDateInput(from);
    const safeTo = sanitizeDateInput(to);

    if (!safeFrom || !safeTo) {
      toast.error('Please select valid dates before exporting');
      return;
    }

    const params = new URLSearchParams({ from: safeFrom, to: safeTo });
    const url = `/api/admin/provenance/export/verification-history?${params.toString()}`;
    // Use an anchor to let the browser handle the download
    const a = document.createElement('a');
    a.href = url;
    a.download = `verification-history-${safeFrom}-to-${safeTo}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success('Export started \u2014 check your downloads');
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <Label htmlFor="export-from" className="text-xs">
          From
        </Label>
        <Input
          id="export-from"
          type="date"
          value={from}
          onChange={(e) => setFrom(sanitizeDateInput(e.target.value))}
          className="h-8 w-[150px] text-xs"
        />
      </div>

      <div className="flex flex-col gap-1">
        <Label htmlFor="export-to" className="text-xs">
          To
        </Label>
        <Input
          id="export-to"
          type="date"
          value={to}
          onChange={(e) => setTo(sanitizeDateInput(e.target.value))}
          className="h-8 w-[150px] text-xs"
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={handleExport}
        className="h-8 gap-1.5 text-xs"
      >
        <Download className="size-3.5" />
        Export PDF
      </Button>
    </div>
  );
}
