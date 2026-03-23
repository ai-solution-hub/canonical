/**
 * Claude Prompt Generation Utility
 *
 * Generates contextual prompts that users can copy and paste into Claude
 * (Claude.ai, Claude Desktop, CoWork) to take action on Knowledge Hub items.
 *
 * Prompts reference titles, counts, and domains — NOT content item IDs.
 * This keeps prompts readable and lets Claude search the KB naturally.
 */

import type { ActiveBidSummary, DashboardData } from '@/lib/dashboard';
import type { ContentSuggestion } from '@/lib/content-suggestions';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClaudePrompt {
  /** Short label for the button/card */
  label: string;
  /** The full prompt text to copy */
  prompt: string;
  /** Brief explanation of what this prompt does */
  description: string;
  /** Category for grouping */
  category: 'governance' | 'quality' | 'freshness' | 'bid' | 'coverage' | 'general' | 'ingestion' | 'compliance';
}

// ---------------------------------------------------------------------------
// Attention item prompts
// ---------------------------------------------------------------------------

export function generateGovernancePrompt(count: number): ClaudePrompt {
  return {
    label: 'Triage reviews',
    prompt: `Show me the ${count} ${count === 1 ? 'item' : 'items'} pending governance review and help me triage ${count === 1 ? 'it' : 'them'}. For each, summarise the content and recommend whether to approve or request changes.`,
    description: `${count} governance ${count === 1 ? 'review' : 'reviews'} pending`,
    category: 'governance',
  };
}

export function generateUnverifiedPrompt(count: number): ClaudePrompt {
  return {
    label: 'Audit unverified',
    prompt: `Audit the ${count} unverified content ${count === 1 ? 'item' : 'items'}. Check ${count === 1 ? 'its' : 'their'} classification confidence and recommend which to verify and which need manual review.`,
    description: `${count} unverified ${count === 1 ? 'item' : 'items'}`,
    category: 'quality',
  };
}

export function generateStaleContentPrompt(count: number): ClaudePrompt {
  return {
    label: 'Review stale content',
    prompt: `Show me the ${count} stale and expired content ${count === 1 ? 'item' : 'items'}. For each, suggest whether it needs refreshing, merging with newer content, or archiving.`,
    description: `${count} ${count === 1 ? 'item needs' : 'items need'} refreshing`,
    category: 'freshness',
  };
}

export function generateQualityFlagPrompt(count: number): ClaudePrompt {
  return {
    label: 'Fix quality issues',
    prompt: `Show me the ${count} ${count === 1 ? 'item' : 'items'} with quality flags. Identify each issue type and help me fix them, starting with the most severe.`,
    description: `${count} ${count === 1 ? 'item has' : 'items have'} quality issues`,
    category: 'quality',
  };
}

// ---------------------------------------------------------------------------
// Bid prompts
// ---------------------------------------------------------------------------

export function generateBidPrompt(bid: ActiveBidSummary): ClaudePrompt {
  const totalQ = bid.total_questions;
  const answeredQ = bid.answered_questions;
  const remainingQ = totalQ - answeredQ;

  let deadlineText = '';
  if (bid.days_until_deadline !== null) {
    if (bid.days_until_deadline < 0) {
      deadlineText = ' (deadline has passed)';
    } else if (bid.days_until_deadline === 0) {
      deadlineText = ' (deadline is today)';
    } else {
      deadlineText = ` (${bid.days_until_deadline} ${bid.days_until_deadline === 1 ? 'day' : 'days'} remaining)`;
    }
  }

  const prompt = totalQ > 0 && remainingQ > 0
    ? `Show me the status of the "${bid.name}" bid. We have ${answeredQ} of ${totalQ} questions drafted${deadlineText}. Help me draft answers for the remaining ${remainingQ} questions, starting with the highest-priority gaps.`
    : `Show me the current status of the "${bid.name}" bid${deadlineText}. Summarise the progress and suggest what needs attention.`;

  return {
    label: 'Analyse this bid',
    prompt,
    description: remainingQ > 0
      ? `${remainingQ} questions remaining${deadlineText}`
      : `Review bid progress${deadlineText}`,
    category: 'bid',
  };
}

export function generateBidDeadlinePrompt(bid: ActiveBidSummary): ClaudePrompt {
  const deadlineText = bid.days_until_deadline === 0
    ? 'today'
    : `in ${bid.days_until_deadline} ${bid.days_until_deadline === 1 ? 'day' : 'days'}`;

  return {
    label: 'Review before deadline',
    prompt: `The "${bid.name}" bid deadline is ${deadlineText}. Show me the current progress and help me prioritise a final review of the drafted responses before submission.`,
    description: `Deadline ${deadlineText}`,
    category: 'bid',
  };
}

// ---------------------------------------------------------------------------
// Coverage gap prompts
// ---------------------------------------------------------------------------

export function generateCoverageGapPrompt(
  domain: string,
  subtopic: string,
): ClaudePrompt {
  const formattedDomain = domain.replace(/-/g, ' ');
  const formattedSubtopic = subtopic.replace(/-/g, ' ');

  return {
    label: 'Fill this gap',
    prompt: `We have a content gap in ${formattedDomain} / ${formattedSubtopic}. Search the KB for any related content, then help me draft a new article to fill this gap.`,
    description: `No content for ${formattedSubtopic}`,
    category: 'coverage',
  };
}

// ---------------------------------------------------------------------------
// Suggested actions (synthesised from dashboard data)
// ---------------------------------------------------------------------------

export function generateSuggestedActions(data: DashboardData): ClaudePrompt[] {
  const actions: ClaudePrompt[] = [];

  // Priority 1: Governance reviews
  const govCount = data.needs_attention.governance_review_count ?? 0;
  if (govCount > 0) {
    actions.push(generateGovernancePrompt(govCount));
  }

  // Priority 2: Active bids with gaps (sorted by deadline urgency)
  const bidsWithGaps = data.active_bids
    .filter((b) => b.total_questions > 0 && b.answered_questions < b.total_questions)
    .sort((a, b) => {
      // Sort by days_until_deadline ascending (most urgent first)
      const aD = a.days_until_deadline ?? 999;
      const bD = b.days_until_deadline ?? 999;
      return aD - bD;
    });

  for (const bid of bidsWithGaps.slice(0, 2)) {
    actions.push(generateBidPrompt(bid));
  }

  // Priority 2b: Fully drafted bids approaching deadline (final review)
  const bidsApproachingDeadline = data.active_bids
    .filter((b) =>
      b.answered_questions >= b.total_questions &&
      b.days_until_deadline !== null &&
      b.days_until_deadline >= 0 &&
      b.days_until_deadline <= 7,
    )
    .sort((a, b) => (a.days_until_deadline ?? 999) - (b.days_until_deadline ?? 999));

  for (const bid of bidsApproachingDeadline.slice(0, 1)) {
    if (actions.length < 5) {
      actions.push(generateBidDeadlinePrompt(bid));
    }
  }

  // Priority 3: Quality flags
  const qualityCount = data.needs_attention.quality_flag_count ?? 0;
  if (qualityCount > 0) {
    actions.push(generateQualityFlagPrompt(qualityCount));
  }

  // Priority 4: Stale content
  const staleCount =
    (data.needs_attention.stale_content_count ?? 0) +
    (data.needs_attention.expired_content_count ?? 0);
  if (staleCount > 0) {
    actions.push(generateStaleContentPrompt(staleCount));
  }

  // Priority 5: Unverified items (lower priority)
  const unverifiedCount = data.needs_attention.unverified_count ?? 0;
  if (unverifiedCount > 0 && actions.length < 5) {
    actions.push(generateUnverifiedPrompt(unverifiedCount));
  }

  // Priority 6: Coverage health (general analysis)
  if (staleCount > 0 && actions.length < 5) {
    actions.push({
      label: 'Analyse coverage health',
      prompt:
        'Analyse our overall content coverage. Which domains have the most gaps? Where is content getting stale? Give me a prioritised action plan.',
      description: 'Get a coverage health overview',
      category: 'coverage',
    });
  }

  // Priority 7: Bid sprint (multi-bid overview)
  const bidCount = data.active_bids.length;
  if (bidCount >= 2 && actions.length < 5) {
    actions.push({
      label: 'Bid sprint overview',
      prompt: `I have ${bidCount} active bids. Show me a summary of each with progress and deadlines, then help me work through the most urgent gaps across all bids.`,
      description: `${bidCount} bids active — get a cross-bid summary`,
      category: 'bid',
    });
  }

  // Priority 8: Content ingestion (always available as a utility action)
  if (actions.length < 5) {
    actions.push(generateBulkIngestPrompt());
  }

  // If nothing needs attention, offer a general prompt
  if (actions.length === 0) {
    actions.push({
      label: 'Morning briefing',
      prompt:
        'Give me a morning briefing. What\'s changed recently? Are there any governance reviews, quality issues, or bid deadlines I should handle?',
      description: 'Get a quick overview of what needs attention',
      category: 'general',
    });
  }

  // Cap at 5 suggestions
  return actions.slice(0, 5);
}

// ---------------------------------------------------------------------------
// Guide section prompts
// ---------------------------------------------------------------------------

export function generateGuideGapPrompt(
  guideName: string,
  sectionName: string,
): ClaudePrompt {
  return {
    label: 'Create with Claude',
    prompt: `We need content for the "${sectionName}" section in the "${guideName}" guide. Search the KB for any related content, then help me draft material to fill this section.`,
    description: `Create content for ${sectionName}`,
    category: 'coverage',
  };
}

// ---------------------------------------------------------------------------
// Ingestion prompts
// ---------------------------------------------------------------------------

export function generateIngestUrlPrompt(url: string): ClaudePrompt {
  return {
    label: 'Ingest this URL',
    prompt: `Read the content at this URL: ${url}\n\nExtract the key information and use the create_content_item tool to add it to our Knowledge Base. Classify it with the appropriate domain, subtopic, and content type based on the content. Once created, confirm what was added and provide a link to the new item.`,
    description: 'Ingest a web page into the Knowledge Base',
    category: 'ingestion',
  };
}

export function generateIngestDocumentPrompt(filename?: string): ClaudePrompt {
  const fileRef = filename ? `the attached document "${filename}"` : 'your document';
  const dateStamp = new Date().toISOString().split('T')[0];

  return {
    label: 'Import document',
    prompt: `I'd like to import ${fileRef} into the Knowledge Base. Please attach the document to this conversation.\n\nExtract the key content and create separate KB items for each distinct topic using the create_content_item tool. For each item, classify it with the appropriate domain, subtopic, and content type. Tag all items with the batch_tag "manual-ingest-${dateStamp}" so they can be tracked together.\n\nSummarise what was created when finished.`,
    description: 'Import a document into the Knowledge Base',
    category: 'ingestion',
  };
}

export function generateSummariseAndIngestPrompt(
  title: string,
  contentSnippet?: string,
): ClaudePrompt {
  const snippetSection = contentSnippet
    ? `\n\nHere is a snippet for context:\n${contentSnippet.slice(0, 500)}`
    : '';

  return {
    label: 'Summarise and add to KB',
    prompt: `Create a concise, well-structured Knowledge Base item for: "${title}"${snippetSection}\n\nUse the create_content_item tool to add it. Ensure it has a clear summary, appropriate classification (domain, subtopic, content type), and is well-structured for future retrieval.`,
    description: `Add "${title}" to the Knowledge Base`,
    category: 'ingestion',
  };
}

export function generateBulkIngestPrompt(context?: string): ClaudePrompt {
  const dateStamp = new Date().toISOString().split('T')[0];
  const contextSection = context ? `\n\nContext: ${context}` : '';

  return {
    label: 'Add content to KB',
    prompt: `Help me add content to the Knowledge Base. Use the create_content_item tool for each item.${contextSection}\n\nValid content types are: article, blog, case_study, guide, note, policy, process, product_description, q_a_pair, research, whitepaper.\n\nFor each item, classify it with the appropriate domain, subtopic, and content type. Tag all items with the batch_tag "manual-ingest-${dateStamp}" so they can be tracked together.\n\nLet me know what content you'd like to add, or I can describe what I have.`,
    description: 'Add one or more items to the Knowledge Base',
    category: 'ingestion',
  };
}

// ---------------------------------------------------------------------------
// Content suggestion prompts
// ---------------------------------------------------------------------------

export function generateContentSuggestionPrompt(
  suggestion: ContentSuggestion,
): ClaudePrompt {
  const contentType = suggestion.suggested_content_type ?? 'well-structured item';
  const formattedDomain = suggestion.domain.replace(/-/g, ' ');
  const formattedSubtopic = suggestion.subtopic.replace(/-/g, ' ');

  return {
    label: `Create ${contentType} for ${formattedSubtopic}`,
    prompt: `We have a content gap in ${formattedDomain} / ${formattedSubtopic} (${suggestion.description}). Search the KB for any related content in this domain, then help me create a ${contentType} to fill this gap. Classify it under ${formattedDomain} / ${formattedSubtopic}.`,
    description: suggestion.title,
    category: 'coverage',
  };
}

export function generateBulkGapFillingPrompt(
  suggestions: ContentSuggestion[],
): ClaudePrompt {
  const gapList = suggestions
    .slice(0, 5)
    .map((s) => `- ${s.domain} / ${s.subtopic} (${s.suggestion_type.replace(/_/g, ' ')})`)
    .join('\n');

  return {
    label: 'Fill content gaps',
    prompt: `We have ${suggestions.length} content ${suggestions.length === 1 ? 'gap' : 'gaps'} in the Knowledge Base. The highest priority gaps are:\n\n${gapList}\n\nHelp me create content to fill these gaps, starting with the most critical. For each, search the KB for related content and draft a new item.`,
    description: `${suggestions.length} ${suggestions.length === 1 ? 'gap' : 'gaps'} identified`,
    category: 'coverage',
  };
}

// ---------------------------------------------------------------------------
// Certification review prompts
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Document diff review prompts
// ---------------------------------------------------------------------------

export function generateDocumentDiffReviewPrompt(
  filename: string,
  changedCount: number,
  affectedItemCount: number,
): ClaudePrompt {
  return {
    label: 'Review document changes',
    prompt: `An updated version of "${filename}" has been uploaded. There ${changedCount === 1 ? 'is' : 'are'} ${changedCount} ${changedCount === 1 ? 'change' : 'changes'} detected${affectedItemCount > 0 ? `, affecting ${affectedItemCount} KB ${affectedItemCount === 1 ? 'item' : 'items'}` : ''}. Please review the changes using the get_document_diff tool and advise which KB items need updating.`,
    description: `${changedCount} changes, ${affectedItemCount} items affected`,
    category: 'general',
  };
}

// ---------------------------------------------------------------------------
// Certification review prompts
// ---------------------------------------------------------------------------

export function generateCertificationReviewPrompt(
  certCount: number,
  expiringCount: number,
): ClaudePrompt {
  return {
    label: 'Review certification status',
    prompt: `Review our certification and framework status. We have ${certCount} ${certCount === 1 ? 'certification' : 'certifications'} on record${expiringCount > 0 ? ` and ${expiringCount} ${expiringCount === 1 ? 'is' : 'are'} expiring soon` : ''}. For each certification, check whether the version is current, the expiry date is correct, and we have adequate supporting evidence in the knowledge base. Flag any gaps.`,
    description: `${certCount} ${certCount === 1 ? 'certification' : 'certifications'}, ${expiringCount} expiring`,
    category: 'compliance',
  };
}
