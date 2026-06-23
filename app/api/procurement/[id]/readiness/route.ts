import { defineRoute } from '@/lib/api/define-route';
import { authFailureResponse, getAuthorisedClient } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { ReadinessDataSchema } from '@/lib/validation/schemas';
import type {
  ProcurementResponseMetadata,
  QualityData,
} from '@/types/procurement-metadata';
import { NextResponse } from 'next/server';

export const maxDuration = 30;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReadinessCriterion {
  name: string;
  passed: boolean;
  details: string;
}

interface QuestionIssue {
  question_number: number;
  question_title: string;
  issues: string[];
}

interface ReadinessResponse {
  ready: boolean;
  summary: {
    total_questions: number;
    answered: number;
    approved: number;
    quality_checked: number;
    passing_quality: number;
  };
  criteria: ReadinessCriterion[];
  issues: QuestionIssue[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const QUALITY_SCORE_THRESHOLD = 60;

function assessQualityData(qualityData: QualityData | null): {
  hasQualityCheck: boolean;
  passingQuality: boolean;
  wordLimitOk: boolean;
  noCriticalIssues: boolean;
  noUnsupportedClaims: boolean;
  hasCitations: boolean;
} {
  if (!qualityData) {
    return {
      hasQualityCheck: false,
      passingQuality: false,
      wordLimitOk: true, // no data = no violation
      noCriticalIssues: true,
      noUnsupportedClaims: true,
      hasCitations: false,
    };
  }

  return {
    hasQualityCheck: true,
    passingQuality: (qualityData.overall_score ?? 0) >= QUALITY_SCORE_THRESHOLD,
    wordLimitOk: qualityData.word_limit_compliance !== false,
    noCriticalIssues: !(qualityData.issues ?? []).some(
      (issue) => issue.severity === 'error',
    ),
    noUnsupportedClaims: (qualityData.unsupported_claims ?? []).length === 0,
    hasCitations: (qualityData.citation_count ?? 0) > 0,
  };
}

// ---------------------------------------------------------------------------
// GET /api/procurement/:id/readiness
// ---------------------------------------------------------------------------

export const GET = defineRoute(
  ReadinessDataSchema,
  async (
    _request: Request,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const auth = await getAuthorisedClient(['admin', 'editor']);
      if (!auth.success) return authFailureResponse(auth);
      const { supabase } = auth;

      const { id } = await params;
      if (!UUID_RE.test(id)) {
        return NextResponse.json(
          { error: 'Invalid bid ID -- must be a valid UUID' },
          { status: 400 },
        );
      }

      // Verify bid exists.
      // Post-T2: discriminator via application_types JOIN.
      const { data: bid, error: procurementError } = await supabase
        .from('workspaces')
        .select('id, application_types!inner(key)')
        .eq('id', id)
        .eq('application_types.key', 'procurement')
        .single();

      if (procurementError || !bid) {
        return NextResponse.json(
          { error: 'Procurement not found' },
          { status: 404 },
        );
      }

      // Fetch all questions for this bid.
      // Post-T2: `form_questions.workspace_id` → `workspace_id`.
      const { data: questions, error: questionsError } = await supabase
        .from('form_questions')
        .select(
          'id, question_text, question_sequence, section_name, word_limit',
        )
        .eq('workspace_id', id)
        .order('section_sequence')
        .order('question_sequence');

      if (questionsError) {
        return NextResponse.json(
          { error: 'Failed to fetch questions' },
          { status: 500 },
        );
      }

      const allQuestions = questions ?? [];
      const questionIds = allQuestions.map((q) => q.id);

      // Fetch all responses for these questions
      let allResponses: Array<{
        question_id: string;
        response_text: string | null;
        review_status: string | null;
        metadata: unknown;
        overall_score?: number | null;
      }> = [];

      if (questionIds.length > 0) {
        const { data: responses, error: responsesError } = await supabase
          .from('form_responses')
          .select(
            'question_id, response_text, review_status, metadata, overall_score',
          )
          .in('question_id', questionIds);

        if (responsesError) {
          return NextResponse.json(
            { error: 'Failed to fetch responses' },
            { status: 500 },
          );
        }
        allResponses = responses ?? [];
      }

      // Build response lookup
      const responseMap = new Map<
        string,
        {
          response_text: string | null;
          review_status: string | null;
          metadata: unknown;
          overall_score?: number | null;
        }
      >();
      for (const r of allResponses) {
        responseMap.set(r.question_id, r);
      }

      // Assess each question
      let answeredCount = 0;
      let approvedCount = 0;
      let qualityCheckedCount = 0;
      let passingQualityCount = 0;
      let wordLimitPassCount = 0;
      let noCriticalIssuesCount = 0;
      let noUnsupportedClaimsCount = 0;
      let hasCitationsCount = 0;
      const questionIssues: QuestionIssue[] = [];

      for (let i = 0; i < allQuestions.length; i++) {
        const q = allQuestions[i];
        const response = responseMap.get(q.id);
        const issues: string[] = [];

        // Check 1: Has response
        const hasResponse =
          !!response?.response_text && response.response_text.trim().length > 0;
        if (hasResponse) answeredCount++;
        else issues.push('No response drafted');

        // Check 2: Review status
        const reviewStatus = response?.review_status ?? null;
        const isApproved =
          reviewStatus === 'approved' || reviewStatus === 'edited';
        if (isApproved) approvedCount++;
        else if (hasResponse)
          issues.push(
            `Review status: ${reviewStatus ?? 'none'} (requires approved or edited)`,
          );

        // Quality data assessment — prefer overall_score from dedicated column
        const meta = (response?.metadata ?? {}) as ProcurementResponseMetadata;
        const qualityDataFromMeta = meta.quality_data ?? null;
        // Merge column value into quality data for backward compat
        const columnScore = response?.overall_score;
        const qualityData = qualityDataFromMeta
          ? {
              ...qualityDataFromMeta,
              overall_score: columnScore ?? qualityDataFromMeta.overall_score,
            }
          : null;
        const quality = assessQualityData(qualityData);

        if (quality.hasQualityCheck) {
          qualityCheckedCount++;
          if (quality.passingQuality) passingQualityCount++;
          else
            issues.push(
              `Quality score: ${qualityData?.overall_score ?? 0}/100 (threshold: ${QUALITY_SCORE_THRESHOLD})`,
            );
        }

        // Check 3: Word limit compliance
        if (quality.wordLimitOk) wordLimitPassCount++;
        else issues.push('Word limit exceeded');

        // Check 4: No critical issues
        if (quality.noCriticalIssues) noCriticalIssuesCount++;
        else issues.push('Has critical quality issues');

        // Check 5: No unsupported claims
        if (quality.noUnsupportedClaims) noUnsupportedClaimsCount++;
        else
          issues.push(
            `${qualityData?.unsupported_claims?.length ?? 0} unsupported claim(s)`,
          );

        // Check 6: Has citations
        if (quality.hasCitations) hasCitationsCount++;
        else if (quality.hasQualityCheck) issues.push('No citations found');

        if (issues.length > 0) {
          questionIssues.push({
            question_number: q.question_sequence ?? i + 1,
            question_title:
              q.question_text?.substring(0, 100) ?? 'Untitled question',
            issues,
          });
        }
      }

      const totalQuestions = allQuestions.length;

      // Build criteria list
      const criteria: ReadinessCriterion[] = [
        {
          name: 'All questions answered',
          passed: answeredCount === totalQuestions,
          details: `${answeredCount} of ${totalQuestions} questions answered`,
        },
        {
          name: 'All responses reviewed',
          passed: approvedCount === totalQuestions,
          details: `${approvedCount} of ${totalQuestions} responses approved or edited`,
        },
        {
          name: 'Word limits met',
          passed: wordLimitPassCount === totalQuestions,
          details: `${wordLimitPassCount} of ${totalQuestions} within word limits`,
        },
        {
          name: 'Quality threshold met',
          passed:
            qualityCheckedCount > 0 &&
            passingQualityCount === qualityCheckedCount,
          details:
            qualityCheckedCount > 0
              ? `${passingQualityCount} of ${qualityCheckedCount} checked responses pass quality threshold`
              : 'No quality checks completed yet',
        },
        {
          name: 'No unsupported claims',
          passed: noUnsupportedClaimsCount === totalQuestions,
          details: `${noUnsupportedClaimsCount} of ${totalQuestions} responses free of unsupported claims`,
        },
        {
          name: 'Has citations',
          passed:
            qualityCheckedCount > 0 &&
            hasCitationsCount === qualityCheckedCount,
          details:
            qualityCheckedCount > 0
              ? `${hasCitationsCount} of ${qualityCheckedCount} checked responses have citations`
              : 'No quality checks completed yet',
        },
        {
          name: 'No critical issues',
          passed: noCriticalIssuesCount === totalQuestions,
          details: `${noCriticalIssuesCount} of ${totalQuestions} responses free of critical issues`,
        },
      ];

      const allCriteriaPassed = criteria.every((c) => c.passed);

      const result: ReadinessResponse = {
        ready: allCriteriaPassed,
        summary: {
          total_questions: totalQuestions,
          answered: answeredCount,
          approved: approvedCount,
          quality_checked: qualityCheckedCount,
          passing_quality: passingQualityCount,
        },
        criteria,
        issues: questionIssues,
      };

      return NextResponse.json(result);
    } catch (err) {
      return NextResponse.json(
        { error: safeErrorMessage(err, 'Failed to compute readiness') },
        { status: 500 },
      );
    }
  },
);
