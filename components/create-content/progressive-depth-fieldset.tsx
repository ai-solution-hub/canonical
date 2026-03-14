'use client';

import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

export interface ProgressiveDepthFieldsetProps {
  brief: string;
  setBrief: (value: string) => void;
  detail: string;
  setDetail: (value: string) => void;
  reference: string;
  setReference: (value: string) => void;
}

/**
 * Progressive depth fieldset for the create content form.
 * Contains brief, detail, and reference text areas.
 */
export function ProgressiveDepthFieldset({
  brief,
  setBrief,
  detail,
  setDetail,
  reference,
  setReference,
}: ProgressiveDepthFieldsetProps) {
  return (
    <fieldset className="space-y-4 rounded-lg border border-border p-4">
      <legend className="px-2 text-sm font-semibold text-muted-foreground">
        Progressive Depth (optional)
      </legend>

      <div className="space-y-2">
        <Label htmlFor="brief">Brief (executive summary)</Label>
        <Textarea
          id="brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="A brief executive summary..."
          rows={3}
          maxLength={5000}
        />
        <p className="text-xs text-muted-foreground text-right mt-1">
          {brief.length.toLocaleString()} / {(5000).toLocaleString()}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="detail">Detail (expanded explanation)</Label>
        <Textarea
          id="detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Detailed explanation..."
          rows={4}
          maxLength={50000}
        />
        <p className="text-xs text-muted-foreground text-right mt-1">
          {detail.length.toLocaleString()} / {(50000).toLocaleString()}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reference">
          Reference (technical/source detail)
        </Label>
        <Textarea
          id="reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Technical or reference detail..."
          rows={4}
          maxLength={50000}
        />
        <p className="text-xs text-muted-foreground text-right mt-1">
          {reference.length.toLocaleString()} / {(50000).toLocaleString()}
        </p>
      </div>
    </fieldset>
  );
}
