import type {
  ProcurementMetadata,
  ProcurementWorkflowState,
  TenderDocument,
} from '@/types/procurement';

/**
 * ID-130 {130.13} legacy adapter, REBUILT for ID-145 {145.18} (BI-1..5,
 * 13..19) — the form-first re-architecture. Extended for ID-145 {145.42}
 * (TECH §6 group-A GET ADD; PRODUCT §A5/§A6) with the `form_attachments`
 * read-fold + engagement sibling-rail read.
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
 * {145.42} orphan sweep: the pre-{145.18} LEGACY nested-shape getters
 * (`getPrimaryForm`, `getProcurementForms`, `getProcurementRollup`,
 * `ProcurementFormSummary`, `ProcurementRollup`) are RETIRED — their only
 * consumer, `procurement-forms-card.tsx`, was deleted in {145.41} (BI-4, "no
 * forms-sub-collection surface"). knip-confirmed zero remaining consumers
 * (test-only refs retired alongside, `__tests__/lib/procurement-detail-shape.test.ts`).
 */

/** A labelled reference/evidence (or signed form-source) attachment (§A5/§A6, {147.7} `form_attachments`). */
export interface FormAttachmentSummary {
  id: string;
  filename: string;
  storage_path: string;
  mime_type: string | null;
  file_size: number | null;
  role: 'form_source' | 'reference_evidence';
  form_instance_id: string | null;
  engagement_group_id: string | null;
  created_at: string;
}

/** A sibling form in the same engagement group (§A3/§A4 — read-only lineage, no roll-up). */
export interface EngagementSiblingForm {
  id: string;
  name: string | null;
  form_type: string | null;
  workflow_state: string | null;
  reference_number: string | null;
}

/**
 * The `GET /api/procurement/[id]` response shape. ID-145 {145.18}: post-W1
 * the item is a flat `form_instances` row — `form_type`, `processing_status`,
 * `workflow_state`, `deadline`, ... sit at the top level, alongside the
 * enrichments (`tender_documents`, `question_stats`, `warnings`) that were
 * already independent reads. {145.42} ADDs `engagement_group_id` (§A3 gate),
 * `attachments` (§A5 role split) and `engagement_siblings` (§A3 rail data).
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

  // ID-147 {145.42} additions (TECH §6 group-A GET ADD).
  /** Set only when the form belongs to an engagement group (§A3 gate). */
  engagement_group_id?: string | null;
  /** §A5 role split — folded `form_attachments` read. */
  attachments?: {
    form_source: FormAttachmentSummary[];
    reference_evidence: FormAttachmentSummary[];
  };
  /** §A3/§A4 read-only sibling lineage — empty unless `engagement_group_id` is set. */
  engagement_siblings?: EngagementSiblingForm[];
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
// ID-145 {145.18} — form-first derivations (BI-1, BI-13..18). Source every
// fact directly off the flat GET response; never via a nested container, never
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

/** §A3 gate — the engagement rail (and only the rail) shows iff this is set. */
export function deriveEngagementGroupId(data: unknown): string | null {
  const detail = asDetail(data);
  if (!detail) return null;
  return asString(detail.engagement_group_id);
}

/** §A5 FORM SOURCE group: zero-schema tender documents + any `role=form_source` attachment. */
export function deriveFormSourceAttachments(
  data: unknown,
): FormAttachmentSummary[] {
  const detail = asDetail(data);
  const rows = detail?.attachments?.form_source;
  return Array.isArray(rows) ? rows : [];
}

/** §A5 REFERENCE / EVIDENCE group. Empty array => §A8 progressive-disclosure collapse. */
export function deriveReferenceEvidenceAttachments(
  data: unknown,
): FormAttachmentSummary[] {
  const detail = asDetail(data);
  const rows = detail?.attachments?.reference_evidence;
  return Array.isArray(rows) ? rows : [];
}

/** §A3/§A4 read-only sibling lineage. */
export function deriveEngagementSiblings(
  data: unknown,
): EngagementSiblingForm[] {
  const detail = asDetail(data);
  const rows = detail?.engagement_siblings;
  return Array.isArray(rows) ? rows : [];
}
