/**
 * Procurement-related formatters for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';
import { htmlToMarkdown } from '@/lib/content/html-to-markdown';
import { truncate, formatProgress } from './shared';

// ---------------------------------------------------------------------------
// Procurement detail
// ---------------------------------------------------------------------------

/** Individual question summary within a bid detail view */
export interface ProcurementQuestionSummary {
  id: string;
  question_text: string;
  status: string;
  confidence_posture: string | null;
  word_limit: number | null;
  has_response: boolean;
  review_status: string | null;
}

/** A section grouping questions within a bid */
export interface ProcurementSection {
  name: string;
  questions: ProcurementQuestionSummary[];
}

export interface ProcurementDetail {
  id: string;
  name: string;
  buyer: string | null;
  status: string;
  deadline: string | null;
  reference_number: string | null;
  description: string | null;
  question_stats: {
    total_questions: number;
    strong_match_count: number;
    partial_match_count: number;
    needs_sme_count: number;
    no_content_count: number;
    unmatched_count: number;
    drafted_count: number;
    complete_count: number;
  } | null;
  sections: ProcurementSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}

export function formatProcurementDetail(bid: ProcurementDetail): string {
  const lines: string[] = [`# ${bid.name}`, '', `**Status:** ${bid.status}`];

  if (bid.buyer) lines.push(`**Buyer:** ${bid.buyer}`);
  if (bid.reference_number)
    lines.push(`**Reference:** ${bid.reference_number}`);
  if (bid.deadline) lines.push(`**Deadline:** ${formatDateUK(bid.deadline)}`);
  if (bid.description) lines.push('', bid.description);

  lines.push(`**ID:** ${bid.id}`);

  if (bid.question_stats) {
    const qs = bid.question_stats;
    const answered = qs.drafted_count + qs.complete_count;
    lines.push('', '## Question Progress', '');
    lines.push(`- **Total questions:** ${qs.total_questions}`);
    lines.push(
      `- **Answered:** ${answered} (${formatProgress(answered, qs.total_questions)})`,
    );
    lines.push(`- **Approved:** ${qs.complete_count}`);
    lines.push(`- **Strong KB match:** ${qs.strong_match_count}`);
    lines.push(`- **Partial match:** ${qs.partial_match_count}`);
    lines.push(`- **Needs SME:** ${qs.needs_sme_count}`);
    lines.push(`- **No content:** ${qs.no_content_count}`);
  }

  if (bid.sections && bid.sections.length > 0) {
    lines.push('', '## Questions by Section', '');
    for (const section of bid.sections) {
      lines.push(
        `### ${section.name} (${section.questions.length} questions)`,
        '',
      );
      for (const q of section.questions) {
        const statusIcon = q.has_response ? '\u2705' : '\u2B1C';
        const confidence = q.confidence_posture
          ? ` [${q.confidence_posture.replace(/_/g, ' ')}]`
          : '';
        const truncatedText =
          q.question_text.length > 100
            ? q.question_text.slice(0, 97) + '...'
            : q.question_text;
        lines.push(
          `- ${statusIcon} ${truncatedText}${confidence} (ID: ${q.id})`,
        );
      }
      lines.push('');
    }
  }

  if (bid.status_breakdown && Object.keys(bid.status_breakdown).length > 0) {
    lines.push('## Status Breakdown', '');
    for (const [status, count] of Object.entries(bid.status_breakdown)) {
      lines.push(`- **${status.replace(/_/g, ' ')}:** ${count}`);
    }
  }

  if (
    bid.confidence_breakdown &&
    Object.keys(bid.confidence_breakdown).length > 0
  ) {
    lines.push('', '## Confidence Breakdown', '');
    for (const [posture, count] of Object.entries(bid.confidence_breakdown)) {
      lines.push(`- **${posture.replace(/_/g, ' ')}:** ${count}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Procurement question
// ---------------------------------------------------------------------------

export interface ProcurementQuestionDetail {
  id: string;
  question_text: string;
  section_name: string | null;
  word_limit: number | null;
  confidence_posture: string | null;
  status: string | null;
  response_text: string | null;
  review_status: string | null;
}

export function formatProcurementQuestion(
  q: ProcurementQuestionDetail,
): string {
  const lines: string[] = [
    '# Procurement Question',
    '',
    `**Question:** ${q.question_text}`,
  ];

  if (q.section_name) lines.push(`**Section:** ${q.section_name}`);
  if (q.word_limit) lines.push(`**Word limit:** ${q.word_limit}`);
  if (q.confidence_posture)
    lines.push(`**Confidence:** ${q.confidence_posture}`);
  if (q.status) lines.push(`**Status:** ${q.status}`);
  if (q.review_status) lines.push(`**Review status:** ${q.review_status}`);
  lines.push(`**ID:** ${q.id}`);

  if (q.response_text) {
    lines.push(
      '',
      '## Response',
      '',
      truncate(htmlToMarkdown(q.response_text), 3000),
    );
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Citation confirmation
// ---------------------------------------------------------------------------

export interface CitationResult {
  id: string;
  cited_kind: string;
  // ID-131.19 (M6, S450 GO tail): `cited_content_item_id` + the
  // `content_item` CHECK branch were DROPPED from `citations` at M6 — the
  // production writer (app/api/procurement/[id]/responses/draft-stream/
  // route.ts, {131.16} BI-29) had already stopped writing cited_kind=
  // 'content_item' rows before the column drop, targeting q_a_pair/
  // reference_item exclusively. No `cited_content_item_id` field here
  // anymore; `resolveCitedTarget` below falls back to a "retired" label for
  // any pre-M6 legacy row that still carries cited_kind='content_item' (the
  // enum label survives per the M6 migration's own note — dropping an enum
  // value is not a cheap ALTER TYPE — but it has no renderable target left).
  //
  // ID-131.28 (G-CITE-READERS) — the extended cited_target_kind contract
  // ({131.10} M4b) added three more per-kind target columns. Exactly one of
  // the four is populated per row per the DB's cited_one_of CHECK
  // constraint; cited_kind says which.
  cited_q_a_pair_id: string | null;
  cited_reference_item_id: string | null;
  cited_source_document_id: string | null;
  cited_concept_path: string | null;
  citing_kind: string;
  citing_form_response_id: string | null;
  citation_type: string;
  cited_version: number | null;
}

/**
 * Human-readable label + target-id pair for whichever cited_* column is
 * populated on this citation row (ID-131.28 — re-anchored off the single
 * content_item assumption to the extended 5-kind contract).
 */
function resolveCitedTarget(citation: CitationResult): {
  label: string;
  value: string | null;
} {
  switch (citation.cited_kind) {
    case 'q_a_pair':
      return { label: 'Q&A pair', value: citation.cited_q_a_pair_id };
    case 'reference_item':
      return {
        label: 'Reference item',
        value: citation.cited_reference_item_id,
      };
    case 'source_document':
      return {
        label: 'Source document',
        value: citation.cited_source_document_id,
      };
    case 'concept':
      return { label: 'Concept', value: citation.cited_concept_path };
    default:
      // 'content_item' retired at M6 (ID-131.19) — no target column survives.
      return { label: 'Content item (retired)', value: null };
  }
}

export function formatCitation(citation: CitationResult): string {
  const target = resolveCitedTarget(citation);
  return [
    '# Citation Recorded',
    '',
    `**Cited kind:** ${citation.cited_kind}`,
    `**${target.label}:** ${target.value ?? '—'}`,
    `**Citing kind:** ${citation.citing_kind}`,
    `**Procurement response:** ${citation.citing_form_response_id ?? '—'}`,
    `**Type:** ${citation.citation_type}`,
    `**Cited version:** ${citation.cited_version ?? '—'}`,
    `**ID:** ${citation.id}`,
    '',
    'The citation has been recorded successfully.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Content effectiveness (win rate)
// ---------------------------------------------------------------------------

export interface ContentEffectiveness {
  content_item_id: string;
  total_citations: number;
  winning_citations: number;
  losing_citations: number;
  pending_citations: number;
  win_rate: number;
}

export function formatContentEffectiveness(data: ContentEffectiveness): string {
  const decidedCount = data.winning_citations + data.losing_citations;
  const winPct = Math.round(data.win_rate * 100);

  const lines: string[] = [
    '# Content Effectiveness',
    '',
    `**Content item:** ${data.content_item_id}`,
    `**Total citations:** ${data.total_citations}`,
    `**Winning citations:** ${data.winning_citations}`,
    `**Losing citations:** ${data.losing_citations}`,
  ];

  if (data.pending_citations > 0) {
    lines.push(`**Pending citations:** ${data.pending_citations}`);
  }

  if (data.total_citations === 0) {
    lines.push('', 'This content has not yet been cited in any bid responses.');
  } else if (decidedCount === 0) {
    lines.push(
      '',
      `**Win rate:** Awaiting outcomes (${data.total_citations} citation${data.total_citations === 1 ? '' : 's'} in bids with no decided outcome yet)`,
    );
  } else {
    lines.push(
      `**Win rate:** ${winPct}% (${data.winning_citations} won / ${decidedCount} decided)`,
    );
    if (data.win_rate >= 0.7) {
      lines.push(
        '',
        'This content is highly effective — it is frequently associated with winning bids.',
      );
    } else if (data.win_rate >= 0.4) {
      lines.push(
        '',
        'This content has moderate effectiveness in bid outcomes.',
      );
    } else {
      lines.push(
        '',
        'This content has a low win rate — consider reviewing or updating it.',
      );
    }
  }

  return lines.join('\n');
}
