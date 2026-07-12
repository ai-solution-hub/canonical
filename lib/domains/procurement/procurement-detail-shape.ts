import type {
  ProcurementMetadata,
  ProcurementWorkflowState,
  TenderDocument,
} from '@/types/procurement';

/**
 * ID-130 {130.13} legacy adapter, REBUILT for ID-145 {145.18} (BI-1..5,
 * 13..19) — the form-first re-architecture.
 *
 * Post-W1 (TECH.md §2 M3), `form_instances` IS the procurement item: there is
 * no more workspace umbrella wrapping many child forms, and no more
 * `procurement_workspaces` roll-up. Every lifecycle fact — state, deadline,
 * outcome, questions — is read DIRECTLY off the top-level GET response, which
 * mirrors the `form_instances` row (BI-1). The two-axis split is exposed as
 * two independent read functions that must never be collapsed into one
 * signal: `deriveProcessingStatus` (the upload/analyse/fill pipeline) and
 * `deriveProcurementStatus` (the 10-state procurement workflow, BI-18). No
 * fact is read from a workspace `domain_metadata` blob.
 *
 * LEGACY (pre-{145.18}) exports below — `getPrimaryForm`, `getProcurementForms`,
 * `getProcurementRollup`, `ProcurementFormSummary`, `ProcurementRollup` — are
 * kept UNCHANGED. `procurement-forms-card.tsx` (the BI-4 forms-sub-collection
 * card) still imports them; that card's removal is {145.19}'s file-ownership
 * boundary, not this Subtask's (`app/procurement/[id]/page.tsx` — mine — no
 * longer renders it, per BI-4 "no forms-sub-collection surface"). These
 * legacy helpers are dead on the item page itself and safe to delete once
 * {145.19} lands.
 */

/** A child form row as returned by GET (`FORM_LIST_COLUMNS` in the route). LEGACY — {145.19} to remove alongside the forms-card. */
export interface ProcurementFormSummary {
  id: string;
  form_type: string | null;
  name: string | null;
  workflow_state: string;
  outcome: string | null;
  outcome_notes: string | null;
  deadline: string | null;
  submission_date: string | null;
  issuing_organisation: string | null;
  outcome_recorded_at: string | null;
  outcome_recorded_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The materialised workspace roll-up (`procurement_workspaces`), B-7/AD-2. LEGACY — the table itself is dropped by W1e; {145.19} to remove alongside the forms-card. */
export interface ProcurementRollup {
  nearest_deadline: string | null;
  overall_outcome: string | null;
  counts_toward_win_rate: boolean | null;
  rollup_updated_at: string | null;
}

/**
 * The `GET /api/procurement/[id]` response shape. ID-145 {145.18}: post-W1
 * the item is a flat `form_instances` row — `form_type`, `processing_status`,
 * `workflow_state`, `deadline`, ... sit at the top level, alongside the
 * enrichments (`tender_documents`, `question_stats`, `warnings`) that were
 * already independent reads. `forms` / `rollup` / `status` / `domain_metadata`
 * are the pre-{145.18} legacy nested shape, kept optional so the retained
 * legacy getters above keep compiling — the {145.18} derivations below never
 * read them.
 */
export interface ProcurementDetailResponse {
  id: string;
  name: string;
  description: string | null;

  // ID-145 {145.18} flat form_instances fields (BI-1) — the item IS the form.
  form_type?: string | null;
  processing_status?: string | null;
  workflow_state?: ProcurementWorkflowState | null;
  deadline?: string | null;
  submission_date?: string | null;
  issuing_organisation?: string | null;
  outcome?: string | null;
  outcome_notes?: string | null;
  outcome_recorded_at?: string | null;
  outcome_recorded_by?: string | null;
  reference_number?: string | null;
  estimated_value?: string | number | null;
  tender_documents?: TenderDocument[];
  question_stats?: unknown;
  warnings?: string[];

  // LEGACY (pre-{145.18}) — retained ONLY for the still-live forms-card getters.
  forms?: ProcurementFormSummary[];
  rollup?: ProcurementRollup | null;
  /** @deprecated pre-{130.11} umbrella status. */
  status?: ProcurementWorkflowState | null;
  /** @deprecated pre-{130.11} engagement metadata. NEVER read by the {145.18} derivations. */
  domain_metadata?: ProcurementMetadata | null;
}

/**
 * Loose shape for derivation. The helpers accept `unknown` (raw JSON, a typed
 * `ProcurementSummary`, etc.) and narrow internally, so every consumer of the
 * GET response can re-point through them without a cast.
 */
type LooseDetail = Partial<ProcurementDetailResponse> & Record<string, unknown>;

function asDetail(data: unknown): LooseDetail | null {
  return data && typeof data === 'object' ? (data as LooseDetail) : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

// ---------------------------------------------------------------------------
// LEGACY (pre-{145.18}) — forms-card only. Untouched by the {145.18} rebuild.
// ---------------------------------------------------------------------------

/**
 * The primary (v1) form of an umbrella: the earliest-created child form. The
 * GET route already orders `forms` by `created_at ASC`, so the first element is
 * the primary form. Returns `null` when the umbrella has no forms yet.
 */
export function getPrimaryForm(data: unknown): ProcurementFormSummary | null {
  const forms = asDetail(data)?.forms;
  if (Array.isArray(forms) && forms.length > 0) {
    return forms[0] as ProcurementFormSummary;
  }
  return null;
}

/** The child forms of the umbrella (empty array when none). */
export function getProcurementForms(data: unknown): ProcurementFormSummary[] {
  const forms = asDetail(data)?.forms;
  return Array.isArray(forms) ? (forms as ProcurementFormSummary[]) : [];
}

/** The materialised roll-up, or `null` when absent. */
export function getProcurementRollup(data: unknown): ProcurementRollup | null {
  return (asDetail(data)?.rollup as ProcurementRollup | undefined) ?? null;
}

// ---------------------------------------------------------------------------
// ID-145 {145.18} — form-first derivations (BI-1, BI-13..18). Source every
// fact directly off the flat GET response; never via `getPrimaryForm`, never
// via `domain_metadata`.
// ---------------------------------------------------------------------------

/**
 * The document-processing pipeline axis (upload -> analyse -> fill, BI-1).
 * Independent of `deriveProcurementStatus` — the two axes are never collapsed
 * into one signal. Returns `null` when absent or for nullish input.
 */
export function deriveProcessingStatus(data: unknown): string | null {
  const detail = asDetail(data);
  if (!detail) return null;
  return asString(detail.processing_status);
}

/**
 * The 10-state procurement workflow axis (BI-1/BI-18), read directly off the
 * form's `workflow_state` — the single home for procurement state post-W1
 * (the ex-`workspaces.status` second home is retired). Defaults to `'draft'`
 * when the item has no state yet; returns `null` only for nullish input.
 */
export function deriveProcurementStatus(
  data: unknown,
): ProcurementWorkflowState | null {
  const detail = asDetail(data);
  if (!detail) return null;
  const state = asString(detail.workflow_state) ?? 'draft';
  return state as ProcurementWorkflowState;
}

/**
 * Derive the `ProcurementMetadata` view directly off the flat form_instances
 * response (BI-1, BI-5, BI-13, BI-16) — no `domain_metadata` read, no
 * `forms[]`/`rollup` indirection. `tender_document_ids` is the one surviving
 * legacy key (BI-5), sourced from `tender_documents`. `tender_source` and
 * `notes` are dropped (no live reader, BI-5) — always `null`/`undefined`
 * here, never read from anywhere. Returns `null` for nullish input.
 */
export function deriveProcurementMetadata(
  data: unknown,
): ProcurementMetadata | null {
  const detail = asDetail(data);
  if (!detail) return null;

  const tenderDocuments = Array.isArray(detail.tender_documents)
    ? (detail.tender_documents as TenderDocument[])
    : [];
  const outcome = detail.outcome;
  const rawEstimatedValue = detail.estimated_value;

  return {
    buyer: asString(detail.issuing_organisation) ?? '',
    status: deriveProcurementStatus(detail) ?? 'draft',
    deadline: asString(detail.deadline),
    reference_number: asString(detail.reference_number),
    estimated_value:
      typeof rawEstimatedValue === 'number'
        ? String(rawEstimatedValue)
        : asString(rawEstimatedValue),
    tender_source: null,
    tender_document_ids: tenderDocuments.map((doc) => doc.path),
    submission_date: asString(detail.submission_date),
    outcome:
      outcome === 'won' || outcome === 'lost' || outcome === 'withdrawn'
        ? outcome
        : null,
    outcome_notes: asString(detail.outcome_notes),
    // BI-5 ({145.18}): the free-text engagement `notes` key (pre-{130.21}
    // `domain_metadata.notes`) has no form_instances column and no live
    // reader post-W1 — dropped, never carried as dead data.
    notes: null,
    outcome_recorded_at: asString(detail.outcome_recorded_at) ?? undefined,
    outcome_recorded_by: asString(detail.outcome_recorded_by) ?? undefined,
  };
}
