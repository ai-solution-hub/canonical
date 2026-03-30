/**
 * Bid-related formatters for MCP tool responses.
 */
import { formatDateUK } from '@/lib/format';
import { truncate, formatProgress } from './shared';

// ---------------------------------------------------------------------------
// Bid detail
// ---------------------------------------------------------------------------

/** Individual question summary within a bid detail view */
export interface BidQuestionSummary {
  id: string;
  question_text: string;
  status: string;
  confidence_posture: string | null;
  word_limit: number | null;
  has_response: boolean;
  review_status: string | null;
}

/** A section grouping questions within a bid */
export interface BidSection {
  name: string;
  questions: BidQuestionSummary[];
}

export interface BidDetail {
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
  sections: BidSection[];
  status_breakdown: Record<string, number>;
  confidence_breakdown: Record<string, number>;
}

export function formatBidDetail(bid: BidDetail): string {
  const lines: string[] = [
    `# ${bid.name}`,
    '',
    `**Status:** ${bid.status}`,
  ];

  if (bid.buyer) lines.push(`**Buyer:** ${bid.buyer}`);
  if (bid.reference_number) lines.push(`**Reference:** ${bid.reference_number}`);
  if (bid.deadline) lines.push(`**Deadline:** ${formatDateUK(bid.deadline)}`);
  if (bid.description) lines.push('', bid.description);

  lines.push(`**ID:** ${bid.id}`);

  if (bid.question_stats) {
    const qs = bid.question_stats;
    const answered = qs.drafted_count + qs.complete_count;
    lines.push('', '## Question Progress', '');
    lines.push(`- **Total questions:** ${qs.total_questions}`);
    lines.push(`- **Answered:** ${answered} (${formatProgress(answered, qs.total_questions)})`);
    lines.push(`- **Approved:** ${qs.complete_count}`);
    lines.push(`- **Strong KB match:** ${qs.strong_match_count}`);
    lines.push(`- **Partial match:** ${qs.partial_match_count}`);
    lines.push(`- **Needs SME:** ${qs.needs_sme_count}`);
    lines.push(`- **No content:** ${qs.no_content_count}`);
  }

  if (bid.sections && bid.sections.length > 0) {
    lines.push('', '## Questions by Section', '');
    for (const section of bid.sections) {
      lines.push(`### ${section.name} (${section.questions.length} questions)`, '');
      for (const q of section.questions) {
        const statusIcon = q.has_response ? '\u2705' : '\u2B1C';
        const confidence = q.confidence_posture
          ? ` [${q.confidence_posture.replace(/_/g, ' ')}]`
          : '';
        const truncatedText = q.question_text.length > 100
          ? q.question_text.slice(0, 97) + '...'
          : q.question_text;
        lines.push(`- ${statusIcon} ${truncatedText}${confidence} (ID: ${q.id})`);
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

  if (bid.confidence_breakdown && Object.keys(bid.confidence_breakdown).length > 0) {
    lines.push('', '## Confidence Breakdown', '');
    for (const [posture, count] of Object.entries(bid.confidence_breakdown)) {
      lines.push(`- **${posture.replace(/_/g, ' ')}:** ${count}`);
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Bid question
// ---------------------------------------------------------------------------

export interface BidQuestionDetail {
  id: string;
  question_text: string;
  section_name: string | null;
  word_limit: number | null;
  confidence_posture: string | null;
  status: string | null;
  response_text: string | null;
  review_status: string | null;
}

export function formatBidQuestion(q: BidQuestionDetail): string {
  const lines: string[] = [
    '# Bid Question',
    '',
    `**Question:** ${q.question_text}`,
  ];

  if (q.section_name) lines.push(`**Section:** ${q.section_name}`);
  if (q.word_limit) lines.push(`**Word limit:** ${q.word_limit}`);
  if (q.confidence_posture) lines.push(`**Confidence:** ${q.confidence_posture}`);
  if (q.status) lines.push(`**Status:** ${q.status}`);
  if (q.review_status) lines.push(`**Review status:** ${q.review_status}`);
  lines.push(`**ID:** ${q.id}`);

  if (q.response_text) {
    lines.push('', '## Response', '', truncate(q.response_text, 3000));
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Citation confirmation
// ---------------------------------------------------------------------------

export interface CitationResult {
  id: string;
  content_item_id: string;
  bid_response_id: string;
  citation_type: string;
}

export function formatCitation(citation: CitationResult): string {
  return [
    '# Citation Recorded',
    '',
    `**Content item:** ${citation.content_item_id}`,
    `**Bid response:** ${citation.bid_response_id}`,
    `**Type:** ${citation.citation_type}`,
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
    lines.push(`**Win rate:** ${winPct}% (${data.winning_citations} won / ${decidedCount} decided)`);
    if (data.win_rate >= 0.7) {
      lines.push('', 'This content is highly effective — it is frequently associated with winning bids.');
    } else if (data.win_rate >= 0.4) {
      lines.push('', 'This content has moderate effectiveness in bid outcomes.');
    } else {
      lines.push('', 'This content has a low win rate — consider reviewing or updating it.');
    }
  }

  return lines.join('\n');
}
