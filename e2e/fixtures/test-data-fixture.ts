/* eslint-disable @typescript-eslint/no-empty-object-type -- Playwright fixture API requires {} for test-scoped type parameter */
import { test as base } from '@playwright/test';
import { createServiceClient } from './supabase';

/**
 * Schema compatibility: migrations up to 20260310
 * If tests fail after a migration, update the seed data here.
 *
 * Phase 1 expansion (S75): full 12-item core dataset, 3 workspaces,
 * 4 bid questions, 2 bid responses, workspace-item assignments,
 * notifications, read marks. Bid advanced to drafting state.
 */

/**
 * Per-worker test data seeded before tests and cleaned up after.
 * Each worker gets its own isolated dataset identified by a unique prefix.
 */
export interface WorkerData {
  /** IDs of all seeded content items (12 items). */
  contentItemIds: string[];
  /** ID of the article content item ("IT Support Policy"). */
  articleId: string;
  /** ID of the first Q&A pair ("What is your SLA?"). */
  qaPairId: string;
  /** ID of the second Q&A pair ("Project Management Approach") — different domain, has answer_advanced. */
  qaPairTechId: string;
  /** ID of the note content item ("Test Note" — now "Pricing Model Template"). */
  noteId: string;
  /** ID of the stale content item ("Cyber Essentials Compliance"). */
  staleItemId: string;
  /** ID of the expired content item ("Pricing Model Template"). */
  expiredItemId: string;
  /** ID of the certification item ("ISO 27001 Certification"). */
  certificationId: string;
  /** ID of the case study item ("Case Study: NHS Digital"). */
  caseStudyId: string;
  /** ID of the methodology item ("Cloud Migration Methodology"). */
  methodologyId: string;
  /** ID of the Social Value Framework policy (aging). */
  socialValueId: string;
  /** ID of the Data Protection Policy (regulation). */
  dataProtectionId: string;
  /** ID of the Environmental Policy (aging). */
  environmentalId: string;
  /** ID of the seeded kb_section workspace. */
  workspaceId: string;
  /** ID of the seeded bid workspace (advanced to drafting). */
  bidId: string;
  /** ID of the seeded project workspace. */
  projectId: string;
  /** IDs of the 4 seeded bid questions (Technical, Experience, Social Value, Commercial). */
  questionIds: string[];
  /** IDs of the 2 seeded bid responses (approved, draft). */
  responseIds: string[];
  /** IDs of the 2 seeded notifications. */
  notificationIds: string[];
  /** Worker-unique prefix (e.g. "[E2E-W0]") for data isolation. */
  prefix: string;
}

/**
 * Extended test with a worker-scoped `workerData` fixture.
 *
 * Each Playwright worker seeds its own isolated set of test data using a
 * unique prefix like `[E2E-W0]`. Data is cleaned up automatically when
 * the worker finishes.
 *
 * Seeded entities:
 * - 12 content items (article, 2 q_a_pairs, certification, case_study,
 *   methodology, 4 policies, note) across 7 domains
 * - 3 workspaces (kb_section, bid, project)
 * - 1 bid with 4 questions and 2 responses, advanced to drafting state
 * - 4 workspace-item assignments (items 1-4 → kb_section)
 * - 2 notifications (freshness_alert + governance_review)
 * - 2 read marks (admin user)
 */
export const test = base.extend<{}, { workerData: WorkerData }>({
  workerData: [
    async ({}, use, workerInfo) => {
      const supabase = createServiceClient();
      const prefix = `[E2E-W${workerInfo.workerIndex}]`;

      // --- Seed per-worker data ---

      // Timestamps for freshness testing — set in the past to prevent
      // freshness recalculation from overwriting values to 'fresh'.
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString();
      const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
      const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000).toISOString();

      const contentItems = [
        // [0] Article — Service Delivery (ai_summary, progressive depth layers)
        {
          title: `${prefix} IT Support Policy`,
          content_type: 'article' as const,
          primary_domain: 'Service Delivery',
          ai_summary: 'E2E test article about IT support policies and procedures.',
          platform: 'manual' as const,
          source_url: 'https://e2e-test.example.com/it-support',
          content: 'This is an E2E test content item covering IT support policies.',
          brief: 'IT support policy overview covering response times and escalation procedures.',
          detail: 'Our IT support policy defines tiered response times: P1 critical issues receive a 15-minute response, P2 high-priority issues within 1 hour, and P3 standard issues within 4 hours. The policy covers escalation procedures, on-call rotations, and service desk operating hours.',
          reference: 'Full IT Support Policy v3.2 — includes appendices on ITIL alignment, service catalogue definitions, and change management procedures. Approved by the IT Director on 15 January 2026. Next review due July 2026.',
        },
        // [1] Q&A pair — Service Delivery (answer_standard only)
        {
          title: `${prefix} What is your SLA?`,
          content_type: 'q_a_pair' as const,
          primary_domain: 'Service Delivery',
          ai_summary: 'Q&A pair about service level agreements.',
          platform: 'manual' as const,
          content:
            'Q: What is your SLA?\nA: We provide tiered SLAs with 15-minute P1 response.',
          answer_standard:
            'We provide tiered SLAs with 15-minute P1 response, 1-hour P2 response, and 4-hour P3 response.',
        },
        // [2] Q&A pair — Technical Capability (both answer fields)
        {
          title: `${prefix} Project Management Approach`,
          content_type: 'q_a_pair' as const,
          primary_domain: 'Technical Capability',
          ai_summary: 'Q&A pair about project management methodology and governance.',
          platform: 'manual' as const,
          content:
            'Q: Describe your project management approach.\nA: We follow PRINCE2 with agile delivery sprints.',
          answer_standard:
            'We follow PRINCE2 methodology adapted for agile delivery, with dedicated project managers for each engagement and weekly governance reporting.',
          answer_advanced:
            'Our project management framework combines PRINCE2 governance with agile delivery sprints. Each project has a dedicated PRINCE2 Practitioner as project manager, supported by a PMO that provides cross-project oversight. We use weekly RAG status reporting, monthly steering committees, and quarterly programme boards. Our methodology includes mandatory stage-gate reviews, risk registers maintained in real-time, and benefits realisation tracking throughout the project lifecycle and into BAU.',
        },
        // [3] Policy — Security & Compliance (stale, regulation)
        {
          title: `${prefix} Cyber Essentials Compliance`,
          content_type: 'policy' as const,
          primary_domain: 'Security & Compliance',
          ai_summary: 'Policy document covering Cyber Essentials certification requirements.',
          platform: 'manual' as const,
          content:
            'This policy outlines our approach to maintaining Cyber Essentials Plus certification, including annual reassessment procedures and remediation workflows.',
          freshness: 'stale' as const,
          freshness_checked_at: thirtyDaysAgo,
          lifecycle_type: 'regulation' as const,
        },
        // [4] Note — Commercial (expired, date_bound)
        {
          title: `${prefix} Pricing Model Template`,
          content_type: 'note' as const,
          primary_domain: 'Commercial',
          ai_summary: 'Template for pricing model breakdowns in bid responses.',
          platform: 'manual' as const,
          content:
            'Standard pricing model template: Day rates, fixed-price deliverables, managed service charges, and optional extras.',
          freshness: 'expired' as const,
          freshness_checked_at: ninetyDaysAgo,
          lifecycle_type: 'date_bound' as const,
          expiry_date: new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0],
        },
        // [5] Certification — Security & Compliance (fresh, verified_at set)
        {
          title: `${prefix} ISO 27001 Certification`,
          content_type: 'certification' as const,
          primary_domain: 'Security & Compliance',
          ai_summary: 'ISO 27001 information security management system certification details.',
          platform: 'manual' as const,
          content:
            'We hold ISO 27001:2022 certification for our information security management system, covering all managed service operations. Certificate number: IS 12345. Certified by BSI. Valid until December 2027.',
          freshness: 'fresh' as const,
          verified_at: new Date().toISOString(),
        },
        // [6] Case Study — Experience & Track Record (ai_summary, metadata)
        {
          title: `${prefix} Case Study: NHS Digital`,
          content_type: 'case_study' as const,
          primary_domain: 'Experience & Track Record',
          ai_summary: 'Case study demonstrating NHS Digital infrastructure modernisation project delivery.',
          platform: 'manual' as const,
          content:
            'NHS Digital engaged us to modernise their legacy IT infrastructure across 12 sites. The project delivered a cloud-first architecture, reducing operational costs by 35% and improving system availability from 97.5% to 99.95%. Delivered on time and within budget over 18 months.',
          metadata: {
            client: 'NHS Digital',
            value: '2.4M',
            duration: '18 months',
            sector: 'Healthcare',
          },
        },
        // [7] Methodology — Technical Capability
        {
          title: `${prefix} Cloud Migration Methodology`,
          content_type: 'methodology' as const,
          primary_domain: 'Technical Capability',
          ai_summary: 'Our structured approach to cloud migration using the 6R framework.',
          platform: 'manual' as const,
          content:
            'Our cloud migration methodology follows the 6R framework (Rehost, Replatform, Repurchase, Refactor, Retain, Retire). Each migration begins with a discovery phase to assess application dependencies, followed by a proof of concept, pilot migration, and full rollout with rollback procedures.',
        },
        // [8] Policy — Social Value (aging)
        {
          title: `${prefix} Social Value Framework`,
          content_type: 'policy' as const,
          primary_domain: 'Social Value',
          ai_summary: 'Framework for delivering social value through public sector contracts.',
          platform: 'manual' as const,
          content:
            'Our Social Value Framework aligns with the Social Value Act 2012 and the PPN 06/20 Social Value Model. We commit to local employment, apprenticeships, environmental sustainability, and community engagement on every public sector contract.',
          freshness: 'aging' as const,
          freshness_checked_at: sixtyDaysAgo,
        },
        // [9] Policy — Security & Compliance (regulation)
        {
          title: `${prefix} Data Protection Policy`,
          content_type: 'policy' as const,
          primary_domain: 'Security & Compliance',
          ai_summary: 'Data protection policy covering GDPR compliance and data handling procedures.',
          platform: 'manual' as const,
          content:
            'This policy sets out our approach to data protection in compliance with UK GDPR and the Data Protection Act 2018. It covers data processing principles, lawful bases for processing, data subject rights, breach notification procedures, and international transfer safeguards.',
          lifecycle_type: 'regulation' as const,
        },
        // [10] Other — People & Skills
        {
          title: `${prefix} Staff CVs and Experience`,
          content_type: 'other' as const,
          primary_domain: 'People & Skills',
          ai_summary: 'Overview of key staff qualifications and experience for bid submissions.',
          platform: 'manual' as const,
          content:
            'Our team includes 45 certified engineers across ITIL, PRINCE2, AWS, Azure, and Cisco disciplines. Key personnel have an average of 12 years public sector IT experience.',
        },
        // [11] Policy — Sustainability (aging)
        {
          title: `${prefix} Environmental Policy`,
          content_type: 'policy' as const,
          primary_domain: 'Sustainability',
          ai_summary: 'Environmental policy covering carbon reduction and sustainable operations.',
          platform: 'manual' as const,
          content:
            'We are committed to achieving net zero carbon emissions by 2030. Our environmental policy covers energy efficiency in data centres, sustainable procurement, waste reduction, and carbon offset programmes. We report annually against the GHG Protocol Scope 1-3 framework.',
          freshness: 'aging' as const,
          freshness_checked_at: sixtyDaysAgo,
        },
      ];

      const { data: items } = await supabase
        .from('content_items')
        .insert(contentItems)
        .select('id')
        .throwOnError();

      const itemIds = (items ?? []).map((i) => i.id);

      // --- Workspaces: kb_section, bid, project ---

      const { data: workspaces } = await supabase
        .from('workspaces')
        .insert([
          {
            name: `${prefix} Test KB Section`,
            description: 'E2E worker-scoped KB section workspace.',
            type: 'kb_section',
          },
          {
            name: `${prefix} IT Support Services`,
            description: 'E2E worker-scoped bid.',
            type: 'bid',
            domain_metadata: {
              buyer: 'E2E Test Corp',
              status: 'draft',
              deadline: new Date(Date.now() + 14 * 86400000)
                .toISOString()
                .split('T')[0],
            },
          },
          {
            name: `${prefix} Cloud Migration Project`,
            description: 'E2E worker-scoped project workspace.',
            type: 'project',
          },
        ])
        .select('id')
        .throwOnError();

      const workspaceIds = (workspaces ?? []).map((w) => w.id);
      const kbSectionId = workspaceIds[0];
      const bidId = workspaceIds[1];
      const projectId = workspaceIds[2];

      // --- Workspace-item assignments: link items 0-3 to kb_section ---

      const junctionRecords = itemIds.slice(0, 4).map((contentItemId) => ({
        content_item_id: contentItemId,
        workspace_id: kbSectionId,
      }));

      await supabase
        .from('content_item_workspaces')
        .insert(junctionRecords)
        .throwOnError();

      // --- Bid questions: 4 questions ---

      const questions = [
        {
          project_id: bidId,
          section_name: 'Technical',
          section_sequence: 1,
          question_sequence: 1,
          question_text: 'Describe your approach to providing IT support services.',
          word_limit: 500,
        },
        {
          project_id: bidId,
          section_name: 'Experience',
          section_sequence: 2,
          question_sequence: 1,
          question_text:
            'What experience does your organisation have in public sector IT?',
          word_limit: 400,
        },
        {
          project_id: bidId,
          section_name: 'Social Value',
          section_sequence: 3,
          question_sequence: 1,
          question_text:
            'How will you deliver social value through this contract?',
          word_limit: 300,
        },
        {
          project_id: bidId,
          section_name: 'Commercial',
          section_sequence: 4,
          question_sequence: 1,
          question_text:
            'Provide your pricing model breakdown including day rates and fixed-price options.',
          word_limit: 600,
        },
      ];

      const { data: qs } = await supabase
        .from('bid_questions')
        .insert(questions)
        .select('id')
        .throwOnError();

      const questionIds = (qs ?? []).map((q) => q.id);

      // --- Bid responses: 1 approved, 1 draft ---

      const responses = [
        {
          question_id: questionIds[0],
          response_text:
            'Our IT support approach combines proactive monitoring with a dedicated service desk operating 24/7. We use ITIL-aligned processes with automated ticket routing, SLA-driven escalation, and root cause analysis for recurring incidents. Our team of 45 certified engineers provides L1-L3 support across all major platforms.',
          review_status: 'approved',
          version: 1,
        },
        {
          question_id: questionIds[1],
          response_text:
            'We have delivered IT services to over 30 public sector organisations including NHS trusts, local authorities, and central government departments. Notable contracts include a 5-year managed service for a London borough and infrastructure modernisation for an NHS integrated care board.',
          review_status: 'draft',
          version: 1,
        },
      ];

      const { data: resps } = await supabase
        .from('bid_responses')
        .insert(responses)
        .select('id')
        .throwOnError();

      const responseIds = (resps ?? []).map((r) => r.id);

      // --- Advance bid to drafting state ---
      // State machine requires sequential transitions:
      // draft → questions_extracted → matching → drafting
      const bidStateTransitions = [
        'questions_extracted',
        'matching',
        'drafting',
      ];

      for (const state of bidStateTransitions) {
        // Read current domain_metadata, then update status
        const { data: current } = await supabase
          .from('workspaces')
          .select('domain_metadata')
          .eq('id', bidId)
          .single()
          .throwOnError();

        const currentMetadata =
          (current?.domain_metadata as Record<string, unknown>) ?? {};

        await supabase
          .from('workspaces')
          .update({
            domain_metadata: { ...currentMetadata, status: state },
          })
          .eq('id', bidId)
          .throwOnError();
      }

      // --- Notifications and read marks require admin user_id ---
      // Look up the admin user by email from auth.users via user_roles
      const { data: adminRole } = await supabase
        .from('user_roles')
        .select('user_id')
        .eq('role', 'admin')
        .limit(1)
        .single();

      const adminUserId = adminRole?.user_id;

      let notificationIds: string[] = [];
      if (adminUserId) {
        // --- Notifications: 1 unread freshness alert, 1 read governance review ---
        const notifications = [
          {
            user_id: adminUserId,
            type: 'freshness_alert',
            entity_type: 'content_item',
            entity_id: itemIds[3], // stale item (Cyber Essentials)
            title: `${prefix} Content needs review`,
            message: 'This content item has become stale and requires review.',
          },
          {
            user_id: adminUserId,
            type: 'governance_review',
            entity_type: 'content_item',
            entity_id: itemIds[4], // expired item (Pricing Model)
            title: `${prefix} Item expired`,
            message: 'This content item has expired and should be updated or archived.',
            read_at: new Date().toISOString(),
          },
        ];

        const { data: notifs } = await supabase
          .from('notifications')
          .insert(notifications)
          .select('id')
          .throwOnError();

        notificationIds = (notifs ?? []).map((n) => n.id);

        // --- Read marks: 2 items marked as read by admin ---
        const readMarks = [
          {
            user_id: adminUserId,
            content_item_id: itemIds[0], // article (IT Support Policy)
            source: 'detail_view',
          },
          {
            user_id: adminUserId,
            content_item_id: itemIds[1], // Q&A pair (What is your SLA?)
            source: 'browse',
          },
        ];

        await supabase
          .from('read_marks')
          .insert(readMarks)
          .throwOnError();
      }

      const data: WorkerData = {
        contentItemIds: itemIds,
        articleId: itemIds[0],
        qaPairId: itemIds[1],
        qaPairTechId: itemIds[2],
        noteId: itemIds[4], // Pricing Model Template (note type)
        staleItemId: itemIds[3],
        expiredItemId: itemIds[4],
        certificationId: itemIds[5],
        caseStudyId: itemIds[6],
        methodologyId: itemIds[7],
        socialValueId: itemIds[8],
        dataProtectionId: itemIds[9],
        environmentalId: itemIds[11],
        workspaceId: kbSectionId,
        bidId,
        projectId,
        questionIds,
        responseIds,
        notificationIds,
        prefix,
      };

      console.log(
        `[Worker ${workerInfo.workerIndex}] Seeded: ${data.contentItemIds.length} items, ` +
          `3 workspaces, 1 bid (drafting) with ${data.questionIds.length} questions and ` +
          `${data.responseIds.length} responses, ${data.notificationIds.length} notifications ` +
          `(prefix: ${prefix})`,
      );

      await use(data);

      // --- Teardown: clean up this worker's data ---
      console.log(`[Worker ${workerInfo.workerIndex}] Cleaning up ${prefix} data...`);

      // Delete in dependency order to avoid FK constraint violations.

      // 1. Read marks (FK → content_items)
      if (adminUserId) {
        await supabase
          .from('read_marks')
          .delete()
          .eq('user_id', adminUserId)
          .in('content_item_id', itemIds);
      }

      // 2. Notifications (by ID)
      if (notificationIds.length > 0) {
        await supabase.from('notifications').delete().in('id', notificationIds);
      }

      // 3. Bid responses (safety net — CASCADE from workspace should handle)
      if (responseIds.length > 0) {
        await supabase.from('bid_responses').delete().in('id', responseIds);
      }

      // 4. Content-item-workspace junctions (CASCADE from workspace should handle)
      await supabase
        .from('content_item_workspaces')
        .delete()
        .eq('workspace_id', kbSectionId);

      // 5. Content items and workspaces (by prefix)
      await supabase.from('content_items').delete().like('title', `${prefix}%`);
      await supabase.from('workspaces').delete().like('name', `${prefix}%`);
    },
    { scope: 'worker' },
  ],
});
