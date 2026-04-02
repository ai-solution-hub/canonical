/**
 * Claude Prompt Generation Utility
 *
 * Generates contextual prompts that users can copy and paste into Claude
 * (Claude.ai, Claude Desktop, CoWork) to take action on Knowledge Hub items.
 *
 * Prompts reference titles, counts, and domains — NOT content item IDs.
 * This keeps prompts readable and lets Claude search the KB naturally.
 */

import type { ActiveBidSummary } from '@/lib/dashboard';

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
  category:
    | 'governance'
    | 'quality'
    | 'freshness'
    | 'bid'
    | 'coverage'
    | 'general'
    | 'ingestion'
    | 'compliance';
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

  const prompt =
    totalQ > 0 && remainingQ > 0
      ? `Show me the status of the "${bid.name}" bid. We have ${answeredQ} of ${totalQ} questions drafted${deadlineText}. Help me draft answers for the remaining ${remainingQ} questions, starting with the highest-priority gaps.`
      : `Show me the current status of the "${bid.name}" bid${deadlineText}. Summarise the progress and suggest what needs attention.`;

  return {
    label: 'Analyse this bid',
    prompt,
    description:
      remainingQ > 0
        ? `${remainingQ} questions remaining${deadlineText}`
        : `Review bid progress${deadlineText}`,
    category: 'bid',
  };
}

export function generateBidDeadlinePrompt(bid: ActiveBidSummary): ClaudePrompt {
  const deadlineText =
    bid.days_until_deadline === 0
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
// Ingestion prompts
// ---------------------------------------------------------------------------

export function generateIngestUrlPrompt(url: string): ClaudePrompt {
  return {
    label: 'Ingest this URL',
    prompt: `Read the content at this URL: ${url}\n\nExtract the key information and add it to our Knowledge Base as a new content item. Classify it with the appropriate domain, subtopic, and content type based on the content. Once created, confirm what was added and provide a link to the new item.`,
    description: 'Ingest a web page into the Knowledge Base',
    category: 'ingestion',
  };
}

export function generateIngestDocumentPrompt(filename?: string): ClaudePrompt {
  const fileRef = filename
    ? `the attached document "${filename}"`
    : 'your document';
  const dateStamp = new Date().toISOString().split('T')[0];

  return {
    label: 'Import document',
    prompt: `I'd like to import ${fileRef} into the Knowledge Base. Please attach the document to this conversation.\n\nExtract the key content and create separate KB items for each distinct topic. For each item, classify it with the appropriate domain, subtopic, and content type. Tag all items with the batch_tag "manual-ingest-${dateStamp}" so they can be tracked together.\n\nSummarise what was created when finished.`,
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
    prompt: `Create a concise, well-structured Knowledge Base item for: "${title}"${snippetSection}\n\nAdd it to our Knowledge Base. Ensure it has a clear summary, appropriate classification (domain, subtopic, content type), and is well-structured for future retrieval.`,
    description: `Add "${title}" to the Knowledge Base`,
    category: 'ingestion',
  };
}

export function generateBulkIngestPrompt(context?: string): ClaudePrompt {
  const dateStamp = new Date().toISOString().split('T')[0];
  const contextSection = context ? `\n\nContext: ${context}` : '';

  return {
    label: 'Add content to KB',
    prompt: `Help me add content to the Knowledge Base. Create a new content item for each piece of content.${contextSection}\n\nValid content types are: article, blog, case_study, guide, note, policy, process, product_description, q_a_pair, research, whitepaper.\n\nFor each item, classify it with the appropriate domain, subtopic, and content type. Tag all items with the batch_tag "manual-ingest-${dateStamp}" so they can be tracked together.\n\nLet me know what content you'd like to add, or I can describe what I have.`,
    description: 'Add one or more items to the Knowledge Base',
    category: 'ingestion',
  };
}

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
    prompt: `An updated version of "${filename}" has been uploaded. There ${changedCount === 1 ? 'is' : 'are'} ${changedCount} ${changedCount === 1 ? 'change' : 'changes'} detected${affectedItemCount > 0 ? `, affecting ${affectedItemCount} KB ${affectedItemCount === 1 ? 'item' : 'items'}` : ''}. Please review the document changes and advise which KB items need updating.`,
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
