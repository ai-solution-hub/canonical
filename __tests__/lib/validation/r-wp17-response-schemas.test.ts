/**
 * R-WP17 ResponseSchema constants — ID-32.20.
 *
 * Closes AC-5 (the 37 R-WP17 baseline interfaces resolve to a real Zod
 * `${interface}Schema` constant via Source-A inference) while protecting
 * AC-8 (the schemas validate real handler payloads permissively, never
 * over-strictly).
 *
 * Two contracts under test (test-philosophy §1 — assert observable
 * output, not generator internals):
 *
 *   (1) Each `${interface}Schema` constant is EXPORTED from
 *       `lib/validation/schemas.ts`, `.parse()`-ACCEPTS a representative
 *       valid payload, and REJECTS a clearly-invalid one.
 *
 *   (2) `findSchemaConstant` / `inferSchemaSourceA` resolve the real
 *       `${interface}Schema` identifier (NOT `z.unknown()` / NEEDS_SCHEMA)
 *       for every R-WP17 baseline interface — exercising the actual codemod
 *       lookup against the real on-disk `lib/validation/schemas.ts`.
 *
 * Spec: docs/specs/ast-dataflow-tool/ops-t1-codemod/PRODUCT.md AC-5, AC-8.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { Project } from 'ts-morph';
import { z } from 'zod';

import * as schemas from '@/lib/validation/schemas';
import {
  findSchemaConstant,
  loadBaseline,
} from '@/scripts/codemods/inference-source-a';
import {
  resolveTargets,
  type ResolvedTarget,
} from '@/scripts/codemods/generate-response-schemas';

const REPO_ROOT = process.cwd();
const SCHEMAS_DISK_PATH = resolve(REPO_ROOT, 'lib/validation/schemas.ts');
const SCHEMAS_PROJECT_PATH = '/repo/lib/validation/schemas.ts';

// ── Helpers ──────────────────────────────────────────────────────────────────

function getSchema(name: string): z.ZodTypeAny {
  const entry = (schemas as Record<string, unknown>)[name];
  return entry as z.ZodTypeAny;
}

/**
 * In-memory ts-morph project containing the REAL `lib/validation/schemas.ts`
 * text mounted at the canonical project path the inference module expects.
 * This exercises `findSchemaConstant` exactly as production does.
 */
function projectWithRealSchemas(): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  const realText = readFileSync(SCHEMAS_DISK_PATH, 'utf8');
  project.createSourceFile(SCHEMAS_PROJECT_PATH, realText, { overwrite: true });
  return project;
}

// ── Representative payload fixtures ─────────────────────────────────────────
//
// One valid + one clearly-invalid payload per `${interface}Schema`. Valid
// payloads exercise the required-member shape; invalid payloads violate a
// REQUIRED member's primitive type (the strongest assertion a permissive
// `.loose()` schema still enforces). Grouped by source file per the brief.

interface SchemaCase {
  /** The exported const name (without the trailing `Schema`-less form). */
  schema: string;
  valid: unknown;
  invalid: unknown;
}

const CASES_BY_GROUP: Record<string, SchemaCase[]> = {
  'types/change-reports.ts (renamed from types/digest.ts)': [
    {
      schema: 'ChangeReportGenerateResponseSchema',
      valid: {
        digest: {
          id: 'r1',
          frequency: 'weekly',
          period_start: '2026-05-01',
          period_end: '2026-05-08',
          item_count: 3,
          domain_summaries: [],
          narrative_summary: null,
          generated_at: '2026-05-08T00:00:00.000Z',
          generated_by: 'system',
          tokens_used: null,
          created_at: '2026-05-08T00:00:00.000Z',
        },
      },
      invalid: { digest: 'not-an-object' },
    },
  ],
  'types/intelligence-refinement.ts': [
    {
      schema: 'RescoringPreviewResponseSchema',
      valid: {
        samples: 5,
        mean_delta: 0.2,
        improved: 3,
        regressed: 1,
        results: [],
      },
      invalid: {
        samples: 'five',
        mean_delta: 0,
        improved: 0,
        regressed: 0,
        results: [],
      },
    },
    {
      schema: 'ResolveFlagsResponseSchema',
      valid: { resolved_count: 2, requested_count: 3 },
      invalid: { resolved_count: 'two', requested_count: 3 },
    },
    {
      schema: 'AnalyseFlagsResponseSchema',
      valid: {
        summary: 's',
        falsePositivePatterns: [],
        falseNegativePatterns: [],
        recommendations: [],
        proposedPromptText: 'p',
        confidenceNotes: 'c',
        analysedFlagCount: 0,
        truncated: false,
      },
      invalid: {
        summary: 's',
        falsePositivePatterns: [],
        falseNegativePatterns: [],
        recommendations: [],
        proposedPromptText: 'p',
        confidenceNotes: 'c',
        analysedFlagCount: 0,
        truncated: 'no',
      },
    },
  ],
  'types/review.ts': [
    {
      schema: 'ReviewQueueResponseSchema',
      valid: {
        items: [],
        total: 0,
        verified_count: 0,
        flagged_count: 0,
        has_more: false,
      },
      invalid: {
        items: 'nope',
        total: 0,
        verified_count: 0,
        flagged_count: 0,
        has_more: false,
      },
    },
    {
      schema: 'ReviewStatsResponseSchema',
      valid: {
        total: 1,
        verified: 1,
        flagged: 0,
        unverified: 0,
        draft: 0,
        overdue: 0,
        awaiting_publication: 0,
        by_domain: {},
        by_content_type: {},
        by_source_file: {},
        by_source_document: {},
      },
      invalid: {
        total: 1,
        verified: 1,
        flagged: 0,
        unverified: 0,
        draft: 0,
        overdue: 0,
        awaiting_publication: 0,
        by_domain: 'not-a-record',
        by_content_type: {},
        by_source_file: {},
        by_source_document: {},
      },
    },
  ],
  'lib/query/fetchers.ts': [
    {
      schema: 'DedupQueueResponseSchema',
      valid: { items: [], hasMore: false, nextCursor: null },
      invalid: { items: {}, hasMore: false, nextCursor: null },
    },
    {
      schema: 'DedupItemResponseSchema',
      valid: {
        subject: {
          id: 'i1',
          title: null,
          content: null,
          dedup_status: 'pending',
          created_at: '2026-05-01',
          primary_domain: null,
          content_owner_id: null,
          ingest_source: null,
          superseded_by: null,
          publication_status: 'draft',
          metadata: null,
        },
        canonical: null,
        similarity: 0.9,
      },
      invalid: {
        subject: {
          id: 'i1',
          title: null,
          content: null,
          dedup_status: 'pending',
          created_at: '2026-05-01',
          primary_domain: null,
          content_owner_id: null,
          ingest_source: null,
          superseded_by: null,
          publication_status: 'draft',
          metadata: null,
        },
        canonical: null,
        similarity: 'high',
      },
    },
    {
      schema: 'NearDupPairsResponseSchema',
      valid: { pairs: [], threshold: 0.8, total: 0 },
      invalid: { pairs: [], threshold: 'high', total: 0 },
    },
    {
      schema: 'NearDupMergeResultSchema',
      valid: {
        pairId: 'p1',
        oldId: 'o1',
        newId: 'n1',
        dedup_status: 'superseded',
      },
      invalid: {
        pairId: 'p1',
        oldId: 'o1',
        newId: 'n1',
        dedup_status: 'something-else',
      },
    },
    {
      schema: 'NearDupConfirmUniqueResultSchema',
      valid: {
        pairId: 'p1',
        leftDedupStatus: 'confirmed_unique',
        rightDedupStatus: 'confirmed_unique',
      },
      invalid: {
        pairId: 'p1',
        leftDedupStatus: 'maybe',
        rightDedupStatus: 'confirmed_unique',
      },
    },
    {
      schema: 'TaxonomySyncStatusSchema',
      valid: {
        in_sync: true,
        last_sync_at: null,
        current_hash: 'abc',
        synced_hash: null,
      },
      invalid: {
        in_sync: 'yes',
        last_sync_at: null,
        current_hash: 'abc',
        synced_hash: null,
      },
    },
    {
      schema: 'PipelineRunRowSchema',
      valid: {
        id: 'run1',
        pipeline_name: 'markdown_batch',
        status: 'running',
        progress: null,
        source_filename: null,
        items_created: null,
        items_processed: null,
        workspace_id: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: null,
        created_by: null,
        result: { anything: true },
      },
      invalid: {
        id: 'run1',
        pipeline_name: 'markdown_batch',
        status: 'not-a-real-status',
        progress: null,
        source_filename: null,
        items_created: null,
        items_processed: null,
        workspace_id: null,
        error_message: null,
        started_at: null,
        completed_at: null,
        created_at: null,
        created_by: null,
        result: null,
      },
    },
    {
      schema: 'NearDupPairDetailSchema',
      valid: {
        left: {
          id: 'l',
          title: null,
          content: null,
          dedup_status: 'pending',
          created_at: '2026-05-01',
          primary_domain: null,
          content_type: null,
          content_owner_id: null,
          ingest_source: null,
          superseded_by: null,
          archived_at: null,
          publication_status: 'draft',
        },
        right: {
          id: 'r',
          title: null,
          content: null,
          dedup_status: 'pending',
          created_at: '2026-05-01',
          primary_domain: null,
          content_type: null,
          content_owner_id: null,
          ingest_source: null,
          superseded_by: null,
          archived_at: null,
          publication_status: 'draft',
        },
        similarity: 0.95,
      },
      invalid: { left: 'nope', right: 'nope', similarity: 0.95 },
    },
  ],
  'app/api/admin/pipeline-runs/recent/route.ts': [
    {
      schema: 'PipelineRunsRecentResponseSchema',
      valid: {
        windowHours: 24,
        generatedAt: '2026-05-08T00:00:00.000Z',
        summaries: [],
        totalRuns: 0,
        totalFailures: 0,
        hasAnyFailures: false,
      },
      invalid: {
        windowHours: '24',
        generatedAt: '2026-05-08T00:00:00.000Z',
        summaries: [],
        totalRuns: 0,
        totalFailures: 0,
        hasAnyFailures: false,
      },
    },
  ],
  'hooks/* (general)': [
    {
      schema: 'BatchCreateResultSchema',
      valid: {
        created: 1,
        failed: 0,
        items: [],
        pipeline_run_id: null,
        batch_id: 'b1',
      },
      invalid: {
        created: 1,
        failed: 0,
        items: 'none',
        pipeline_run_id: null,
        batch_id: 'b1',
      },
    },
    {
      schema: 'TargetsResponseSchema',
      valid: { targets: [] },
      invalid: { targets: 'none' },
    },
    {
      schema: 'SendToReviewResultSchema',
      valid: {
        sent: 1,
        already_pending: 0,
        skipped_draft: 0,
        review_url: '/review',
      },
      invalid: {
        sent: 'one',
        already_pending: 0,
        skipped_draft: 0,
        review_url: '/review',
      },
    },
    {
      schema: 'EntityDetailSchema',
      valid: {
        canonical_name: 'Acme',
        entity_type: 'org',
        effective_type: 'org',
        has_type_override: false,
        mention_count: 2,
        variant_names: [],
        variant_count: 0,
        types_seen: [],
        has_type_conflict: false,
        content_items: [],
        content_item_count: 0,
        relationships: [],
        relationship_count: 0,
      },
      invalid: {
        canonical_name: 'Acme',
        entity_type: 'org',
        effective_type: 'org',
        has_type_override: false,
        mention_count: 'two',
        variant_names: [],
        variant_count: 0,
        types_seen: [],
        has_type_conflict: false,
        content_items: [],
        content_item_count: 0,
        relationships: [],
        relationship_count: 0,
      },
    },
    {
      schema: 'NotificationsResponseSchema',
      valid: { notifications: [], unreadCount: 0 },
      invalid: { notifications: {}, unreadCount: 0 },
    },
    {
      schema: 'MutationResultSchema',
      valid: { affected: 3 },
      invalid: { affected: 'three' },
    },
  ],
  'components/review/publication-review-action-bar.tsx': [
    {
      schema: 'PatchResponseSchema',
      valid: {
        success: true,
        previousStatus: 'in_review',
        newStatus: 'published',
        transition: 'approve',
      },
      invalid: {
        success: 'yes',
        previousStatus: 'in_review',
        newStatus: 'published',
        transition: 'approve',
      },
    },
  ],
  'hooks/procurement/use-procurement-readiness.ts (renamed from hooks/bid/use-bid-readiness.ts)':
    [
      {
        schema: 'ReadinessDataSchema',
        valid: {
          ready: true,
          summary: {
            total_questions: 5,
            answered: 5,
            approved: 5,
            quality_checked: 5,
            passing_quality: 5,
          },
          criteria: [],
          issues: [],
        },
        invalid: {
          ready: 'yes',
          summary: {
            total_questions: 5,
            answered: 5,
            approved: 5,
            quality_checked: 5,
            passing_quality: 5,
          },
          criteria: [],
          issues: [],
        },
      },
    ],
  'hooks/streaming/use-stream-coordination.ts (BidResponse → ProcurementResponse)':
    [
      {
        schema: 'ProcurementResponseSchema',
        valid: {
          id: 'r1',
          question_id: 'q1',
          response_text: null,
          response_text_advanced: null,
          version: 1,
          citations: [],
          source_content: [],
          quality_check: null,
          review_status: 'draft',
          question: {
            question_text: 'q',
            word_limit: null,
            section_name: null,
            confidence_posture: null,
          },
        },
        invalid: {
          id: 'r1',
          question_id: 'q1',
          response_text: null,
          response_text_advanced: null,
          version: 'one',
          citations: [],
          source_content: [],
          quality_check: null,
          review_status: 'draft',
          question: {
            question_text: 'q',
            word_limit: null,
            section_name: null,
            confidence_posture: null,
          },
        },
      },
    ],
  'hooks/intelligence/*': [
    {
      schema: 'CompanyProfileSchema',
      valid: {
        id: 'c1',
        name: 'Acme',
        slug: 'acme',
        description: null,
        website_url: null,
        sectors: [],
        services: [],
        certifications: [],
        geographic_scope: [],
        competitors: [],
        target_customers: null,
        value_proposition: null,
        key_topics: [],
        is_active: true,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
      invalid: {
        id: 'c1',
        name: 'Acme',
        slug: 'acme',
        description: null,
        website_url: null,
        sectors: 'none',
        services: [],
        certifications: [],
        geographic_scope: [],
        competitors: [],
        target_customers: null,
        value_proposition: null,
        key_topics: [],
        is_active: true,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
    },
    {
      schema: 'ArticlesResponseSchema',
      valid: { articles: [], total: 0, page: 1, limit: 20 },
      invalid: { articles: [], total: 0, page: 'one', limit: 20 },
    },
    {
      schema: 'FeedFlagSchema',
      valid: {
        id: 'f1',
        feed_article_id: 'a1',
        flag_type: 'false_positive',
        flagged_by: 'u1',
        notes: null,
        resolved: false,
        resolved_at: null,
        prompt_version_id: null,
        created_at: '2026-05-01',
      },
      invalid: {
        id: 'f1',
        feed_article_id: 'a1',
        flag_type: 'totally_wrong',
        flagged_by: 'u1',
        notes: null,
        resolved: false,
        resolved_at: null,
        prompt_version_id: null,
        created_at: '2026-05-01',
      },
    },
    {
      schema: 'FeedPromptSchema',
      valid: {
        id: 'p1',
        workspace_id: 'w1',
        version: 1,
        prompt_text: 'hi',
        is_active: true,
        performance_snapshot: null,
        change_notes: null,
        created_at: '2026-05-01',
        created_by: null,
      },
      invalid: {
        id: 'p1',
        workspace_id: 'w1',
        version: 'one',
        prompt_text: 'hi',
        is_active: true,
        performance_snapshot: null,
        change_notes: null,
        created_at: '2026-05-01',
        created_by: null,
      },
    },
    {
      schema: 'CreateFeedSourceResponseSchema',
      valid: {
        id: 's1',
        workspace_id: 'w1',
        name: 'feed',
        url: 'https://example.com/rss',
        polling_interval_minutes: 60,
        is_active: true,
        last_polled_at: null,
        last_status: null,
        consecutive_failures: 0,
        etag: null,
        last_modified: null,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
      invalid: {
        id: 's1',
        workspace_id: 'w1',
        name: 'feed',
        url: 'https://example.com/rss',
        polling_interval_minutes: 'sixty',
        is_active: true,
        last_polled_at: null,
        last_status: null,
        consecutive_failures: 0,
        etag: null,
        last_modified: null,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
    },
    {
      schema: 'FeedSourceSchema',
      valid: {
        id: 's1',
        workspace_id: 'w1',
        name: 'feed',
        url: 'https://example.com/rss',
        polling_interval_minutes: 60,
        is_active: true,
        last_polled_at: null,
        last_status: null,
        consecutive_failures: 0,
        etag: null,
        last_modified: null,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
      invalid: {
        id: 123,
        workspace_id: 'w1',
        name: 'feed',
        url: 'https://example.com/rss',
        polling_interval_minutes: 60,
        is_active: true,
        last_polled_at: null,
        last_status: null,
        consecutive_failures: 0,
        etag: null,
        last_modified: null,
        created_by: null,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
    },
    {
      schema: 'TestPollResultSchema',
      valid: { success: true, itemCount: 3, sampleTitles: [] },
      invalid: { success: true, itemCount: 'three', sampleTitles: [] },
    },
    {
      schema: 'MetricsSummarySchema',
      valid: {
        total_articles: 10,
        passed_articles: 5,
        filtered_articles: 5,
        filter_ratio: 0.5,
        total_flags: 0,
        false_positive_flags: 0,
        false_negative_flags: 0,
        unresolved_flags: 0,
        last_poll_time: null,
        active_sources: 1,
        sources_with_errors: 0,
        recent_flags: [],
        period: '7d',
      },
      invalid: {
        total_articles: 'ten',
        passed_articles: 5,
        filtered_articles: 5,
        filter_ratio: 0.5,
        total_flags: 0,
        false_positive_flags: 0,
        false_negative_flags: 0,
        unresolved_flags: 0,
        last_poll_time: null,
        active_sources: 1,
        sources_with_errors: 0,
        recent_flags: [],
        period: '7d',
      },
    },
    {
      schema: 'IntelligenceWorkspaceSchema',
      valid: {
        id: 'w1',
        name: 'Sector intel',
        description: null,
        application_type_id: 'app1',
        company_profile_id: null,
        guide_id: null,
        relevance_threshold: null,
        domain_metadata: { anything: true },
        is_archived: false,
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
      invalid: {
        id: 'w1',
        name: 'Sector intel',
        description: null,
        application_type_id: 'app1',
        company_profile_id: null,
        guide_id: null,
        relevance_threshold: null,
        domain_metadata: { anything: true },
        is_archived: 'no',
        created_at: '2026-05-01',
        updated_at: '2026-05-01',
      },
    },
    {
      schema: 'SeedStarterPackResultSchema',
      valid: {
        starter_pack_id: 'sp1',
        starter_pack_name: 'UK Gov',
        seeded: [],
        skipped_existing: [],
        failed: [],
      },
      invalid: {
        starter_pack_id: 'sp1',
        starter_pack_name: 'UK Gov',
        seeded: 'none',
        skipped_existing: [],
        failed: [],
      },
    },
    {
      schema: 'TriggerPollResponseSchema',
      valid: {
        success: true,
        runId: 'run1',
        startedAt: '2026-05-01T00:00:00.000Z',
        completedAt: '2026-05-01T00:01:00.000Z',
        sourcesProcessed: 2,
        totalArticlesFound: 10,
        totalArticlesNew: 4,
        totalArticlesPassed: 3,
        errors: [],
      },
      invalid: {
        success: true,
        runId: 'run1',
        startedAt: '2026-05-01T00:00:00.000Z',
        completedAt: '2026-05-01T00:01:00.000Z',
        sourcesProcessed: 'two',
        totalArticlesFound: 10,
        totalArticlesNew: 4,
        totalArticlesPassed: 3,
        errors: [],
      },
    },
    {
      schema: 'WorkspaceHealthResponseSchema',
      valid: {
        pipeline: {
          lastSuccessfulRun: null,
          timeSinceLastRunMs: null,
          sourcesWithFailures: 0,
          sourcesAtFailureLimit: 0,
          totalActiveSources: 1,
          healthy: true,
          statusMessage: 'ok',
        },
        sources: {
          workspaceId: 'w1',
          sources: [],
          healthySources: 1,
          failingSources: 0,
          disabledSources: 0,
        },
      },
      invalid: {
        pipeline: 'not-an-object',
        sources: {
          workspaceId: 'w1',
          sources: [],
          healthySources: 1,
          failingSources: 0,
          disabledSources: 0,
        },
      },
    },
    {
      schema: 'AssignmentsResponseSchema',
      valid: { assignments: [] },
      invalid: { assignments: 'none' },
    },
  ],
};

const ALL_CASES = Object.values(CASES_BY_GROUP).flat();

// ── Contract 1: schema presence + parse accept/reject ───────────────────────

describe('R-WP17 ResponseSchema constants — presence + parse (AC-5/AC-8)', () => {
  for (const [group, cases] of Object.entries(CASES_BY_GROUP)) {
    describe(group, () => {
      for (const c of cases) {
        it(`${c.schema} is exported and is a Zod schema`, () => {
          const schema = getSchema(c.schema);
          expect(schema, `${c.schema} must be exported`).toBeDefined();
          expect(typeof (schema as { safeParse?: unknown }).safeParse).toBe(
            'function',
          );
        });

        if (c.valid !== undefined) {
          it(`${c.schema} accepts a representative valid payload`, () => {
            const schema = getSchema(c.schema);
            const result = schema.safeParse(c.valid);
            expect(
              result.success,
              result.success
                ? ''
                : JSON.stringify(
                    (result as { error: z.ZodError }).error.issues,
                    null,
                    2,
                  ),
            ).toBe(true);
          });
        }

        if (c.invalid !== undefined) {
          it(`${c.schema} rejects a clearly-invalid payload`, () => {
            const schema = getSchema(c.schema);
            expect(schema.safeParse(c.invalid).success).toBe(false);
          });
        }
      }
    });
  }

  it('every R-WP17 schema named in the case table is exported', () => {
    for (const c of ALL_CASES) {
      expect(
        getSchema(c.schema),
        `${c.schema} missing from lib/validation/schemas.ts`,
      ).toBeDefined();
    }
  });
});

// ── Contract 2: Source-A findSchemaConstant resolves the real schema ────────

describe('Source-A findSchemaConstant resolves R-WP17 schemas (AC-5)', () => {
  const baseline = loadBaseline();
  const targets: ResolvedTarget[] = resolveTargets(baseline);

  it('baseline has 37 entries', () => {
    expect(baseline.length).toBe(37);
  });

  it('resolves a real ${interface}Schema for every baseline interface — never null', () => {
    const project = projectWithRealSchemas();
    const unresolved: string[] = [];
    for (const t of targets) {
      const found = findSchemaConstant(t.name, project, SCHEMAS_PROJECT_PATH);
      if (found !== `${t.name}Schema`) {
        unresolved.push(`${t.name} → ${String(found)}`);
      }
    }
    expect(
      unresolved,
      `These baseline interfaces did not resolve to their real schema: ${unresolved.join(
        ', ',
      )}`,
    ).toEqual([]);
  });

  it('findSchemaConstant returns null for a non-existent interface (negative control)', () => {
    const project = projectWithRealSchemas();
    expect(
      findSchemaConstant(
        'TotallyMadeUpInterfaceXyz',
        project,
        SCHEMAS_PROJECT_PATH,
      ),
    ).toBeNull();
  });
});
