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
  /** Validation error for brief field */
  briefError?: string;
  /** Validation error for detail field */
  detailError?: string;
  /** Validation error for reference field */
  referenceError?: string;
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
  briefError,
  detailError,
  referenceError,
}: ProgressiveDepthFieldsetProps) {
  return (
    <fieldset className="space-y-4 rounded-lg border p-4">
      <legend className="px-2 text-sm font-semibold text-muted-foreground">
        Content depth (optional)
      </legend>

      <div className="space-y-2">
        <Label htmlFor="brief">Summary (executive summary)</Label>
        <Textarea
          id="brief"
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="A brief executive summary..."
          rows={3}
          maxLength={5000}
          aria-invalid={!!briefError || undefined}
          aria-describedby={briefError ? 'brief-error' : undefined}
          className={briefError ? 'border-destructive' : ''}
        />
        {briefError && (
          <p id="brief-error" className="text-destructive text-sm" role="alert">
            {briefError}
          </p>
        )}
        <p className="text-xs text-muted-foreground text-right mt-1">
          {brief.length.toLocaleString()} / {(5000).toLocaleString()}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="detail">In Depth (expanded explanation)</Label>
        <Textarea
          id="detail"
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Detailed explanation..."
          rows={4}
          maxLength={50000}
          aria-invalid={!!detailError || undefined}
          aria-describedby={detailError ? 'detail-error' : undefined}
          className={detailError ? 'border-destructive' : ''}
        />
        {detailError && (
          <p id="detail-error" className="text-destructive text-sm" role="alert">
            {detailError}
          </p>
        )}
        <p className="text-xs text-muted-foreground text-right mt-1">
          {detail.length.toLocaleString()} / {(50000).toLocaleString()}
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="reference">
          Supporting Detail (technical/source detail)
        </Label>
        <Textarea
          id="reference"
          value={reference}
          onChange={(e) => setReference(e.target.value)}
          placeholder="Technical or reference detail..."
          rows={4}
          maxLength={50000}
          aria-invalid={!!referenceError || undefined}
          aria-describedby={referenceError ? 'reference-error' : undefined}
          className={referenceError ? 'border-destructive' : ''}
        />
        {referenceError && (
          <p id="reference-error" className="text-destructive text-sm" role="alert">
            {referenceError}
          </p>
        )}
        <p className="text-xs text-muted-foreground text-right mt-1">
          {reference.length.toLocaleString()} / {(50000).toLocaleString()}
        </p>
      </div>
    </fieldset>
  );
}
