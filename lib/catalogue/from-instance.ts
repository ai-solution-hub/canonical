/**
 * Path C — catalogue-from-instance helpers (TECH §2.7, PRODUCT Inv-20..Inv-25).
 *
 * The human-confirmed cataloguing path. An ingested form instance
 * (`form_templates` + its `form_template_fields`) is read, each field is
 * classified by Anthropic into a catalogue-requirement shape (requirement
 * type + matching keywords + matching guidance), embedded, presented for
 * explicit per-row confirmation, and — only on confirmation by an authorised
 * caller — written to the global `form_template_requirements` catalogue.
 *
 * Invariant map:
 * - Inv-20: ingest never auto-writes the catalogue; cataloguing happens only
 *   through this path. (This module is never called from the pipeline flow.)
 * - Inv-21: the catalogue is authored through a human-confirmed step. No row
 *   is written unless the injected `confirmRow` callback returns `true`.
 * - Inv-22: each catalogue row carries the read shape T10 consumes
 *   (`requirement_type`, `matching_keywords`, `matching_guidance`,
 *   `requirement_embedding`, `is_mandatory`, `section_name`, `template_type`).
 * - Inv-23: catalogue rows have NO `workspace_id` — they are global.
 * - Inv-24: the write step is gated to admin/editor via
 *   `getAuthorisedClient(['admin', 'editor'])`; unauthorised callers are
 *   refused and the failure reason routed through `authFailureResponse`.
 *
 * Direct file imports only — no barrels (CLAUDE.md).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type Anthropic from '@anthropic-ai/sdk';
import type { Database, Tables } from '@/supabase/types/database.types';
import {
  getAuthorisedClient,
  authFailureResponse,
  type AuthorisedResult,
} from '@/lib/auth';
import { tryQuery, type Result } from '@/lib/supabase/safe';
import { logger } from '@/lib/logger';

// ── Constants ────────────────────────────────────────────────────────────

/** Anthropic classification model — same as the pipeline (extraction.py). */
export const CLASSIFY_MODEL = 'claude-opus-4-6';

/** Embedding config — same as pipeline Stage-4 / catalogue-standard-sq.ts. */
export const EMBEDDING_MODEL = 'text-embedding-3-large';
export const EMBEDDING_DIMENSIONS = 1024;

/**
 * The CHECK-constrained `requirement_type` value set. Plain strings on the
 * row (the column is `string`), but the classifier must choose one of these.
 */
export const REQUIREMENT_TYPES = [
  'policy',
  'statement',
  'evidence',
  'data',
  'narrative',
  'declaration',
  'reference',
] as const;

export type RequirementType = (typeof REQUIREMENT_TYPES)[number];

// ── Types ────────────────────────────────────────────────────────────────

export type FormTemplateField = Tables<'form_template_fields'>;
export type FormTemplate = Tables<'form_templates'>;
export type CatalogueRowInsert =
  Database['public']['Tables']['form_template_requirements']['Insert'];

/** The Anthropic-produced classification for one instance field. */
export interface FieldClassification {
  requirement_type: RequirementType;
  matching_keywords: string[];
  matching_guidance: string | null;
}

/**
 * Result of the write step. `refused` distinguishes the auth-gate refusal
 * (Inv-24 — write step never ran) from a partial write where some rows were
 * declined at confirmation (Inv-21) or failed to insert.
 */
export interface CatalogueWriteResult {
  refused: boolean;
  refusalReason?: string;
  refusalStatus?: number;
  written: number;
  declined: number;
  failed: number;
  errors: string[];
}

// ── Prompt (TS replica of scripts/cocoindex_pipeline/prompts.py Q_A_FORM
//    pattern, extended for per-field catalogue classification — NOT an import) ──

/**
 * Build the classification prompt for a single instance field. Replicates the
 * `Q_A_FORM_PROMPT` style (verbatim-text, strict JSON, no commentary) and
 * extends it with the catalogue-requirement classification fields T10 needs.
 */
export function buildClassificationPrompt(field: FormTemplateField): string {
  const types = REQUIREMENT_TYPES.join(', ');
  return `You are cataloguing a single question from a procurement form, questionnaire, or sales-proposal template into a reusable, global requirement record for an enterprise knowledge base. Read the question and produce a single JSON object classifying it.

OUTPUT FORMAT
Return ONLY a single JSON object — no markdown fences, no commentary, no preamble. The JSON object MUST have exactly these fields:

  {
    "requirement_type": <one of: ${types}>,
    "matching_keywords": [<list of 3-8 short keyword phrases a matcher would use to find knowledge-base content answering this requirement>],
    "matching_guidance": <one sentence of guidance for a matcher, OR null>
  }

FIELD CONSTRAINTS
- requirement_type: MUST be EXACTLY ONE of: ${types}.
  - "data": a factual datum (company number, turnover figure, dates, names).
  - "declaration": a yes/no or confirmatory statement.
  - "policy": asks for a written policy or procedure.
  - "evidence": asks for an attached document or certificate.
  - "narrative": asks for prose describing an approach.
  - "statement": a short attestation that is neither pure data nor a formal declaration.
  - "reference": asks for a contract/customer/case-study reference.
- matching_keywords: non-empty list of short phrases (no full sentences).
- matching_guidance: a single sentence, OR null when no special guidance applies.

QUESTION TO CLASSIFY
Section: ${field.section_name ?? '(none)'}
Field type: ${field.field_type}
Mandatory: ${field.is_mandatory ? 'yes' : 'no'}
Question text: ${field.question_text ?? '(empty)'}`;
}

// ── Read step (read-only) ──────────────────────────────────────────────────

/**
 * Read the `form_template_fields` rows for a form instance, ordered by
 * sequence. Read-only — never mutates instance state. Returns a `Result` so
 * the caller branches on `ok` before reading data (no silent failures).
 */
export async function readInstanceFields(
  supabase: SupabaseClient<Database>,
  formTemplateId: string,
): Promise<Result<FormTemplateField[]>> {
  return tryQuery<FormTemplateField[]>(
    supabase
      .from('form_template_fields')
      .select('*')
      .eq('template_id', formTemplateId)
      .order('sequence', { ascending: true }),
    'form_template_fields.byTemplate',
  );
}

// ── Classify step (Anthropic) ───────────────────────────────────────────────

/**
 * Extract the first JSON object from a model text response. The prompt asks
 * for raw JSON, but defensively strip any accidental markdown fence.
 */
export function parseClassificationJson(raw: string): FieldClassification {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '');
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      `Classification response is not JSON: ${raw.slice(0, 120)}`,
    );
  }
  const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<
    string,
    unknown
  >;

  const requirementType = parsed.requirement_type;
  if (
    typeof requirementType !== 'string' ||
    !REQUIREMENT_TYPES.includes(requirementType as RequirementType)
  ) {
    throw new Error(
      `Classification returned invalid requirement_type: ${String(requirementType)}`,
    );
  }

  const keywords = Array.isArray(parsed.matching_keywords)
    ? parsed.matching_keywords.filter(
        (k): k is string => typeof k === 'string' && k.length > 0,
      )
    : [];
  if (keywords.length === 0) {
    throw new Error('Classification returned empty matching_keywords');
  }

  const guidance =
    typeof parsed.matching_guidance === 'string' &&
    parsed.matching_guidance.length > 0
      ? parsed.matching_guidance
      : null;

  return {
    requirement_type: requirementType as RequirementType,
    matching_keywords: keywords,
    matching_guidance: guidance,
  };
}

/**
 * Classify one instance field into a catalogue-requirement classification via
 * Anthropic. The Anthropic client is injected so it can be mocked at the SDK
 * boundary in tests.
 */
export async function classifyField(
  anthropic: Pick<Anthropic, 'messages'>,
  field: FormTemplateField,
): Promise<FieldClassification> {
  const message = await anthropic.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: buildClassificationPrompt(field) }],
  });

  const textBlock = message.content.find(
    (block): block is Anthropic.Messages.TextBlock => block.type === 'text',
  );
  if (!textBlock) {
    throw new Error('Classification response contained no text block');
  }
  return parseClassificationJson(textBlock.text);
}

// ── Embed step (OpenAI text-embedding-3-large, dimensions 1024) ─────────────

/**
 * Generate the `requirement_embedding` for a requirement. Same model and
 * dimensions as pipeline Stage-4 and `scripts/catalogue-standard-sq.ts` so the
 * catalogue is consistent with T10's read shape. The `fetchImpl` parameter is
 * injected for testability; defaults to the global `fetch`.
 */
export async function generateRequirementEmbedding(
  text: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const response = await fetchImpl('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(
      `OpenAI embedding API error: ${response.status} — ${errBody}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

// ── Build the catalogue row (Inv-22 read shape; Inv-23 no workspace_id) ─────

/**
 * Assemble the `form_template_requirements` insert row from a classified
 * instance field. Carries the Inv-22 read shape and — by construction — NO
 * `workspace_id` (Inv-23: the catalogue is global). The vector is serialised
 * via `JSON.stringify` per CLAUDE.md before it reaches the Supabase param.
 */
export function buildCatalogueRow(args: {
  field: FormTemplateField;
  classification: FieldClassification;
  embedding: number[] | null;
  templateName: string;
  templateType: string;
  templateVersion?: string | null;
}): CatalogueRowInsert {
  const { field, classification, embedding, templateName, templateType } = args;
  return {
    template_name: templateName,
    template_type: templateType,
    template_version: args.templateVersion ?? null,
    section_ref: field.section_name ?? 'General',
    section_name: field.section_name ?? 'General',
    question_number: field.sequence,
    requirement_text: field.question_text ?? '',
    description: null,
    requirement_type: classification.requirement_type,
    matching_keywords: classification.matching_keywords,
    matching_guidance: classification.matching_guidance,
    is_mandatory: field.is_mandatory ?? false,
    word_limit_guidance: field.word_limit ?? null,
    requirement_embedding: embedding ? JSON.stringify(embedding) : null,
    display_order: field.sequence,
    is_current: true,
  };
}

// ── Auth gate (Inv-24) ──────────────────────────────────────────────────────

export interface AuthGateOutcome {
  authorised: boolean;
  /** Set on failure — the reason routed through `authFailureResponse`. */
  reason?: string;
  /** Set on failure — the HTTP status `authFailureResponse` maps the reason to. */
  status?: number;
}

/**
 * Enforce the Inv-24 auth gate before any write. Uses the injected
 * `getAuthorisedClient` (defaults to the real one) so tests can simulate a
 * viewer-role / unauthenticated caller. On failure, the reason is routed
 * through `authFailureResponse` to derive the correct HTTP status, the failure
 * is logged, and the write step is REFUSED.
 */
export async function ensureAuthorisedForWrite(
  getAuthorised: (
    roles: ('admin' | 'editor' | 'viewer')[],
  ) => Promise<AuthorisedResult> = getAuthorisedClient,
): Promise<AuthGateOutcome> {
  const auth = await getAuthorised(['admin', 'editor']);
  if (!auth.success) {
    const response = authFailureResponse(auth);
    logger.error(
      { reason: auth.reason, status: response.status },
      '[catalogue:from-instance] write step refused — auth gate failed',
    );
    return { authorised: false, reason: auth.reason, status: response.status };
  }
  return { authorised: true };
}

// ── Confirm + write step (Inv-21 confirmation gate, Inv-24 auth gate) ───────

export interface ConfirmAndWriteArgs {
  supabase: SupabaseClient<Database>;
  rows: CatalogueRowInsert[];
  /**
   * Per-row confirmation. Returns `true` to write the row. No row is written
   * unless this returns `true` (Inv-21). The CLI wires this to a stdin y/n
   * prompt; tests inject a deterministic predicate.
   */
  confirmRow: (row: CatalogueRowInsert, index: number) => Promise<boolean>;
  /** Auth-gate dependency injection for tests; defaults to the real helper. */
  getAuthorised?: (
    roles: ('admin' | 'editor' | 'viewer')[],
  ) => Promise<AuthorisedResult>;
}

/**
 * The human-confirmed catalogue write. Enforces the auth gate FIRST (Inv-24):
 * if the caller is not admin/editor, NO row is written and the whole step is
 * refused. Then, per row, the `confirmRow` callback must return `true`
 * (Inv-21) before the row is inserted via `tryQuery()` (no silent Supabase
 * failures). Each insert is its own statement; a failed row is recorded and
 * the remaining rows continue.
 */
export async function confirmAndWriteCatalogue(
  args: ConfirmAndWriteArgs,
): Promise<CatalogueWriteResult> {
  const { supabase, rows, confirmRow, getAuthorised } = args;

  const gate = await ensureAuthorisedForWrite(getAuthorised);
  if (!gate.authorised) {
    return {
      refused: true,
      refusalReason: gate.reason,
      refusalStatus: gate.status,
      written: 0,
      declined: 0,
      failed: 0,
      errors: [],
    };
  }

  let written = 0;
  let declined = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const confirmed = await confirmRow(row, i);
    if (!confirmed) {
      declined += 1;
      continue;
    }

    const insertResult = await tryQuery(
      supabase.from('form_template_requirements').insert(row),
      'form_template_requirements.insert',
    );
    if (!insertResult.ok) {
      failed += 1;
      errors.push(insertResult.error.message);
      logger.error(
        { err: insertResult.error, requirement: row.requirement_text },
        '[catalogue:from-instance] row insert failed',
      );
      continue;
    }
    written += 1;
  }

  return { refused: false, written, declined, failed, errors };
}
