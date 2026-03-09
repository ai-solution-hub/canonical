'use client';

import { useCopilotChatSuggestions } from '@copilotkit/react-ui';
import { useBidContext } from './bid-context-provider';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Context-aware chat suggestions for the bid workspace.
 * Deferred until after hydration so the CopilotKit provider is mounted.
 *
 * Suggestions change based on the current question state:
 * - No question selected: general bid overview prompts
 * - Unmatched question: search and matching prompts
 * - Matched but no draft: drafting prompts
 * - Draft exists: improvement and review prompts
 * - Approved: next question prompts
 */
export function BidCopilotSuggestions() {
  const hydrated = useHydrated();

  if (!hydrated) return null;

  return <BidCopilotSuggestionsInner />;
}

function BidCopilotSuggestionsInner() {
  const { bid, questions, activeQuestionId, activeResponse } =
    useBidContext();

  // Find current question state
  const activeQuestion = activeQuestionId
    ? questions.find((q) => q.id === activeQuestionId)
    : null;

  const hasResponse = activeResponse !== null;
  const isApproved = activeResponse?.reviewStatus === 'approved';
  const confidencePosture = activeQuestion?.confidencePosture ?? 'no_content';
  const totalQuestions = questions.length;
  const unansweredCount = questions.filter(
    (q) => !q.responseStatus || q.responseStatus === 'not_started',
  ).length;

  // ── Build instructions based on state ──
  let instructions: string;

  if (!activeQuestion) {
    // No question selected
    instructions = `The user is viewing the bid "${bid?.name ?? 'unknown'}" with ${totalQuestions} questions (${unansweredCount} unanswered). Suggest actions like:
- "Show me the bid progress"
- "Go to the first unanswered question"
- "Search for [relevant topic] in the knowledge base"`;
  } else if (
    confidencePosture === 'no_content' ||
    confidencePosture === 'needs_sme'
  ) {
    // Question with no/weak KB matches
    instructions = `The user is viewing question ${activeQuestion.questionNumber}: "${activeQuestion.questionText.slice(0, 80)}..." which has ${confidencePosture === 'no_content' ? 'no KB content' : 'weak matches'}. Suggest actions like:
- "Search the knowledge base for relevant content"
- "Draft a response for this question"
- "What topics should I add to the KB for this question?"`;
  } else if (!hasResponse) {
    // Question with matches but no draft yet
    instructions = `The user is viewing question ${activeQuestion.questionNumber}: "${activeQuestion.questionText.slice(0, 80)}..." which has ${confidencePosture === 'strong_match' ? 'strong' : 'partial'} KB matches but no draft yet. Suggest actions like:
- "Draft a response for this question"
- "Show me the matched KB content"
- "Search for additional relevant content"`;
  } else if (isApproved) {
    // Response approved
    instructions = `The user has approved the response for question ${activeQuestion.questionNumber}. Suggest moving on:
- "Go to the next unanswered question"
- "Show me the bid progress"
- "Which questions still need attention?"`;
  } else {
    // Response exists, can be improved
    const wordLimit = activeQuestion.wordLimit;
    const wordCount = activeResponse?.wordCount ?? 0;
    const isOverLimit = wordLimit ? wordCount > wordLimit : false;
    const isUnderTarget = wordLimit ? wordCount < wordLimit * 0.7 : false;

    let improvementHint = '';
    if (isOverLimit) {
      improvementHint = `The response is over the word limit (${wordCount}/${wordLimit} words). `;
    } else if (isUnderTarget && wordLimit) {
      improvementHint = `The response is well under the word limit (${wordCount}/${wordLimit} words). `;
    }

    instructions = `The user is editing a response for question ${activeQuestion.questionNumber}. ${improvementHint}Suggest actions like:
- "Make this response more concise"
- "Add more detail and evidence"
- "Improve the structure"
- "Submit for review"
- "${isOverLimit ? 'Reduce to ' + wordLimit + ' words' : 'Save this response'}"`;
  }

  useCopilotChatSuggestions(
    {
      instructions,
      minSuggestions: 1,
      maxSuggestions: 3,
    },
    [
      activeQuestionId,
      hasResponse,
      isApproved,
      confidencePosture,
      activeResponse?.wordCount,
    ],
  );

  // No JSX needed -- suggestions render in the CopilotSidebar
  return null;
}
