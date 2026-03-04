/**
 * Pure helper functions for CopilotKit actions.
 *
 * Extracted from action handlers to enable unit testing without
 * CopilotKit or React hook infrastructure.
 */

import type { QuestionSummary } from '@/components/bid-context-provider';

/**
 * Find a question by its display number (1-based).
 */
export function findQuestionByNumber(
  questions: QuestionSummary[],
  questionNumber: number,
): QuestionSummary | undefined {
  return questions.find((q) => q.questionNumber === questionNumber);
}

/**
 * Find a question by partial text match (case-insensitive).
 */
export function findQuestionByText(
  questions: QuestionSummary[],
  searchText: string,
): QuestionSummary | undefined {
  const lower = searchText.toLowerCase();
  return questions.find((q) =>
    q.questionText.toLowerCase().includes(lower),
  );
}

/**
 * Calculate bid progress statistics from context data.
 */
export function calculateBidProgress(
  bid: {
    name: string;
    buyer: string | null;
    deadline: string | null;
    status: string;
    totalQuestions: number;
  },
  questions: QuestionSummary[],
) {
  const byConfidence = {
    strong_match: questions.filter(
      (q) => q.confidencePosture === 'strong_match',
    ).length,
    partial_match: questions.filter(
      (q) => q.confidencePosture === 'partial_match',
    ).length,
    needs_sme: questions.filter(
      (q) => q.confidencePosture === 'needs_sme',
    ).length,
    no_content: questions.filter(
      (q) => q.confidencePosture === 'no_content',
    ).length,
  };

  const byStatus = {
    not_started: questions.filter(
      (q) => !q.responseStatus || q.responseStatus === 'not_started',
    ).length,
    drafted: questions.filter(
      (q) =>
        q.responseStatus === 'draft' ||
        q.responseStatus === 'ai_drafted',
    ).length,
    in_review: questions.filter(
      (q) => q.responseStatus === 'needs_review',
    ).length,
    accepted: questions.filter(
      (q) => q.responseStatus === 'approved',
    ).length,
  };

  const totalQuestions = bid.totalQuestions || questions.length;
  const completionPercentage =
    totalQuestions > 0
      ? Math.round((byStatus.accepted / totalQuestions) * 100)
      : 0;

  return {
    bidName: bid.name,
    buyer: bid.buyer,
    deadline: bid.deadline,
    status: bid.status,
    totalQuestions,
    byConfidence,
    byStatus,
    completionPercentage,
  };
}
