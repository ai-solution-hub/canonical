/**
 * Centralised test data definitions for E2E tests.
 *
 * This file contains all test data shapes as constants, separate from the
 * seeding logic in test-data-fixture.ts. Update data shapes here — the
 * fixture imports from this file.
 *
 * Phase 5 of the test data strategy (S75).
 */

import { BRANDING } from '@/lib/client-config';

// ---------------------------------------------------------------------------
// Freshness offsets (milliseconds from now, negative = in the past)
// ---------------------------------------------------------------------------

export const FRESHNESS_OFFSETS = {
  /** 30 days ago — used for stale items */
  THIRTY_DAYS_MS: 30 * 86400000,
  /** 60 days ago — used for aging items */
  SIXTY_DAYS_MS: 60 * 86400000,
  /** 90 days ago — used for expired items */
  NINETY_DAYS_MS: 90 * 86400000,
  /** 14 days from now — used for bid deadlines */
  FOURTEEN_DAYS_FUTURE_MS: 14 * 86400000,
} as const;

// ---------------------------------------------------------------------------
// Content item shapes (without prefix — prefix is applied at seed time)
// ---------------------------------------------------------------------------

export interface ContentItemShape {
  title: string;
  content_type: string;
  primary_domain: string;
  summary: string;
  platform: string;
  content: string;
  source_url?: string;
  brief?: string;
  detail?: string;
  reference?: string;
  answer_standard?: string;
  answer_advanced?: string;
  freshness?: string;
  freshness_checked_at?: string;
  lifecycle_type?: string;
  expiry_date?: string;
  verified_at?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Build the 12 core content items. Accepts timestamps computed at seed time
 * so that date offsets are always relative to the current moment.
 */
export function buildCoreContentItems(timestamps: {
  thirtyDaysAgo: string;
  sixtyDaysAgo: string;
  ninetyDaysAgo: string;
  now: string;
  expiredDate: string;
}): ContentItemShape[] {
  return [
    // [0] Article — Service Delivery (summary, progressive depth layers)
    {
      title: 'IT Support Policy',
      content_type: 'article',
      primary_domain: 'Service Delivery',
      summary: 'E2E test article about IT support policies and procedures.',
      platform: 'manual',
      source_url: 'https://e2e-test.example.com/it-support',
      content: 'This is an E2E test content item covering IT support policies.',
      brief:
        'IT support policy overview covering response times and escalation procedures.',
      detail:
        'Our IT support policy defines tiered response times: P1 critical issues receive a 15-minute response, P2 high-priority issues within 1 hour, and P3 standard issues within 4 hours. The policy covers escalation procedures, on-call rotations, and service desk operating hours.',
      reference:
        'Full IT Support Policy v3.2 — includes appendices on ITIL alignment, service catalogue definitions, and change management procedures. Approved by the IT Director on 15 January 2026. Next review due July 2026.',
    },
    // [1] Q&A pair — Service Delivery (answer_standard only)
    {
      title: 'What is your SLA?',
      content_type: 'q_a_pair',
      primary_domain: 'Service Delivery',
      summary: 'Q&A pair about service level agreements.',
      platform: 'manual',
      content:
        'Q: What is your SLA?\nA: We provide tiered SLAs with 15-minute P1 response.',
      answer_standard:
        'We provide tiered SLAs with 15-minute P1 response, 1-hour P2 response, and 4-hour P3 response.',
    },
    // [2] Q&A pair — Technical Capability (both answer fields)
    {
      title: 'Project Management Approach',
      content_type: 'q_a_pair',
      primary_domain: 'Technical Capability',
      summary: 'Q&A pair about project management methodology and governance.',
      platform: 'manual',
      content:
        'Q: Describe your project management approach.\nA: We follow PRINCE2 with agile delivery sprints.',
      answer_standard:
        'We follow PRINCE2 methodology adapted for agile delivery, with dedicated project managers for each engagement and weekly governance reporting.',
      answer_advanced:
        'Our project management framework combines PRINCE2 governance with agile delivery sprints. Each project has a dedicated PRINCE2 Practitioner as project manager, supported by a PMO that provides cross-project oversight. We use weekly RAG status reporting, monthly steering committees, and quarterly programme boards. Our methodology includes mandatory stage-gate reviews, risk registers maintained in real-time, and benefits realisation tracking throughout the project lifecycle and into BAU.',
    },
    // [3] Policy — Security & Compliance (stale, regulation)
    {
      title: 'Cyber Essentials Compliance',
      content_type: 'policy',
      primary_domain: 'Security & Compliance',
      summary:
        'Policy document covering Cyber Essentials certification requirements.',
      platform: 'manual',
      content:
        'This policy outlines our approach to maintaining Cyber Essentials Plus certification, including annual reassessment procedures and remediation workflows.',
      freshness: 'stale',
      freshness_checked_at: timestamps.thirtyDaysAgo,
      lifecycle_type: 'regulation',
    },
    // [4] Note — Commercial (expired, date_bound, with temporal_references for E2E)
    {
      title: 'Pricing Model Template',
      content_type: 'note',
      primary_domain: 'Commercial',
      summary: 'Template for pricing model breakdowns in bid responses.',
      platform: 'manual',
      content:
        'Standard pricing model template: Day rates, fixed-price deliverables, managed service charges, and optional extras. Effective from 01/01/2025. Review by 31/12/2026.',
      freshness: 'expired',
      freshness_checked_at: timestamps.ninetyDaysAgo,
      lifecycle_type: 'date_bound',
      expiry_date: timestamps.expiredDate,
      metadata: {
        temporal_references: [
          {
            date: timestamps.expiredDate,
            type: 'expiry',
            confidence: 'high',
            context: 'Template valid until expiry on the stated date.',
          },
          {
            date: '2025-01-01',
            type: 'effective',
            confidence: 'medium',
            context: 'Effective from 01/01/2025.',
          },
          {
            date: '2026-12-31',
            type: 'review',
            confidence: 'medium',
            context: 'Review by 31/12/2026.',
          },
        ],
      },
    },
    // [5] Certification — Security & Compliance (fresh, verified_at set)
    {
      title: 'ISO 27001 Certification',
      content_type: 'certification',
      primary_domain: 'Security & Compliance',
      summary:
        'ISO 27001 information security management system certification details.',
      platform: 'manual',
      content:
        'We hold ISO 27001:2022 certification for our information security management system, covering all managed service operations. Certificate number: IS 12345. Certified by BSI. Valid until December 2027.',
      freshness: 'fresh',
      verified_at: timestamps.now,
    },
    // [6] Case Study — Experience & Track Record (summary, metadata)
    {
      title: 'Case Study: NHS Digital',
      content_type: 'case_study',
      primary_domain: 'Experience & Track Record',
      summary:
        'Case study demonstrating NHS Digital infrastructure modernisation project delivery.',
      platform: 'manual',
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
      title: 'Cloud Migration Methodology',
      content_type: 'methodology',
      primary_domain: 'Technical Capability',
      summary:
        'Our structured approach to cloud migration using the 6R framework.',
      platform: 'manual',
      content:
        'Our cloud migration methodology follows the 6R framework (Rehost, Replatform, Repurchase, Refactor, Retain, Retire). Each migration begins with a discovery phase to assess application dependencies, followed by a proof of concept, pilot migration, and full rollout with rollback procedures.',
    },
    // [8] Policy — Social Value (aging)
    {
      title: 'Social Value Framework',
      content_type: 'policy',
      primary_domain: 'Social Value',
      summary:
        'Framework for delivering social value through public sector contracts.',
      platform: 'manual',
      content:
        'Our Social Value Framework aligns with the Social Value Act 2012 and the PPN 06/20 Social Value Model. We commit to local employment, apprenticeships, environmental sustainability, and community engagement on every public sector contract.',
      freshness: 'aging',
      freshness_checked_at: timestamps.sixtyDaysAgo,
    },
    // [9] Policy — Security & Compliance (regulation)
    {
      title: 'Data Protection Policy',
      content_type: 'policy',
      primary_domain: 'Security & Compliance',
      summary:
        'Data protection policy covering GDPR compliance and data handling procedures.',
      platform: 'manual',
      content:
        'This policy sets out our approach to data protection in compliance with UK GDPR and the Data Protection Act 2018. It covers data processing principles, lawful bases for processing, data subject rights, breach notification procedures, and international transfer safeguards.',
      lifecycle_type: 'regulation',
    },
    // [10] Other — People & Skills
    {
      title: 'Staff CVs and Experience',
      content_type: 'other',
      primary_domain: 'People & Skills',
      summary:
        'Overview of key staff qualifications and experience for bid submissions.',
      platform: 'manual',
      content:
        'Our team includes 45 certified engineers across ITIL, PRINCE2, AWS, Azure, and Cisco disciplines. Key personnel have an average of 12 years public sector IT experience.',
    },
    // [11] Policy — Sustainability (aging)
    {
      title: 'Environmental Policy',
      content_type: 'policy',
      primary_domain: 'Sustainability',
      summary:
        'Environmental policy covering carbon reduction and sustainable operations.',
      platform: 'manual',
      content:
        'We are committed to achieving net zero carbon emissions by 2030. Our environmental policy covers energy efficiency in data centres, sustainable procurement, waste reduction, and carbon offset programmes. We report annually against the GHG Protocol Scope 1-3 framework.',
      freshness: 'aging',
      freshness_checked_at: timestamps.sixtyDaysAgo,
    },
  ];
}

// ---------------------------------------------------------------------------
// Workspace shapes (without prefix) — non-procurement workspaces only.
// ---------------------------------------------------------------------------

export interface WorkspaceShape {
  name: string;
  description: string;
  /**
   * `application_types.key` for this workspace.
   *
   * S246 WP2b T2 (migration 20260520120828) DROPPED the `workspaces.type` text
   * column and replaced it with a NOT-NULL `application_type_id` FK to
   * `application_types(id)`. The seed logic resolves this key to the FK id at
   * insert time (`application_types.id` is gen_random_uuid() — NOT stable across
   * Supabase branches, so a literal UUID would break on a fresh branch).
   *
   * ID-145 {145.6} W1e wholesale-deletes every `workspaces` row that is
   * procurement-scoped (`procurement_workspaces` join) — procurement items are
   * `form_instances` rows now (see `buildCoreFormInstances` below), never
   * `workspaces` rows. The one surviving shape here is the kb_section
   * content-grouping workspace, which has no dedicated `application_type`
   * post-T2 and reuses `'procurement'` — the junction-assignment logic that
   * consumes it is type-agnostic, and this key predates/survives W1 unchanged
   * (`workspaces`/`application_types` themselves are explicitly untouched by
   * W1e, DR-056).
   */
  applicationTypeKey: string;
}

/** Build the (non-procurement) workspace definitions — kb_section only. */
export function buildCoreWorkspaces(): WorkspaceShape[] {
  return [
    {
      name: 'Test KB Section',
      description: 'E2E worker-scoped KB section workspace.',
      applicationTypeKey: 'procurement',
    },
  ];
}

// ---------------------------------------------------------------------------
// Form instance shapes (without prefix) — the procurement items themselves.
// ---------------------------------------------------------------------------

/**
 * ID-145 {145.6}/{145.18} form-first re-architecture (BI-1): a procurement
 * item IS a `form_instances` row directly — no more `workspaces` umbrella,
 * no more `domain_metadata` JSONB. `buyer` lives on `issuing_organisation`;
 * `deadline`/`reference_number`/`estimated_value` are top-level columns.
 */
export interface FormInstanceShape {
  name: string;
  description: string;
  issuing_organisation: string;
  deadline: string;
  reference_number: string | null;
  estimated_value: number | null;
}

/**
 * Build the two seeded procurement items. Accepts a deadline date string.
 * `IT Support Services` is the primary worker bid (`workerData.procurementId`,
 * advanced through `BID_STATE_TRANSITIONS`, asserted on by name in several
 * specs). `Cloud Migration RFP` (`workerData.projectId`) is a second,
 * untouched item — preserved from the pre-W1 shape for card-count parity;
 * no live spec asserts on it by name.
 */
export function buildCoreFormInstances(
  bidDeadline: string,
): FormInstanceShape[] {
  return [
    {
      name: 'IT Support Services',
      description: 'E2E worker-scoped bid.',
      issuing_organisation: 'E2E Test Corp',
      deadline: bidDeadline,
      reference_number: null,
      estimated_value: null,
    },
    {
      name: 'Cloud Migration RFP',
      description: 'E2E worker-scoped second bid workspace.',
      issuing_organisation: 'E2E Cloud Corp',
      deadline: bidDeadline,
      reference_number: null,
      estimated_value: null,
    },
  ];
}

// ---------------------------------------------------------------------------
// Procurement question shapes (project_id is set at seed time)
// ---------------------------------------------------------------------------

export interface BidQuestionShape {
  section_name: string;
  section_sequence: number;
  question_sequence: number;
  question_text: string;
  word_limit: number;
}

export const CORE_BID_QUESTIONS: BidQuestionShape[] = [
  {
    section_name: 'Technical',
    section_sequence: 1,
    question_sequence: 1,
    question_text: 'Describe your approach to providing IT support services.',
    word_limit: 500,
  },
  {
    section_name: 'Experience',
    section_sequence: 2,
    question_sequence: 1,
    question_text:
      'What experience does your organisation have in public sector IT?',
    word_limit: 400,
  },
  {
    section_name: 'Social Value',
    section_sequence: 3,
    question_sequence: 1,
    question_text: 'How will you deliver social value through this contract?',
    word_limit: 300,
  },
  {
    section_name: 'Commercial',
    section_sequence: 4,
    question_sequence: 1,
    question_text:
      'Provide your pricing model breakdown including day rates and fixed-price options.',
    word_limit: 600,
  },
];

// ---------------------------------------------------------------------------
// Procurement response shapes (question_id is set at seed time)
// ---------------------------------------------------------------------------

export interface BidResponseShape {
  response_text: string;
  review_status: string;
  version: number;
}

export const CORE_BID_RESPONSES: BidResponseShape[] = [
  {
    response_text:
      'Our IT support approach combines proactive monitoring with a dedicated service desk operating 24/7. We use ITIL-aligned processes with automated ticket routing, SLA-driven escalation, and root cause analysis for recurring incidents. Our team of 45 certified engineers provides L1-L3 support across all major platforms.',
    review_status: 'approved',
    version: 1,
  },
  {
    response_text:
      'We have delivered IT services to over 30 public sector organisations including NHS trusts, local authorities, and central government departments. Notable contracts include a 5-year managed service for a London borough and infrastructure modernisation for an NHS integrated care board.',
    review_status: 'draft',
    version: 1,
  },
];

// ---------------------------------------------------------------------------
// Procurement state transitions (from draft → drafting)
// ---------------------------------------------------------------------------

export const BID_STATE_TRANSITIONS = [
  'questions_extracted',
  'matching',
  'drafting',
] as const;

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------

export const TEST_USERS = {
  admin: {
    email: 'test.user1@test-kb-aish.co.uk',
    expectedRole: 'admin',
  },
  editor: {
    email: 'test.user2@test-kb-aish.co.uk',
    expectedRole: 'editor',
  },
  viewer: {
    email: 'test.user3@test-kb-aish.co.uk',
    expectedRole: 'viewer',
  },
} as const;

// ---------------------------------------------------------------------------
// Embedding item indices — which content items have pre-computed embeddings
// ---------------------------------------------------------------------------

export const EMBEDDING_ITEM_INDICES = [0, 1, 2, 3, 7] as const;

// ---------------------------------------------------------------------------
// Intelligence workspace fixtures
// ---------------------------------------------------------------------------

export interface FeedSourceShape {
  name: string;
  url: string;
  is_active: boolean;
  polling_interval_minutes: number;
}

export interface FeedArticleShape {
  title: string;
  external_url: string;
  relevance_score: number;
  relevance_category: string;
  ai_summary: string | null;
  matched_categories: string[];
  passed: boolean;
  published_at: string;
  ingested_at: string;
}

export const INTELLIGENCE_FEED_SOURCE: FeedSourceShape = {
  name: 'E2E Test Feed',
  url: 'https://example.com/e2e-test-feed.xml',
  is_active: true,
  polling_interval_minutes: 60,
};

// ---------------------------------------------------------------------------
// Entity mention shapes (content_item_id is set at seed time)
// ---------------------------------------------------------------------------

export interface EntityMentionShape {
  /** Index into the seeded contentItemIds array */
  itemIndex: number;
  canonical_name: string;
  entity_name: string;
  entity_type: string;
  confidence?: number;
  context_snippet?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Build deterministic entity mentions for E2E tests.
 *
 * Provides:
 * - 2 certifications (1 valid, 1 expiring soon, both holder='self') on
 *   the certification item [5] and case study item [6] — drives the
 *   /api/certifications report and the dashboard cert summary card.
 * - 1 framework (expiring) for framework summary coverage.
 * - 2 organisation entities and 2 standard entities spread across items
 *   so the browse filter panel renders Entity Type, Entities, and
 *   Entity Co-occurrence sections deterministically.
 *
 * Co-occurrence is computed from entities sharing a content_item_id, so
 * we deliberately place "ISO 27001" + "BSI" on item 5 and "AWS" + "NHS
 * Digital" on item 6 so each pair co-occurs at least once.
 */
export function buildEntityMentions(): EntityMentionShape[] {
  const expiringSoonDate = new Date(Date.now() + 20 * 86400000)
    .toISOString()
    .split('T')[0];
  const validDate = new Date(Date.now() + 365 * 86400000)
    .toISOString()
    .split('T')[0];

  return [
    // --- Certifications (drives /api/certifications) ---
    {
      itemIndex: 5, // ISO 27001 Certification item
      canonical_name: 'ISO 27001',
      entity_name: 'ISO 27001',
      entity_type: 'certification',
      confidence: 0.95,
      context_snippet: 'We hold ISO 27001:2022 certification.',
      metadata: {
        holder: 'self',
        expiry_date: validDate,
      },
    },
    {
      itemIndex: 5,
      canonical_name: 'Cyber Essentials Plus',
      entity_name: 'Cyber Essentials Plus',
      entity_type: 'certification',
      confidence: 0.9,
      context_snippet: 'Cyber Essentials Plus certification expiring soon.',
      metadata: {
        holder: 'self',
        expiry_date: expiringSoonDate, // expiring_soon
      },
    },
    // Supplier certification — drives the supplier collapsible section.
    {
      itemIndex: 6,
      canonical_name: 'ISO 9001 (Acme Supplier)',
      entity_name: 'ISO 9001 (Acme Supplier)',
      entity_type: 'certification',
      confidence: 0.85,
      context_snippet: 'Subcontractor Acme Ltd holds ISO 9001.',
      metadata: {
        holder: 'supplier',
        supplier_name: 'Acme Ltd',
        expiry_date: validDate,
      },
    },
    // --- Framework (expiring soon) ---
    {
      itemIndex: 6, // Case study item
      canonical_name: 'G-Cloud 14',
      entity_name: 'G-Cloud 14',
      entity_type: 'framework',
      confidence: 0.9,
      context_snippet: 'Listed on the G-Cloud 14 framework.',
      metadata: {
        expiry_date: expiringSoonDate,
      },
    },
    // --- Organisations + standards (drives entity filter UI) ---
    {
      itemIndex: 5,
      canonical_name: 'BSI',
      entity_name: 'BSI',
      entity_type: 'organisation',
      confidence: 0.9,
      context_snippet: 'Certified by BSI.',
    },
    {
      itemIndex: 6,
      canonical_name: 'NHS Digital',
      entity_name: 'NHS Digital',
      entity_type: 'organisation',
      confidence: 0.95,
      context_snippet: 'NHS Digital infrastructure modernisation project.',
    },
    {
      itemIndex: 6,
      canonical_name: 'AWS',
      entity_name: 'AWS',
      entity_type: 'organisation',
      confidence: 0.9,
      context_snippet: 'Cloud-first architecture on AWS.',
    },
    {
      itemIndex: 7, // Cloud Migration Methodology
      canonical_name: 'AWS',
      entity_name: 'AWS',
      entity_type: 'organisation',
      confidence: 0.85,
      context_snippet: 'AWS migration methodology.',
    },
    {
      itemIndex: 7,
      canonical_name: 'Azure',
      entity_name: 'Azure',
      entity_type: 'organisation',
      confidence: 0.85,
      context_snippet: 'Azure migration methodology.',
    },
    // NHS Digital + AWS co-occur on items 6 and 7 (>= 2 items satisfies
    // get_entity_co_occurrence default p_min_count=2).
    {
      itemIndex: 7,
      canonical_name: 'NHS Digital',
      entity_name: 'NHS Digital',
      entity_type: 'organisation',
      confidence: 0.9,
      context_snippet: 'NHS Digital cloud migration.',
    },
  ];
}

/**
 * Build entity relationships for the certifications report.
 * Each "holds" row links a holder entity ("Our Organisation") to a
 * certification entity. The /api/certifications endpoint requires these
 * rows to surface certifications on the dashboard.
 */
export interface EntityRelationshipShape {
  itemIndex: number;
  source_entity: string;
  target_entity: string;
  relationship_type: string;
  confidence?: number;
}

export function buildEntityRelationships(): EntityRelationshipShape[] {
  return [
    {
      itemIndex: 5,
      source_entity: BRANDING.organisationName,
      target_entity: 'ISO 27001',
      relationship_type: 'holds',
      confidence: 0.95,
    },
    {
      itemIndex: 5,
      source_entity: BRANDING.organisationName,
      target_entity: 'Cyber Essentials Plus',
      relationship_type: 'holds',
      confidence: 0.9,
    },
    {
      itemIndex: 6,
      source_entity: BRANDING.organisationName,
      target_entity: 'G-Cloud 14',
      relationship_type: 'holds',
      confidence: 0.9,
    },
    {
      itemIndex: 6,
      source_entity: 'Acme Ltd',
      target_entity: 'ISO 9001 (Acme Supplier)',
      relationship_type: 'holds',
      confidence: 0.85,
    },
  ];
}

export function buildIntelligenceFeedArticles(now: string): FeedArticleShape[] {
  return [
    {
      title: 'Major Cyber Security Regulation Update',
      external_url: 'https://example.com/articles/cyber-regulation',
      relevance_score: 0.92,
      relevance_category: 'high',
      ai_summary:
        'New regulations requiring enhanced security measures for UK public sector contractors.',
      matched_categories: ['Cyber Security', 'Regulation'],
      passed: true,
      published_at: now,
      ingested_at: now,
    },
    {
      title: 'Cloud Infrastructure Market Trends Q2 2026',
      external_url: 'https://example.com/articles/cloud-trends',
      relevance_score: 0.78,
      relevance_category: 'medium',
      ai_summary:
        'Analysis of cloud infrastructure spending trends among UK SMBs.',
      matched_categories: ['Cloud Infrastructure', 'Market Analysis'],
      passed: true,
      published_at: now,
      ingested_at: now,
    },
    {
      title: 'Irrelevant Sports Article',
      external_url: 'https://example.com/articles/sports-news',
      relevance_score: 0.15,
      relevance_category: 'irrelevant',
      ai_summary: null,
      matched_categories: [],
      passed: false,
      published_at: now,
      ingested_at: now,
    },
  ];
}
