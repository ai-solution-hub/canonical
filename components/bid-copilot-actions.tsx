'use client';

import { useCopilotAction } from '@copilotkit/react-core';
import { useBidContext, type QuestionSummary } from './bid-context-provider';
import { SearchingIndicator } from '@/components/copilot-ui/searching-indicator';
import { KBSearchResults } from '@/components/copilot-ui/kb-search-results';
import { ReviewConfirmation } from '@/components/copilot-ui/review-confirmation';
import {
  findQuestionByNumber,
  findQuestionByText,
  calculateBidProgress,
} from '@/lib/copilotkit/action-helpers';
import { useHydrated } from '@/hooks/use-hydrated';

/**
 * Registers CopilotKit actions for the bid workspace.
 * Deferred until after hydration so the CopilotKit provider is mounted.
 *
 * All context values are destructured at the component level so that
 * action handlers can reference them from the closure. Action handlers
 * must NOT call useBidContext() internally -- that would violate the
 * Rules of Hooks.
 */
export function BidCopilotActions() {
  const hydrated = useHydrated();

  if (!hydrated) return null;

  return <BidCopilotActionsInner />;
}

function BidCopilotActionsInner() {
  const {
    bidId,
    bid,
    questions,
    activeQuestionId,
    activeResponse,
    editorRef,
    setActiveQuestionId,
  } = useBidContext();

  // ════════════════════════════════════════════
  // Action 1: Search Knowledge Base
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'searchKnowledgeBase',
    description:
      'Search the knowledge base for content relevant to a bid question. Use this when the user asks to find content, search for information, or wants to know what relevant material exists.',
    parameters: [
      {
        name: 'query',
        type: 'string',
        description: 'The search query -- can be the question text or keywords',
        required: true,
      },
      {
        name: 'domain',
        type: 'string',
        description:
          'Optional domain filter (e.g., security, compliance, methodology)',
        required: false,
      },
      {
        name: 'limit',
        type: 'number',
        description: 'Number of results to return (default 5, max 10)',
        required: false,
      },
    ],
    handler: async ({
      query,
      domain,
      limit,
    }: {
      query: string;
      domain?: string;
      limit?: number;
    }) => {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          domain: domain ?? undefined,
          limit: Math.min(limit ?? 5, 10),
        }),
      });

      if (!response.ok) {
        return { error: 'Search failed. Please try again.' };
      }

      const data = await response.json();
      return {
        results: (data.results ?? []).map(
          (r: Record<string, unknown>) => ({
            id: r.id,
            title: r.suggested_title ?? r.title ?? 'Untitled',
            type: r.content_type,
            domain: r.primary_domain,
            similarity: r.similarity,
            summary: typeof r.ai_summary === 'string'
              ? r.ai_summary.slice(0, 200)
              : undefined,
            snippet: typeof r.snippet === 'string'
              ? r.snippet.slice(0, 300)
              : undefined,
          }),
        ),
        totalFound: data.results?.length ?? 0,
      };
    },
    render: ({ result, status }) => {
      if (status === 'inProgress' || status === 'executing') {
        return <SearchingIndicator />;
      }
      if (!result?.results?.length) {
        return (
          <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
            No matching content found in the knowledge base.
          </div>
        );
      }
      return <KBSearchResults results={result.results} />;
    },
  });

  // ════════════════════════════════════════════
  // Action 2: Draft Response
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'draftResponse',
    description:
      'Generate an AI draft response for a bid question using knowledge base content. Use when the user asks to draft, generate, or write a response.',
    parameters: [
      {
        name: 'questionId',
        type: 'string',
        description:
          'The question ID to draft a response for. Defaults to the active question.',
        required: false,
      },
      {
        name: 'instructions',
        type: 'string',
        description:
          'Optional additional instructions for the draft (e.g., "focus on ISO 27001", "keep under 200 words")',
        required: false,
      },
    ],
    handler: async ({
      questionId,
      instructions,
    }: {
      questionId?: string;
      instructions?: string;
    }) => {
      const targetQuestionId = questionId ?? activeQuestionId;
      if (!targetQuestionId) {
        return {
          error: 'No question selected. Please select a question first.',
        };
      }

      const response = await fetch(
        `/api/bids/${bidId}/responses/draft`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_ids: [targetQuestionId],
            ...(instructions ? { instructions } : {}),
          }),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return { error: err.error ?? 'Drafting failed. Please try again.' };
      }

      const data = await response.json();
      const firstResult = data.results?.[0];

      if (firstResult?.status === 'drafted') {
        return {
          success: true,
          message: `Draft generated for question.`,
          drafted: data.drafted,
        };
      }

      if (firstResult?.status === 'skipped') {
        return {
          success: false,
          message: `Question was skipped: ${firstResult.reason}`,
        };
      }

      return {
        success: false,
        error: firstResult?.error ?? 'Drafting failed',
      };
    },
  });

  // ════════════════════════════════════════════
  // Action 3: Improve Response
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'improveResponse',
    description:
      'Improve an existing response. Use when the user asks to make it more concise, add more detail, improve structure, strengthen evidence, or adjust tone.',
    parameters: [
      {
        name: 'improvementType',
        type: 'string',
        description:
          'Type of improvement: "concise" (reduce word count), "detailed" (add more detail), "structure" (improve organisation), "evidence" (add more citations), "tone" (adjust formality), "custom" (use freeform instructions)',
        required: true,
      },
      {
        name: 'instructions',
        type: 'string',
        description:
          'Freeform instructions for the improvement. Required when improvementType is "custom".',
        required: false,
      },
      {
        name: 'targetWordCount',
        type: 'number',
        description:
          'Target word count for the improved response. Useful for hitting word limits.',
        required: false,
      },
    ],
    handler: async ({
      improvementType,
      instructions,
      targetWordCount,
    }: {
      improvementType: string;
      instructions?: string;
      targetWordCount?: number;
    }) => {
      if (!activeQuestionId || !activeResponse) {
        return {
          error: 'No active response to improve. Draft a response first.',
        };
      }

      // Regenerate with instructions
      const improvementInstructions =
        improvementType === 'custom'
          ? (instructions ?? 'Improve this response.')
          : `${improvementType}: ${instructions ?? ''}`.trim();

      const regenerateInstructions = targetWordCount
        ? `${improvementInstructions}. Target word count: ${targetWordCount} words.`
        : improvementInstructions;

      const response = await fetch(
        `/api/bids/${bidId}/responses/${activeResponse.id}/regenerate`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instructions: regenerateInstructions,
          }),
        },
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        return {
          error: err.error ?? 'Improvement failed. Please try again.',
        };
      }

      const data = await response.json();
      return {
        success: true,
        message: 'Response improved successfully.',
        newWordCount: data.response?.response_text
          ?.split(/\s+/)
          .filter(Boolean).length,
      };
    },
  });

  // ════════════════════════════════════════════
  // Action 4: Navigate to Question
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'navigateToQuestion',
    description:
      'Navigate to a specific question in the bid. Use when the user says "go to question 5" or "show me the security question".',
    parameters: [
      {
        name: 'questionNumber',
        type: 'number',
        description: 'The question number to navigate to',
        required: false,
      },
      {
        name: 'searchText',
        type: 'string',
        description:
          'Text to search for in question text (e.g., "security" to find the security question)',
        required: false,
      },
    ],
    handler: async ({
      questionNumber,
      searchText,
    }: {
      questionNumber?: number;
      searchText?: string;
    }) => {
      let target: QuestionSummary | undefined;

      if (questionNumber) {
        target = findQuestionByNumber(questions, questionNumber);
      } else if (searchText) {
        target = findQuestionByText(questions, searchText);
      }

      if (!target) {
        return {
          error: `Could not find the requested question. This bid has ${questions.length} questions.`,
        };
      }

      setActiveQuestionId(target.id);
      return {
        navigatedTo: target.questionNumber,
        questionText: target.questionText.slice(0, 100),
        confidence: target.confidencePosture,
      };
    },
  });

  // ════════════════════════════════════════════
  // Action 5: Save Draft
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'saveDraft',
    description:
      'Save the current response draft. Use when the user says "save" or "save this response".',
    parameters: [],
    handler: async () => {
      if (!activeQuestionId || !activeResponse?.id) {
        return { error: 'No active response to save.' };
      }

      const html =
        editorRef.current?.getHTML() ?? activeResponse.responseText;

      const response = await fetch(
        `/api/bids/${bidId}/responses/${activeResponse.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            response_text: html,
          }),
        },
      );

      if (!response.ok) {
        return { error: 'Save failed. Please try again.' };
      }

      const wordCount = html.split(/\s+/).filter(Boolean).length;
      return {
        success: true,
        wordCount,
        message: `Response saved (${wordCount} words).`,
      };
    },
  });

  // ════════════════════════════════════════════
  // Action 6: Submit for Review
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'submitForReview',
    description:
      'Submit the current response for review. Use when the user says "submit for review" or "mark as ready for review". Saves the current content and marks the response as needing review. This action will show a confirmation dialog and wait for the user to confirm or cancel.',
    parameters: [
      {
        name: 'questionId',
        type: 'string',
        description: 'Question ID to submit. Defaults to active question.',
        required: false,
      },
    ],
    renderAndWaitForResponse: ({ args, status, respond }) => {
      const targetId = args.questionId ?? activeQuestionId;

      if (status === 'inProgress') {
        return (
          <ReviewConfirmation
            questionId={targetId}
            isLoading={true}
            onConfirm={() => {}}
            onCancel={() => {}}
          />
        );
      }

      if (status === 'complete') {
        return <></>;
      }

      // status === 'executing' — show confirmation and wait
      return (
        <ReviewConfirmation
          questionId={targetId}
          isLoading={false}
          onConfirm={async () => {
            if (!targetId || !activeResponse?.id) {
              respond?.({ error: 'No question selected or no response to submit.' });
              return;
            }

            try {
              // Save current editor content first
              if (editorRef.current) {
                const html = editorRef.current.getHTML();
                await fetch(`/api/bids/${bidId}/responses/${activeResponse.id}`, {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ response_text: html }),
                });
              }

              // Update review status
              const response = await fetch(
                `/api/bids/${bidId}/responses/${activeResponse.id}`,
                {
                  method: 'PATCH',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ review_status: 'needs_review' }),
                },
              );

              if (!response.ok) {
                respond?.({ error: 'Submit for review failed.' });
                return;
              }

              respond?.({ success: true, message: 'Response submitted for review.' });
            } catch (err) {
              console.error('CopilotKit submitForReview action failed:', err);
              respond?.({ error: 'Submit for review failed.' });
            }
          }}
          onCancel={() => {
            respond?.({ cancelled: true, message: 'Review submission cancelled.' });
          }}
        />
      );
    },
  });

  // ════════════════════════════════════════════
  // Action 7: Get Bid Progress Summary
  // ════════════════════════════════════════════
  useCopilotAction({
    name: 'getBidProgress',
    description:
      'Get a summary of the current bid progress. Use when the user asks "how is the bid going?" or "what is the status?".',
    parameters: [],
    handler: async () => {
      if (!bid) return { error: 'No bid loaded.' };
      return calculateBidProgress(bid, questions);
    },
  });

  // Actions are registered via hooks, no JSX needed
  return null;
}
