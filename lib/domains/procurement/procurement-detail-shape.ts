import type {
  ProcurementMetadata,
  ProcurementWorkflowState,
  TenderDocument,
} from '@/types/procurement';

/**
 * ID-130 {130.13} — adapter for the umbrella detail read-shape.
 *
 * {130.11} re-anchored `GET /api/procurement/[id]`: the per-stage engagement
 * facts no longer live on `workspaces.domain_metadata`/`workspaces.status`. The
 * response is now the workspace identity + a materialised `rollup`
 * (`procurement_workspaces`) + a `forms` list (the child `form_templates`
 * rows). Consumers that previously read `bid.status` / `bid.domain_metadata`
 * re-point through these helpers.
 *
 * The model is a workspace umbrella holding MANY forms (B-1); v1 is the
 * common single-form case, so the legacy umbrella-level `status`/`metadata`
 * surface is derived from the FIRST (earliest-created) form. The helpers also
 * tolerate the pre-{130.11} legacy shape (`status`/`domain_metadata` present,
 * no `forms`) so a graceful-migration read never throws — the new shape is
 * always preferred when present.
 */

/** A child form row as returned by GET (`FORM_LIST_COLUMNS` in the route). */
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

/** The materialised workspace roll-up (`procurement_workspaces`), B-7/AD-2. */
export interface ProcurementRollup {
  nearest_deadline: string | null;
  overall_outcome: string | null;
  counts_toward_win_rate: boolean | null;
  rollup_updated_at: string | null;
}

/**
 * The umbrella detail response shape after the {130.11} re-anchor. Legacy
 * `status`/`domain_metadata` are typed optional for graceful-migration reads.
 */
export interface ProcurementDetailResponse {
  id: string;
  name: string;
  description: string | null;
  forms?: ProcurementFormSummary[];
  rollup?: ProcurementRollup | null;
  tender_documents?: TenderDocument[];
  question_stats?: unknown;
  warnings?: string[];
  /** @deprecated pre-{130.11} umbrella status — derived from forms now. */
  status?: ProcurementWorkflowState | null;
  /** @deprecated pre-{130.11} engagement metadata — moved to the form. */
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

/**
 * Derive the umbrella workflow state from the primary form's `workflow_state`
 * (B-8). Falls back to the deprecated umbrella `status`, then `'draft'`.
 * Returns `null` only when there is no data at all.
 */
export function deriveProcurementStatus(
  data: unknown,
): ProcurementWorkflowState | null {
  const detail = asDetail(data);
  if (!detail) return null;
  const primary = getPrimaryForm(detail);
  const state = primary?.workflow_state ?? detail.status ?? 'draft';
  return state as ProcurementWorkflowState;
}

/**
 * Derive the legacy `ProcurementMetadata` view from the new read-shape so the
 * existing detail surfaces keep rendering. The per-stage facts come from the
 * primary form (B-2); `deadline` falls back to the roll-up's nearest deadline
 * (B-7). When the new shape is absent, the deprecated `domain_metadata` is
 * returned verbatim (graceful-migration read).
 *
 * NOTE: `reference_number` / `estimated_value` / `notes` were residual
 * `domain_metadata`-only fields with no form home; the {130.11} GET no longer
 * surfaces them, so they derive as `null` here (a known degradation, tracked
 * for follow-up). Returns `null` when there is no data.
 */
export function deriveProcurementMetadata(
  data: unknown,
): ProcurementMetadata | null {
  const detail = asDetail(data);
  if (!detail) return null;
  const primary = getPrimaryForm(detail);
  if (!primary) {
    // Legacy shape (pre-{130.11}) — return the engagement metadata verbatim.
    return (detail.domain_metadata as ProcurementMetadata | undefined) ?? null;
  }

  const tenderDocuments = Array.isArray(detail.tender_documents)
    ? (detail.tender_documents as TenderDocument[])
    : [];
  const outcome = primary.outcome;

  return {
    buyer: primary.issuing_organisation ?? '',
    status: deriveProcurementStatus(detail) ?? 'draft',
    deadline: primary.deadline ?? detail.rollup?.nearest_deadline ?? null,
    reference_number: null,
    estimated_value: null,
    tender_source: null,
    tender_document_ids: tenderDocuments.map((doc) => doc.path),
    submission_date: primary.submission_date ?? null,
    outcome:
      outcome === 'won' || outcome === 'lost' || outcome === 'withdrawn'
        ? outcome
        : null,
    outcome_notes: primary.outcome_notes ?? null,
    notes: null,
    outcome_recorded_at: primary.outcome_recorded_at ?? undefined,
    outcome_recorded_by: primary.outcome_recorded_by ?? undefined,
  };
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
