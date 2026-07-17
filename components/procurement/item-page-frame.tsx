'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Building2,
  Calendar,
  Hash,
  PoundSterling,
} from 'lucide-react';

/**
 * The §A custom domain frame (ID-145 {145.42}, TECH §6 group-A GET ADD;
 * PRODUCT §A1-A4). NOT Extend's File System / Finder (DR-068, §A2) — a
 * custom header + optional read-only engagement sibling rail. Tab content
 * (Documents/Questions/Overview) is composed by the caller via `children`;
 * this component owns ONLY the header identity block and the rail slot.
 *
 * §A1 — the header carries the form's identity: name, current workflow
 * state, issuing_organisation, deadline, reference_number, estimated_value.
 * `stateBadge`/`deadlineProximityBadge`/`actions` are slots rather than
 * this component reaching into `procurement-workflow-indicator.tsx` /
 * `procurement-helpers.ts` itself — the caller (page.tsx) already owns that
 * logic and its existing test coverage; the frame only lays them out.
 *
 * §A3/§A8 — `groupingRail` is rendered ONLY when the caller supplies it.
 * page.tsx passes `undefined` for an ungrouped form (no engagement_group_id)
 * so an ungrouped item never mounts the rail region at all — the
 * progressive-disclosure default is "nothing here", not an empty rail shell.
 */
export interface ItemPageFrameProps {
  backHref: string;
  backLabel?: string;
  name: string;
  /** Slot for the workflow-state badge (e.g. `<ProcurementWorkflowBadge/>`). */
  stateBadge?: ReactNode;
  issuingOrganisation?: string | null;
  /** Pre-formatted (UK) deadline text — the frame does no date formatting itself. */
  deadlineLabel?: string | null;
  /** Slot for a deadline-proximity indicator (e.g. "Overdue" / "3 days left"). */
  deadlineProximityBadge?: ReactNode;
  referenceNumber?: string | null;
  /** Pre-formatted estimated value text (no currency formatting is applied here). */
  estimatedValue?: string | number | null;
  /** Slot for the page-level action toolbar (transitions, export, delete, …). */
  actions?: ReactNode;
  /** §A3 read-only sibling-forms rail — omit/undefined when ungrouped (§A8). */
  groupingRail?: ReactNode;
  children: ReactNode;
}

export function ItemPageFrame({
  backHref,
  backLabel = 'Back to Procurement',
  name,
  stateBadge,
  issuingOrganisation,
  deadlineLabel,
  deadlineProximityBadge,
  referenceNumber,
  estimatedValue,
  actions,
  groupingRail,
  children,
}: ItemPageFrameProps) {
  const hasEstimatedValue =
    estimatedValue !== null &&
    estimatedValue !== undefined &&
    estimatedValue !== '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {backLabel}
      </Link>

      {/* §A1 — form-as-page header */}
      <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{name}</h1>
            {stateBadge}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            {issuingOrganisation && (
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="size-3.5" aria-hidden="true" />
                {issuingOrganisation}
              </span>
            )}
            {deadlineLabel && (
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="size-3.5" aria-hidden="true" />
                {deadlineLabel}
                {deadlineProximityBadge}
              </span>
            )}
            {referenceNumber && (
              <span className="inline-flex items-center gap-1.5">
                <Hash className="size-3.5" aria-hidden="true" />
                {referenceNumber}
              </span>
            )}
            {hasEstimatedValue && (
              <span className="inline-flex items-center gap-1.5">
                <PoundSterling className="size-3.5" aria-hidden="true" />
                {estimatedValue}
              </span>
            )}
          </div>
        </div>

        {actions && <div>{actions}</div>}
      </div>

      {/* §A3 — engagement sibling rail, present only when grouped (§A8). */}
      {groupingRail && (
        <div className="mt-4" data-testid="item-page-frame-grouping-rail">
          {groupingRail}
        </div>
      )}

      {children}
    </div>
  );
}
