#!/usr/bin/env bun
/**
 * Catalogue Standard Selection Questionnaire (PPN 03/24) Requirements
 *
 * Populates the `template_requirements` table with the 66 questions from
 * the Standard Selection Questionnaire extracted during UAT Scenario 1.
 * Each question becomes a requirement row with taxonomy mapping, requirement
 * type, matching keywords, and pre-computed embedding.
 *
 * Historical seed-script. Do not re-run. Slugs were normalised post-import via
 * taxonomy-financial-merge-spec.md (S203 WP-D1) — see migration
 * `20260427223323_merge_taxonomy_financial_into_financial_standing.sql`. The
 * inline `'financial'` literals below reflect the historical state at import
 * time and must not be edited.
 *
 * Usage:
 *   bun run scripts/catalogue_standard_sq.ts                   # full insert with embeddings
 *   bun run scripts/catalogue_standard_sq.ts --dry-run          # preview without inserting
 *   bun run scripts/catalogue_standard_sq.ts --skip-embeddings  # insert without embeddings
 *   bun run scripts/catalogue_standard_sq.ts --dry-run --skip-embeddings  # preview only
 */

import { createScriptClient } from '@/scripts/lib/supabase-script-client';
import { loadEnv } from './lib/load-env';
import { assertEnvFlag } from './lib/script-env';

// ── Types ──────────────────────────────────────────────────────────────────

interface TemplateRequirement {
  template_name: string;
  template_version: string;
  template_type: string;
  section_ref: string;
  section_name: string;
  question_number: number;
  requirement_text: string;
  description: string;
  requirement_type:
    | 'policy'
    | 'statement'
    | 'evidence'
    | 'data'
    | 'narrative'
    | 'declaration'
    | 'reference';
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  matching_keywords: string[];
  matching_guidance: string | null;
  is_mandatory: boolean;
  sector_applicability: string[] | null;
  word_limit_guidance: number | null;
  display_order: number;
}

interface InsertRow extends TemplateRequirement {
  requirement_embedding?: string; // JSON.stringify'd vector
  is_current: boolean;
}

loadEnv();

// ── CLI args ───────────────────────────────────────────────────────────────

function parseCliArgs(): {
  dryRun: boolean;
  skipEmbeddings: boolean;
  env: string;
} {
  const args = process.argv.slice(2);
  let dryRun = false;
  let skipEmbeddings = false;
  let env = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--skip-embeddings') skipEmbeddings = true;
    else if (arg === '--env' && args[i + 1]) {
      env = args[i + 1];
      i++;
    } else if (arg.startsWith('--env=')) {
      env = arg.slice('--env='.length);
    }
  }

  return { dryRun, skipEmbeddings, env };
}

// ── Constants ──────────────────────────────────────────────────────────────

const TEMPLATE_NAME = 'Standard Selection Questionnaire';
const TEMPLATE_VERSION = 'PPN 03/24';
const TEMPLATE_TYPE = 'sq';
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1024;

// ── Requirement definitions ────────────────────────────────────────────────
//
// 66 requirements across 16 sections, mapped from the PPN 03/24 Standard SQ.
// Section structure and question counts match UAT Scenario 1 extraction
// (docs/reference/uat-scenario-1-results.md).
//
// Taxonomy: 7 domains (SECURITY, COMPLIANCE, IMPLEMENTATION, SUPPORT,
// CORPORATE, PRODUCT-FEATURE, METHODOLOGY), 34 subtopics.
// Domain slugs use lowercase as stored in DB.

const REQUIREMENTS: TemplateRequirement[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // Part 1 — General Information (17 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 1,
    requirement_text:
      'Full name of the potential supplier submitting the information.',
    description: 'Company or organisation legal name',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'company name',
      'legal name',
      'organisation name',
      'trading name',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 1,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 2,
    requirement_text: 'Registered office address (if applicable).',
    description: 'Registered office address of the organisation',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'registered office',
      'company address',
      'business address',
      'head office',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 2,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 3,
    requirement_text:
      'Trading status: (a) public limited company, (b) limited company, (c) limited liability partnership, (d) other partnership, (e) sole trader, (f) third sector, (g) other (please specify).',
    description: 'Legal trading status of the organisation',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'trading status',
      'company type',
      'legal entity',
      'limited company',
      'partnership',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 3,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 4,
    requirement_text: 'Date of registration in country of origin.',
    description: 'Date the organisation was registered/incorporated',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'date of registration',
      'incorporation date',
      'company formation',
      'established date',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 4,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 5,
    requirement_text: 'Company registration number (if applicable).',
    description: 'Companies House registration number',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'company registration number',
      'Companies House',
      'CRN',
      'company number',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 5,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 6,
    requirement_text: 'Head office DUNS number (if applicable).',
    description: 'Dun & Bradstreet DUNS number',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['DUNS number', 'Dun & Bradstreet', 'D-U-N-S'],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 6,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 7,
    requirement_text: 'Registered VAT number.',
    description: 'VAT registration number',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['VAT number', 'VAT registration', 'tax registration'],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 7,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 8,
    requirement_text:
      'Name and details of the relevant persons of significant control (PSC) as listed on the PSC register at Companies House or persons with a right to exercise significant influence or control. If you are a PSC-exempt company, please provide the name and details of the relevant registrable legal entity (RLE).',
    description: 'Persons of significant control or registrable legal entities',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: 'compliance',
    secondary_subtopic: 'regulatory',
    matching_keywords: [
      'PSC',
      'persons of significant control',
      'registrable legal entity',
      'company ownership',
      'Companies House',
    ],
    matching_guidance:
      'May reference Companies House PSC register or beneficial ownership disclosures',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 8,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 9,
    requirement_text:
      'Details of the immediate parent company: full name, registered office address (if applicable), company registration number (if applicable), head office DUNS number (if applicable), head office VAT number (if applicable).',
    description: 'Immediate parent company details',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'parent company',
      'holding company',
      'group structure',
      'corporate structure',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 9,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 10,
    requirement_text:
      'Details of the ultimate parent company: full name, registered office address (if applicable), company registration number (if applicable), head office DUNS number (if applicable), head office VAT number (if applicable).',
    description: 'Ultimate parent company details',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'ultimate parent company',
      'holding company',
      'group structure',
      'corporate hierarchy',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 10,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 11,
    requirement_text:
      'Are you a Small or Medium Enterprise (SME)? (as defined by the European Commission).',
    description: 'SME status declaration',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'SME',
      'small business',
      'medium enterprise',
      'company size',
      'employee count',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 11,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 12,
    requirement_text:
      'Are you a voluntary, community or social enterprise (VCSE)?',
    description: 'VCSE status declaration',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'VCSE',
      'social enterprise',
      'voluntary organisation',
      'community organisation',
      'charity',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 12,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 13,
    requirement_text:
      'Are you a sheltered workshop, or a supplier who provides for the employment of disabled or disadvantaged persons?',
    description: 'Sheltered workshop or supported employment status',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'sheltered workshop',
      'supported employment',
      'disabled persons',
      'disadvantaged persons',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 13,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 14,
    requirement_text:
      'Contact details: name, position, postal address, email, telephone.',
    description: 'Primary contact details for this procurement',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'contact details',
      'point of contact',
      'contact name',
      'contact email',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 14,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 15,
    requirement_text:
      'Is your organisation bidding as the lead contact for a group of economic operators? If yes, please provide details of the proposed arrangements and the composition of the group.',
    description: 'Consortium or group bidding arrangement details',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-info',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'consortium',
      'joint venture',
      'group bid',
      'lead contractor',
      'economic operator',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 15,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 16,
    requirement_text:
      'Are you proposing to use sub-contractors? If yes, please provide details of the proposed sub-contractors, including the percentage of the contract value that will be sub-contracted.',
    description: 'Sub-contracting arrangements and details',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'subcontractor',
      'sub-contracting',
      'supply chain',
      'outsourcing',
      'third party',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 16,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 1',
    section_name: 'General Information',
    question_number: 17,
    requirement_text:
      'Where you intend to sub-contract a proportion of the contract, please demonstrate how you have or will identify sub-contractors and how you manage them.',
    description: 'Sub-contractor identification and management approach',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'subcontractor management',
      'supply chain management',
      'subcontractor oversight',
      'vendor management',
      'due diligence',
    ],
    matching_guidance:
      'Look for policies and procedures around subcontractor vetting, onboarding, and ongoing management',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 17,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 2 — Exclusion Grounds: Mandatory (3 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Mandatory Exclusion',
    section_name: 'Exclusion Grounds: Mandatory',
    question_number: 1,
    requirement_text:
      'Within the past five years, has your organisation (or any member of your proposed group or any of its directors or partner or any other person who has powers of representation, decision or control) been convicted of any of the following offences: conspiracy, corruption, bribery, fraud, money laundering, terrorism, child labour or human trafficking?',
    description:
      'Declaration of mandatory exclusion criminal offences in past 5 years',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'criminal conviction',
      'bribery',
      'fraud',
      'money laundering',
      'mandatory exclusion',
      'Bribery Act',
    ],
    matching_guidance:
      'Yes/no declaration — KB content not typically needed unless remedial measures apply',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 18,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Mandatory Exclusion',
    section_name: 'Exclusion Grounds: Mandatory',
    question_number: 2,
    requirement_text:
      'If you have answered yes to the question above, please provide further details. Date of conviction, specify which of the grounds listed the conviction was for, and the reasons attached to the conviction. If the relevant documentation is available electronically, please provide the web address, issuing authority, or precise reference of the documents.',
    description:
      'Details of any mandatory exclusion convictions and self-cleaning measures',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'conviction details',
      'self-cleaning',
      'remedial measures',
      'mandatory exclusion',
    ],
    matching_guidance:
      'Only relevant if organisation has had criminal convictions; most respondents answer N/A',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 19,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Mandatory Exclusion',
    section_name: 'Exclusion Grounds: Mandatory',
    question_number: 3,
    requirement_text:
      'Has it been established by a judicial or administrative decision having final and binding effect in accordance with the legal provisions of any part of the United Kingdom, or the legal provisions of the country in which the organisation is established (if outside the UK), that the organisation is in breach of obligations related to the payment of tax or social security contributions?',
    description:
      'Declaration on breach of tax or social security payment obligations',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: 'corporate',
    secondary_subtopic: 'financial',
    matching_keywords: [
      'tax compliance',
      'social security',
      'HMRC',
      'tax obligations',
      'payment of tax',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 20,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 2 — Exclusion Grounds: Tax/Social (3 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Tax and Social Security',
    section_name: 'Exclusion Grounds: Tax/Social',
    question_number: 1,
    requirement_text:
      'Has it been established by a judicial or administrative decision having final and binding effect that the organisation is in breach of obligations related to the payment of tax or social security contributions?',
    description:
      'Judicial/administrative findings on tax or social security breach',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'tax breach',
      'social security',
      'judicial decision',
      'tax compliance',
      'HMRC',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 21,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Tax and Social Security',
    section_name: 'Exclusion Grounds: Tax/Social',
    question_number: 2,
    requirement_text:
      'If you have answered yes to the question above, please provide further details. Please also confirm whether you have paid, or have entered into a binding arrangement with a view to paying, the outstanding contributions including, where applicable, any accrued interest and/or fines.',
    description:
      'Details of tax/social security breach and payment arrangements',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'outstanding tax',
      'payment arrangement',
      'HMRC settlement',
      'tax debt',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 22,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Tax and Social Security',
    section_name: 'Exclusion Grounds: Tax/Social',
    question_number: 3,
    requirement_text:
      'If you have fulfilled your obligations by paying or entering into a binding arrangement, please provide details including evidence that the arrangement is binding.',
    description:
      'Evidence of binding payment arrangement for outstanding tax/social security',
    requirement_type: 'evidence',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'binding arrangement',
      'tax payment evidence',
      'HMRC agreement',
      'payment plan',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 23,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 2 — Exclusion Grounds: Discretionary (4 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Discretionary Exclusion',
    section_name: 'Exclusion Grounds: Discretionary',
    question_number: 1,
    requirement_text:
      'Within the past three years, has your organisation (or any member of your proposed group or any of its directors, partners, or persons having powers of representation, decision or control): (a) breached any environmental, social or labour law obligations; (b) committed an act of grave professional misconduct; (c) entered into agreements with other economic operators aimed at distorting competition; (d) had a conflict of interest within the meaning of regulation 57(8)?',
    description:
      'Declaration of discretionary exclusion grounds (environmental, social, labour, misconduct, competition, conflict of interest)',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'professional misconduct',
      'environmental breach',
      'labour law',
      'conflict of interest',
      'discretionary exclusion',
      'anti-competitive',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 24,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Discretionary Exclusion',
    section_name: 'Exclusion Grounds: Discretionary',
    question_number: 2,
    requirement_text:
      'Within the past three years, has your organisation: (a) experienced significant or persistent deficiencies in the performance of a substantive requirement under a prior public contract which led to early termination, damages or other comparable sanctions; (b) been guilty of serious misrepresentation in supplying the information required for the verification of the absence of grounds for exclusion or the fulfilment of the selection criteria?',
    description:
      'Declaration on prior contract performance failures and misrepresentation',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'contract termination',
      'performance failure',
      'misrepresentation',
      'prior contract',
      'public contract',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 25,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Discretionary Exclusion',
    section_name: 'Exclusion Grounds: Discretionary',
    question_number: 3,
    requirement_text:
      'If you have answered yes to any of the above, please provide further details, including what self-cleaning measures you have taken.',
    description:
      'Details of discretionary exclusion issues and self-cleaning measures',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'self-cleaning',
      'remedial measures',
      'corrective action',
      'exclusion grounds',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 26,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 2 - Discretionary Exclusion',
    section_name: 'Exclusion Grounds: Discretionary',
    question_number: 4,
    requirement_text:
      'Has your organisation or any of its directors or partners or any other person who has powers of representation, decision or control been the subject of insolvency or winding-up proceedings or currently has its assets being administered by a liquidator or by the court, or is in an arrangement with creditors, or has its business activities suspended, or is the subject of proceedings concerning those matters, or is in any analogous situation arising from a similar procedure under the laws and regulations of any State?',
    description:
      'Declaration on insolvency, winding up, or administration proceedings',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: 'corporate',
    secondary_subtopic: 'financial',
    matching_keywords: [
      'insolvency',
      'bankruptcy',
      'administration',
      'winding up',
      'liquidation',
      'creditors',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 27,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Economic and Financial Standing (5 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Economic and Financial',
    section_name: 'Economic and Financial Standing',
    question_number: 1,
    requirement_text:
      'Please provide your annual turnover for the last two financial years.',
    description: 'Annual turnover figures for past two years',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'financial',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'annual turnover',
      'revenue',
      'financial performance',
      'sales figures',
      'income',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 28,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Economic and Financial',
    section_name: 'Economic and Financial Standing',
    question_number: 2,
    requirement_text:
      'Where turnover information is not available for the last two years (e.g. for newly formed companies), please state your date of incorporation and provide any evidence of financial standing such as a cash flow forecast.',
    description: 'Alternative financial evidence for newly formed companies',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'financial',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'cash flow forecast',
      'newly formed',
      'startup',
      'financial evidence',
      'incorporation date',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 29,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Economic and Financial',
    section_name: 'Economic and Financial Standing',
    question_number: 3,
    requirement_text:
      'Please provide a copy of your most recent audited accounts, or if not available, your most recent unaudited accounts.',
    description: 'Most recent audited or unaudited company accounts',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'financial',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'audited accounts',
      'financial statements',
      'annual accounts',
      'balance sheet',
      'profit and loss',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 30,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Economic and Financial',
    section_name: 'Economic and Financial Standing',
    question_number: 4,
    requirement_text:
      "Can you provide a credit reference or banker's reference if required?",
    description: 'Willingness to provide credit or banker reference',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'financial',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'credit reference',
      'banker reference',
      'credit check',
      'financial reference',
      'Dun & Bradstreet',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 31,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Economic and Financial',
    section_name: 'Economic and Financial Standing',
    question_number: 5,
    requirement_text:
      'Where the contracting authority has stated a minimum level of economic and financial standing, please confirm whether you meet that requirement.',
    description: 'Declaration of meeting minimum financial standing thresholds',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'financial',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'financial standing',
      'minimum threshold',
      'financial requirement',
      'economic standing',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 32,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Technical: Relevant Experience (3 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Relevant Experience',
    section_name: 'Technical: Relevant Experience',
    question_number: 1,
    requirement_text:
      'Please provide details of up to three contracts which are relevant to our requirement. These should have been performed during the past three years. The named customer contact provided should be prepared to provide a reference to the contracting authority. Include: name of customer organisation, point of contact, contract start date, contract completion date, estimated contract value, brief description of contract.',
    description:
      'Up to three relevant contract references from past three years',
    requirement_type: 'reference',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'contract reference',
      'relevant experience',
      'past performance',
      'case study',
      'client reference',
      'similar contract',
    ],
    matching_guidance:
      'Match against case studies, client references, and contract experience content',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 33,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Relevant Experience',
    section_name: 'Technical: Relevant Experience',
    question_number: 2,
    requirement_text:
      'Where you cannot provide at least one example of relevant experience, please provide an explanation for this (e.g. organisation is a new start-up).',
    description: 'Explanation if no relevant contract references are available',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'new company',
      'startup',
      'no references',
      'newly established',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 34,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Relevant Experience',
    section_name: 'Technical: Relevant Experience',
    question_number: 3,
    requirement_text:
      'Where you intend to sub-contract a proportion of the contract, please provide relevant examples of work carried out by your proposed sub-contractors.',
    description: 'Sub-contractor relevant experience and references',
    requirement_type: 'reference',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: 'corporate',
    secondary_subtopic: 'references',
    matching_keywords: [
      'subcontractor experience',
      'subcontractor reference',
      'supply chain capability',
      'outsourced delivery',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 35,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Insurance (1 question)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Insurance',
    section_name: 'Insurance',
    question_number: 1,
    requirement_text:
      "Please confirm that you already have, or can commit to obtain, the levels of insurance cover specified by the contracting authority prior to the commencement of the contract. Provide details of current insurance coverage: employer's liability, public liability, professional indemnity, product liability.",
    description:
      'Insurance coverage details and confirmation of meeting required levels',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'insurance',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'insurance',
      'employer liability',
      'public liability',
      'professional indemnity',
      'product liability',
      'insurance certificate',
    ],
    matching_guidance:
      'Match against insurance policy details, coverage levels, and certificates',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 36,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Data Protection (2 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Data Protection',
    section_name: 'Data Protection',
    question_number: 1,
    requirement_text:
      'Please confirm that you will comply with the requirements of the Data Protection Act 2018 (including the UK GDPR) when processing personal data on behalf of the contracting authority. Please describe your approach to data protection, including any relevant policies, procedures, and technical and organisational measures.',
    description: 'Data protection compliance approach and UK GDPR measures',
    requirement_type: 'policy',
    primary_domain: 'security',
    primary_subtopic: 'data-protection',
    secondary_domain: 'compliance',
    secondary_subtopic: 'regulatory',
    matching_keywords: [
      'data protection',
      'GDPR',
      'UK GDPR',
      'Data Protection Act',
      'personal data',
      'data handling',
      'privacy',
    ],
    matching_guidance:
      'Strong match area — look for data protection policies, GDPR compliance, data handling procedures',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 37,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Data Protection',
    section_name: 'Data Protection',
    question_number: 2,
    requirement_text:
      "Is your organisation registered with the Information Commissioner's Office (ICO)? If yes, please provide your ICO registration number.",
    description: 'ICO registration status and registration number',
    requirement_type: 'data',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: 'security',
    secondary_subtopic: 'data-protection',
    matching_keywords: [
      'ICO registration',
      'Information Commissioner',
      'data protection registration',
      'ICO number',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 38,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Health and Safety (2 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Health and Safety',
    section_name: 'Health and Safety',
    question_number: 1,
    requirement_text:
      'Please provide details of your health and safety policy and arrangements. If you have five or more employees, please confirm that you have a written health and safety policy. Please describe your arrangements for ensuring the health and safety of your workers and any persons affected by your work activities.',
    description: 'Health and safety policy and workplace safety arrangements',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'health and safety',
      'H&S policy',
      'workplace safety',
      'risk assessment',
      'RIDDOR',
      'safe working',
    ],
    matching_guidance:
      'Look for H&S policies, risk assessments, safety management systems. Do NOT match IT security content.',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 39,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Health and Safety',
    section_name: 'Health and Safety',
    question_number: 2,
    requirement_text:
      'Has your organisation had any health and safety prosecutions, enforcement or improvement notices in the last three years? If yes, please provide details.',
    description:
      'History of H&S prosecutions or enforcement notices in past three years',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'H&S prosecution',
      'enforcement notice',
      'improvement notice',
      'HSE',
      'health and safety record',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 40,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Payment in Contracts >5m (7 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 1,
    requirement_text:
      'Can you confirm that you will pay your sub-contractors within 30 days of a valid and undisputed invoice, in line with the Late Payment of Commercial Debts (Interest) Act 1998?',
    description: 'Commitment to 30-day payment terms for sub-contractors',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'prompt payment',
      '30-day payment',
      'payment terms',
      'Late Payment Act',
      'subcontractor payment',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 41,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 2,
    requirement_text:
      'What are your current payment terms for your sub-contractors and supply chain?',
    description: 'Current payment terms offered to sub-contractors',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'payment terms',
      'supply chain payment',
      'days to pay',
      'net 30',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 42,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 3,
    requirement_text:
      'Are you a signatory to the Prompt Payment Code? If yes, please provide details.',
    description: 'Prompt Payment Code signatory status',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'Prompt Payment Code',
      'payment practices',
      'PPC signatory',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 43,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 4,
    requirement_text:
      'What is your average payment time (days) for invoices from sub-contractors and supply chain for the last reporting period?',
    description: 'Average payment days for sub-contractor invoices',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'average payment time',
      'payment days',
      'payment performance',
      'invoice payment',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 44,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 5,
    requirement_text:
      'What percentage of invoices were paid within 30 days in the last reporting period? What percentage were paid between 31 and 60 days? What percentage were paid in more than 60 days?',
    description: 'Payment performance statistics (30/60/60+ day breakdown)',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'payment statistics',
      'payment performance',
      'invoice payment breakdown',
      'on-time payment',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 45,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 6,
    requirement_text:
      'Have you published your payment practices and performance under the duty to report on payment practices and performance as required by Part 16 of the Companies Act 2006 and the Reporting on Payment Practices and Performance Regulations 2017? If yes, please provide a link or reference.',
    description:
      'Publication of payment practices under Companies Act 2006 reporting duty',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: 'compliance',
    secondary_subtopic: 'regulatory',
    matching_keywords: [
      'payment practices reporting',
      'Companies Act',
      'duty to report',
      'payment regulations',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 46,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Payment Practices',
    section_name: 'Payment in Contracts >5m',
    question_number: 7,
    requirement_text:
      'Please confirm that you will include a clause in all sub-contracts which requires payment of valid and undisputed invoices within 30 days, and that you will flow down this requirement through the supply chain.',
    description:
      'Commitment to flow down 30-day payment terms through supply chain',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'flow down',
      'payment clause',
      'supply chain payment',
      'sub-contract terms',
      '30-day payment',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 47,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Carbon Reduction (5 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Carbon Reduction',
    section_name: 'Carbon Reduction',
    question_number: 1,
    requirement_text:
      'If you are bidding for a contract which is above the thresholds set out in PPN 06/21, you are required to provide a Carbon Reduction Plan. Please confirm that you have a Carbon Reduction Plan which meets the requirements of PPN 06/21 and provide a copy or link to the plan.',
    description: 'Carbon Reduction Plan as required by PPN 06/21',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'carbon reduction plan',
      'PPN 06/21',
      'net zero',
      'carbon emissions',
      'greenhouse gas',
      'environmental policy',
    ],
    matching_guidance:
      'Look for carbon reduction plans, net zero commitments, environmental policies aligned with PPN 06/21',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 48,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Carbon Reduction',
    section_name: 'Carbon Reduction',
    question_number: 2,
    requirement_text:
      "Please confirm your organisation's commitment to achieving net zero by 2050 in respect of your UK operations.",
    description: 'Net zero 2050 commitment for UK operations',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'net zero',
      'net zero 2050',
      'carbon neutral',
      'climate commitment',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 49,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Carbon Reduction',
    section_name: 'Carbon Reduction',
    question_number: 3,
    requirement_text:
      'Please provide details of your current Scope 1, Scope 2 and Scope 3 greenhouse gas emissions, and your environmental management measures.',
    description:
      'Greenhouse gas emissions data (Scope 1, 2, 3) and environmental management',
    requirement_type: 'data',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'Scope 1',
      'Scope 2',
      'Scope 3',
      'greenhouse gas',
      'GHG emissions',
      'environmental management',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 50,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Carbon Reduction',
    section_name: 'Carbon Reduction',
    question_number: 4,
    requirement_text:
      'Have you set carbon reduction targets? If yes, please provide details of your targets, including baseline year and target year.',
    description: 'Carbon reduction targets with baseline and target years',
    requirement_type: 'data',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'carbon targets',
      'emission targets',
      'reduction targets',
      'baseline year',
      'science-based targets',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 51,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Carbon Reduction',
    section_name: 'Carbon Reduction',
    question_number: 5,
    requirement_text:
      'Do you hold any environmental management certifications (e.g. ISO 14001, EMAS, or equivalent)? If yes, please provide details.',
    description: 'Environmental management certifications (ISO 14001, EMAS)',
    requirement_type: 'evidence',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: 'compliance',
    secondary_subtopic: 'certification',
    matching_keywords: [
      'ISO 14001',
      'EMAS',
      'environmental certification',
      'environmental management system',
      'EMS',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 52,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Skills and Apprentices (2 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Skills and Apprentices',
    section_name: 'Skills and Apprentices',
    question_number: 1,
    requirement_text:
      'For contracts with a value above £10 million and duration of 12 months or more, please confirm that you will comply with the apprenticeship commitment set out in PPN 14/15 and provide details of how you will deliver this commitment, including the number of apprenticeships to be created.',
    description:
      'Apprenticeship commitment under PPN 14/15 for contracts over 10m',
    requirement_type: 'statement',
    primary_domain: 'corporate',
    primary_subtopic: 'staffing',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'apprenticeship',
      'PPN 14/15',
      'skills development',
      'training',
      'workforce development',
    ],
    matching_guidance:
      'Only applies to contracts over 10m with 12+ month duration',
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 53,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Skills and Apprentices',
    section_name: 'Skills and Apprentices',
    question_number: 2,
    requirement_text:
      "Please provide details of your organisation's approach to skills development, training, and investment in your workforce.",
    description: 'Workforce skills development and training approach',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'staffing',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'skills development',
      'workforce training',
      'employee development',
      'CPD',
      'professional development',
    ],
    matching_guidance: null,
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 54,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Procuring Steel (2 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Procuring Steel',
    section_name: 'Procuring Steel',
    question_number: 1,
    requirement_text:
      "For contracts which involve the procurement of steel, please confirm that you will comply with the Government's steel procurement guidance and provide details of how you will ensure that steel is procured in accordance with the guidance.",
    description: 'Steel procurement compliance with government guidance',
    requirement_type: 'statement',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'steel procurement',
      'government guidance',
      'UK steel',
      'construction materials',
    ],
    matching_guidance:
      'Primarily relevant to construction and infrastructure contracts',
    is_mandatory: false,
    sector_applicability: ['construction', 'infrastructure'],
    word_limit_guidance: null,
    display_order: 55,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Procuring Steel',
    section_name: 'Procuring Steel',
    question_number: 2,
    requirement_text:
      'Please provide details of the origin and source of steel products that will be used in the delivery of this contract.',
    description: 'Steel sourcing and origin details for contract delivery',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'supply-chain',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'steel origin',
      'steel source',
      'material sourcing',
      'supply chain transparency',
    ],
    matching_guidance:
      'Primarily relevant to construction and infrastructure contracts',
    is_mandatory: false,
    sector_applicability: ['construction', 'infrastructure'],
    word_limit_guidance: null,
    display_order: 56,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Suppliers Past Performance (5 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Past Performance',
    section_name: 'Suppliers Past Performance',
    question_number: 1,
    requirement_text:
      'Has your organisation ever had a contract terminated for poor performance? If yes, please provide details.',
    description:
      'Disclosure of prior contract terminations for poor performance',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'contract termination',
      'poor performance',
      'terminated contract',
      'performance failure',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 57,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Past Performance',
    section_name: 'Suppliers Past Performance',
    question_number: 2,
    requirement_text:
      'Has your organisation ever had a contract which was not renewed due to poor performance? If yes, please provide details.',
    description: 'Disclosure of contracts not renewed due to poor performance',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'contract not renewed',
      'non-renewal',
      'performance issues',
      'contract performance',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 58,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Past Performance',
    section_name: 'Suppliers Past Performance',
    question_number: 3,
    requirement_text:
      'Has your organisation ever received any formal performance improvement notices or similar sanctions from a client? If yes, please provide details.',
    description: 'Disclosure of formal performance improvement notices',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'performance notice',
      'improvement notice',
      'performance sanctions',
      'formal warning',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 59,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Past Performance',
    section_name: 'Suppliers Past Performance',
    question_number: 4,
    requirement_text:
      'If you answered yes to any of the above questions on past performance, please describe the steps taken to address and resolve the issues.',
    description: 'Remedial steps taken to address past performance issues',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'remedial action',
      'corrective measures',
      'performance improvement',
      'lessons learned',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 60,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Past Performance',
    section_name: 'Suppliers Past Performance',
    question_number: 5,
    requirement_text:
      "Please provide details of your organisation's quality management approach, including any quality management certifications held (e.g. ISO 9001 or equivalent).",
    description: 'Quality management approach and certifications (ISO 9001)',
    requirement_type: 'evidence',
    primary_domain: 'methodology',
    primary_subtopic: 'quality',
    secondary_domain: 'compliance',
    secondary_subtopic: 'certification',
    matching_keywords: [
      'quality management',
      'ISO 9001',
      'QMS',
      'quality assurance',
      'continuous improvement',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 61,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Part 3 — Modern Slavery (3 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Modern Slavery',
    section_name: 'Modern Slavery',
    question_number: 1,
    requirement_text:
      "Are you required to publish a modern slavery statement under section 54 of the Modern Slavery Act 2015? If yes, please provide a link to your most recent statement, or confirm that your statement is published on the Government's Modern Slavery Statement Registry.",
    description:
      'Modern Slavery Act 2015 statement publication requirement and link',
    requirement_type: 'evidence',
    primary_domain: 'compliance',
    primary_subtopic: 'modern-slavery',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'modern slavery',
      'Modern Slavery Act',
      'slavery statement',
      'section 54',
      'forced labour',
    ],
    matching_guidance:
      'Required for organisations with turnover above 36m per year',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 62,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Modern Slavery',
    section_name: 'Modern Slavery',
    question_number: 2,
    requirement_text:
      'Even if you are not required to publish a modern slavery statement, please describe the steps your organisation takes to ensure that modern slavery and human trafficking are not taking place in your business or supply chains.',
    description:
      'Measures to prevent modern slavery in business and supply chains',
    requirement_type: 'statement',
    primary_domain: 'compliance',
    primary_subtopic: 'modern-slavery',
    secondary_domain: 'corporate',
    secondary_subtopic: 'supply-chain',
    matching_keywords: [
      'modern slavery prevention',
      'human trafficking',
      'supply chain due diligence',
      'ethical supply chain',
      'forced labour prevention',
    ],
    matching_guidance:
      'Look for anti-slavery policies, supply chain due diligence, ethical procurement',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 63,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Part 3 - Modern Slavery',
    section_name: 'Modern Slavery',
    question_number: 3,
    requirement_text:
      'Do you have a process for reporting concerns about modern slavery or human trafficking? Please describe your whistleblowing arrangements in relation to modern slavery.',
    description:
      'Whistleblowing and concern reporting process for modern slavery',
    requirement_type: 'statement',
    primary_domain: 'compliance',
    primary_subtopic: 'modern-slavery',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'whistleblowing',
      'reporting concerns',
      'modern slavery reporting',
      'grievance mechanism',
      'speak up',
    ],
    matching_guidance: null,
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 64,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // Declaration (2 questions)
  // ═══════════════════════════════════════════════════════════════════════════
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Declaration',
    section_name: 'Declaration',
    question_number: 1,
    requirement_text:
      "I declare that to the best of my knowledge the answers submitted in this standard selection questionnaire are correct. I understand that the information will be used in the selection process to assess my organisation's suitability to be invited to participate further in this procurement. I understand that the contracting authority may reject my submission if there is a failure to answer all relevant questions fully or if I provide false or misleading information.",
    description:
      'Formal declaration of accuracy and understanding of procurement process',
    requirement_type: 'declaration',
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'declaration',
      'signatory',
      'accuracy statement',
      'procurement declaration',
    ],
    matching_guidance:
      'Standard declaration — does not typically require KB content',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 65,
  },
  {
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: 'Declaration',
    section_name: 'Declaration',
    question_number: 2,
    requirement_text:
      'Signatory details: name, role/position in organisation, date, signature. The person signing must be authorised to do so on behalf of the organisation.',
    description: 'Authorised signatory details for the questionnaire',
    requirement_type: 'data',
    primary_domain: null,
    primary_subtopic: null,
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: [
      'signatory',
      'authorised representative',
      'signing authority',
      'company secretary',
    ],
    matching_guidance:
      'Factual signatory details — does not require KB content',
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
    display_order: 66,
  },
];

// ── Embedding generation ───────────────────────────────────────────────────

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }

  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `OpenAI embedding API error: ${response.status} — ${error}`,
    );
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data[0].embedding;
}

function buildEmbeddingInput(req: TemplateRequirement): string {
  // Combine requirement text with keywords for richer semantic representation
  const keywords = req.matching_keywords.join(', ');
  return `${req.requirement_text}\n\nKeywords: ${keywords}`;
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { dryRun, skipEmbeddings, env } = parseCliArgs();

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  Standard Selection Questionnaire (PPN 03/24) Cataloguing');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  Requirements: ${REQUIREMENTS.length}`);
  console.log(`  Dry run:      ${dryRun}`);
  console.log(
    `  Embeddings:   ${skipEmbeddings ? 'SKIPPED' : 'will generate'}`,
  );
  console.log('');

  // Validate requirement count matches expected
  if (REQUIREMENTS.length !== 66) {
    console.error(
      `ERROR: Expected 66 requirements, got ${REQUIREMENTS.length}. Check data.`,
    );
    process.exit(1);
  }

  // Print section summary
  const sections = new Map<string, number>();
  for (const req of REQUIREMENTS) {
    const key = `${req.section_ref} — ${req.section_name}`;
    sections.set(key, (sections.get(key) || 0) + 1);
  }
  console.log('Section breakdown:');
  for (const [section, count] of sections) {
    console.log(`  ${section}: ${count} questions`);
  }
  console.log('');

  // Print domain distribution
  const domains = new Map<string, number>();
  for (const req of REQUIREMENTS) {
    const domain = req.primary_domain || '(none)';
    domains.set(domain, (domains.get(domain) || 0) + 1);
  }
  console.log('Domain distribution:');
  for (const [domain, count] of domains) {
    console.log(`  ${domain}: ${count}`);
  }
  console.log('');

  // Print requirement type distribution
  const types = new Map<string, number>();
  for (const req of REQUIREMENTS) {
    types.set(req.requirement_type, (types.get(req.requirement_type) || 0) + 1);
  }
  console.log('Requirement type distribution:');
  for (const [type, count] of types) {
    console.log(`  ${type}: ${count}`);
  }
  console.log('');

  if (dryRun) {
    console.log('DRY RUN — printing all requirements:\n');
    for (const req of REQUIREMENTS) {
      console.log(
        `  [${req.display_order}] ${req.section_ref} Q${req.question_number}: ${req.requirement_text.slice(0, 80)}...`,
      );
      console.log(
        `         type=${req.requirement_type} domain=${req.primary_domain || 'null'}/${req.primary_subtopic || 'null'} mandatory=${req.is_mandatory}`,
      );
      console.log(`         keywords=[${req.matching_keywords.join(', ')}]`);
      console.log('');
    }
    console.log('DRY RUN complete — no database changes made.');
    return;
  }

  // ── Supabase client ──

  const supabaseUrl =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      'ERROR: SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY are required.',
    );
    process.exit(1);
  }

  assertEnvFlag(env, supabaseUrl, 'scripts/catalogue-standard-sq.ts');

  const supabase = createScriptClient(supabaseUrl, supabaseKey);

  // ── Check for existing rows (idempotency) ──

  console.log('Checking for existing requirements...');
  // Post-T2: `template_requirements` renamed to `form_template_requirements`.
  const { data: existing, error: checkError } = await supabase
    .from('form_template_requirements')
    .select('id, section_ref, question_number')
    .eq('template_name', TEMPLATE_NAME)
    .eq('template_version', TEMPLATE_VERSION);

  if (checkError) {
    console.error('ERROR checking existing rows:', checkError.message);
    process.exit(1);
  }

  if (existing && existing.length > 0) {
    console.log(
      `Found ${existing.length} existing requirements for ${TEMPLATE_NAME} (${TEMPLATE_VERSION}).`,
    );
    console.log('To re-catalogue, delete existing rows first:');
    console.log(
      `  DELETE FROM template_requirements WHERE template_name = '${TEMPLATE_NAME}' AND template_version = '${TEMPLATE_VERSION}';`,
    );
    console.log('');
    console.log('Aborting to prevent duplicates.');
    process.exit(0);
  }

  // ── Generate embeddings ──

  const rows: InsertRow[] = [];

  if (!skipEmbeddings) {
    console.log('Generating embeddings for all 66 requirements...');
    console.log(
      `  Model: ${EMBEDDING_MODEL}, dimensions: ${EMBEDDING_DIMENSIONS}`,
    );
    console.log('');

    for (let i = 0; i < REQUIREMENTS.length; i++) {
      const req = REQUIREMENTS[i];
      const input = buildEmbeddingInput(req);

      process.stdout.write(
        `  [${i + 1}/${REQUIREMENTS.length}] ${req.section_ref} Q${req.question_number}...`,
      );

      try {
        const embedding = await generateEmbedding(input);
        rows.push({
          ...req,
          requirement_embedding: JSON.stringify(embedding),
          is_current: true,
        });
        console.log(' done');
      } catch (err) {
        console.log(` FAILED: ${err}`);
        console.error(
          `\nERROR: Failed to generate embedding for requirement ${i + 1}. Aborting.`,
        );
        process.exit(1);
      }

      // Small delay to avoid rate limiting (50ms between requests)
      if (i < REQUIREMENTS.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    console.log('');
  } else {
    console.log('Skipping embeddings (--skip-embeddings flag).');
    console.log('');
    for (const req of REQUIREMENTS) {
      rows.push({
        ...req,
        is_current: true,
      });
    }
  }

  // ── Insert into database ──

  console.log(
    `Inserting ${rows.length} requirements into template_requirements...`,
  );

  // Insert in batches of 10 to avoid payload size limits
  const BATCH_SIZE = 10;
  let inserted = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    // Post-T2: `template_requirements` renamed to `form_template_requirements`.
    const { error: insertError } = await supabase
      .from('form_template_requirements')
      .insert(batch);

    if (insertError) {
      console.error(
        `ERROR inserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`,
        insertError.message,
      );
      console.error('  Rows inserted before failure:', inserted);
      console.error('  You may need to clean up partial inserts with:');
      console.error(
        `  DELETE FROM template_requirements WHERE template_name = '${TEMPLATE_NAME}' AND template_version = '${TEMPLATE_VERSION}';`,
      );
      process.exit(1);
    }

    inserted += batch.length;
    console.log(
      `  Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${inserted}/${rows.length} inserted`,
    );
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`  SUCCESS: ${inserted} requirements catalogued`);
  console.log(`  Template: ${TEMPLATE_NAME} (${TEMPLATE_VERSION})`);
  console.log(
    `  Embeddings: ${skipEmbeddings ? 'not generated' : 'generated and stored'}`,
  );
  console.log('═══════════════════════════════════════════════════════════');
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
