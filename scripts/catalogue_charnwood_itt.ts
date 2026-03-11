/**
 * Catalogue Charnwood Borough Council ITT Services requirements.
 *
 * Inserts 30 requirements into template_requirements, pre-computes
 * embeddings via OpenAI, and creates entity graph relationships.
 *
 * Source: docs/reference/uat-scenario-2b-results.md (Session 83)
 *
 * Usage:
 *   bun run scripts/catalogue_charnwood_itt.ts
 *   bun run scripts/catalogue_charnwood_itt.ts --dry-run
 */

import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { createClient } from '@supabase/supabase-js';
import OpenAI from 'openai';

// ── Env loading (mirrors calibrate_coverage_thresholds.ts) ──

function loadEnvFile(filePath: string): void {
  try {
    const content = readFileSync(filePath, 'utf-8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIndex = trimmed.indexOf('=');
      if (eqIndex === -1) continue;
      const key = trimmed.slice(0, eqIndex).trim();
      let value = trimmed.slice(eqIndex + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // File doesn't exist — fine
  }
}

function findProjectRoot(): string {
  const scriptDir = dirname(new URL(import.meta.url).pathname);
  const candidates = new Set<string>();

  let dir = resolve(scriptDir, '..');
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  for (const root of candidates) {
    if (
      existsSync(resolve(root, '.env')) ||
      existsSync(resolve(root, '.env.local'))
    ) {
      return root;
    }
  }

  return resolve(scriptDir, '..');
}

const PROJECT_ROOT = findProjectRoot();
loadEnvFile(resolve(PROJECT_ROOT, '.env.local'));
loadEnvFile(resolve(PROJECT_ROOT, '.env'));

// ── CLI args ──

const DRY_RUN = process.argv.includes('--dry-run');

// ── Constants ──

const TEMPLATE_NAME = 'Charnwood ITT Services';
const TEMPLATE_TYPE = 'rfp';
const TEMPLATE_VERSION = null;
const EMBEDDING_MODEL = 'text-embedding-3-large';
const EMBEDDING_DIMENSIONS = 1024;

// ── Requirement definitions (30 questions, 10 sections) ──

interface RequirementDef {
  section_ref: string;
  section_name: string;
  question_number: number;
  requirement_text: string;
  description: string;
  requirement_type: string;
  primary_domain: string | null;
  primary_subtopic: string | null;
  secondary_domain: string | null;
  secondary_subtopic: string | null;
  matching_keywords: string[];
  is_mandatory: boolean;
  sector_applicability: string[] | null;
  word_limit_guidance: number | null;
}

const REQUIREMENTS: RequirementDef[] = [
  // ── Schedule 5 — Business Questionnaire (8 questions) ──
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 1,
    requirement_text: 'Provide details of your annual turnover for the last three financial years.',
    description: 'Financial standing — annual turnover evidence',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'financial-standing',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['turnover', 'revenue', 'financial', 'accounts', 'annual turnover', 'financial year'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 2,
    requirement_text: 'Confirm you hold Employer\'s Liability insurance cover of at least £5 million and provide evidence.',
    description: 'Insurance — employer\'s liability cover',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'insurance',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['insurance', 'employers liability', 'indemnity', 'cover', 'policy', 'certificate'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 3,
    requirement_text: 'Confirm you hold Public Liability insurance cover of at least £5 million and provide evidence.',
    description: 'Insurance — public liability cover',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'insurance',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['public liability', 'insurance', 'cover', 'indemnity', 'certificate'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 4,
    requirement_text: 'Confirm you hold Professional Indemnity insurance cover and provide evidence.',
    description: 'Insurance — professional indemnity cover',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'insurance',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['professional indemnity', 'PI insurance', 'insurance', 'cover', 'certificate'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 5,
    requirement_text: 'Provide details of any environmental policy or environmental management system your organisation has in place.',
    description: 'Environmental policy or management system',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['environmental', 'ISO 14001', 'carbon', 'sustainability', 'environmental policy', 'green'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 500,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 6,
    requirement_text: 'Has your organisation or any director/partner been subject to bankruptcy, insolvency, winding-up or equivalent proceedings?',
    description: 'Legal history — bankruptcy/insolvency declaration',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'financial-standing',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['bankruptcy', 'insolvency', 'winding up', 'liquidation', 'administration'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 7,
    requirement_text: 'Has your organisation or any director/partner been convicted of a criminal offence relating to business or professional conduct?',
    description: 'Legal history — criminal convictions declaration',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['criminal', 'conviction', 'fraud', 'misconduct', 'offence'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 5',
    section_name: 'Business Questionnaire',
    question_number: 8,
    requirement_text: 'Provide details of any relevant licences, accreditations, or professional body memberships held.',
    description: 'Licences, accreditations, and memberships',
    requirement_type: 'evidence',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['licence', 'accreditation', 'membership', 'certification', 'ISO', 'professional body'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },

  // ── Schedule 6 — Legal Obligations (7 questions) ──
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 1,
    requirement_text: 'Provide a copy of your written equalities statement or equal opportunities policy.',
    description: 'Equalities Act 2010 — written statement',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'equalities',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['equalities', 'equal opportunities', 'diversity', 'inclusion', 'Equalities Act 2010', 'protected characteristics'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 500,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 2,
    requirement_text: 'Confirm your compliance with the Health and Safety at Work etc. Act 1974 and provide your health and safety policy.',
    description: 'Health and Safety Act compliance + policy',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['health and safety', 'H&S', 'HASAWA', 'risk assessment', 'safe working', 'HSE'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 500,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 3,
    requirement_text: 'Describe the health and safety measures you will implement in delivering the services.',
    description: 'Health and safety delivery measures',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'health-and-safety',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['health and safety', 'risk assessment', 'safe systems of work', 'PPE', 'COSHH', 'method statement'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 750,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 4,
    requirement_text: 'Confirm compliance with the Modern Slavery Act 2015 and provide your modern slavery statement.',
    description: 'Modern Slavery Act 2015 — statement',
    requirement_type: 'statement',
    primary_domain: 'compliance',
    primary_subtopic: 'modern-slavery',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['modern slavery', 'forced labour', 'human trafficking', 'supply chain', 'Modern Slavery Act'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 5,
    requirement_text: 'Confirm your organisation complies with all statutory obligations and regulations applicable to the services.',
    description: 'General statutory compliance declaration',
    requirement_type: 'declaration',
    primary_domain: 'compliance',
    primary_subtopic: 'regulatory',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['statutory', 'compliance', 'regulation', 'legislation', 'legal obligations'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 6,
    requirement_text: 'Provide details of your safeguarding policy and confirm DBS check arrangements for staff who will deliver the services.',
    description: 'Safeguarding policy + DBS checks',
    requirement_type: 'policy',
    primary_domain: 'compliance',
    primary_subtopic: 'safeguarding',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['safeguarding', 'DBS', 'disclosure', 'barring', 'child protection', 'vulnerable adults'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 500,
  },
  {
    section_ref: 'Schedule 6',
    section_name: 'Legal Obligations',
    question_number: 7,
    requirement_text: 'Describe how your organisation ensures the safeguarding of vulnerable persons in the delivery of services.',
    description: 'Safeguarding delivery approach',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'safeguarding',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['safeguarding', 'vulnerable', 'duty of care', 'risk assessment', 'supervision', 'training'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 750,
  },

  // ── Schedule 8 Section A — Company Details (5 questions) ──
  {
    section_ref: 'Schedule 8 Section A',
    section_name: 'Company Details',
    question_number: 1,
    requirement_text: 'Provide your full company name and registered office address.',
    description: 'Company name and registered address',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['company name', 'registered office', 'address', 'registered address'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 8 Section A',
    section_name: 'Company Details',
    question_number: 2,
    requirement_text: 'Provide your company registration number.',
    description: 'Companies House registration number',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['company registration', 'Companies House', 'registration number', 'company number'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 8 Section A',
    section_name: 'Company Details',
    question_number: 3,
    requirement_text: 'State the total number of employees in your organisation.',
    description: 'Employee count',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['employees', 'headcount', 'staff', 'workforce', 'FTE'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 8 Section A',
    section_name: 'Company Details',
    question_number: 4,
    requirement_text: 'If part of a group of companies, provide details of the parent company and group structure.',
    description: 'Group company structure',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['parent company', 'group structure', 'subsidiary', 'holding company', 'corporate structure'],
    is_mandatory: false,
    sector_applicability: null,
    word_limit_guidance: null,
  },
  {
    section_ref: 'Schedule 8 Section A',
    section_name: 'Company Details',
    question_number: 5,
    requirement_text: 'Confirm you consent to a credit check being carried out on your organisation.',
    description: 'Credit check consent',
    requirement_type: 'declaration',
    primary_domain: 'corporate',
    primary_subtopic: 'financial-standing',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['credit check', 'credit reference', 'Dun & Bradstreet', 'financial check'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },

  // ── Schedule 8 Section B — References (1 question) ──
  {
    section_ref: 'Schedule 8 Section B',
    section_name: 'References',
    question_number: 1,
    requirement_text: 'Provide details of two contracts of a similar nature undertaken in the last three years, including client name, contract value, and a referee contact.',
    description: 'Contract references with referee details',
    requirement_type: 'reference',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['reference', 'contract', 'case study', 'referee', 'similar contract', 'testimonial'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },

  // ── Schedule 8 Section C — Experience (1 question) ──
  {
    section_ref: 'Schedule 8 Section C',
    section_name: 'Experience',
    question_number: 1,
    requirement_text: 'Describe your organisation\'s relevant experience in providing services of a similar nature and scale.',
    description: 'Relevant experience narrative',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'references',
    secondary_domain: 'corporate',
    secondary_subtopic: 'methodology',
    matching_keywords: ['experience', 'track record', 'similar services', 'capability', 'portfolio', 'history'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 1000,
  },

  // ── Schedule 8 Section D — Proposed Working Methods (4 questions) ──
  {
    section_ref: 'Schedule 8 Section D',
    section_name: 'Proposed Working Methods',
    question_number: 1,
    requirement_text: 'Describe the arrangements you will put in place for the delivery of the services, including management structure, staffing, and reporting.',
    description: 'Method statement — delivery arrangements',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'methodology',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['method statement', 'delivery', 'management structure', 'staffing', 'reporting', 'arrangements'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 1500,
  },
  {
    section_ref: 'Schedule 8 Section D',
    section_name: 'Proposed Working Methods',
    question_number: 2,
    requirement_text: 'Outline the key steps and milestones for mobilisation and ongoing delivery of the services.',
    description: 'Method statement — key steps and milestones',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'methodology',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['mobilisation', 'milestones', 'implementation', 'key steps', 'timeline', 'programme'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 1500,
  },
  {
    section_ref: 'Schedule 8 Section D',
    section_name: 'Proposed Working Methods',
    question_number: 3,
    requirement_text: 'Describe any efficiencies, innovations, or added value you will bring to the delivery of the services.',
    description: 'Method statement — efficiencies and innovation',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'methodology',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['efficiency', 'innovation', 'added value', 'continuous improvement', 'cost saving', 'best practice'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 1000,
  },
  {
    section_ref: 'Schedule 8 Section D',
    section_name: 'Proposed Working Methods',
    question_number: 4,
    requirement_text: 'Identify the main challenges and risks in delivering the services and explain how you would mitigate them.',
    description: 'Method statement — risks and mitigation',
    requirement_type: 'narrative',
    primary_domain: 'corporate',
    primary_subtopic: 'methodology',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['risk', 'challenge', 'mitigation', 'contingency', 'risk management', 'business continuity'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 1000,
  },

  // ── Schedule 8 Section E — Environmental Responsibility (1 question) ──
  {
    section_ref: 'Schedule 8 Section E',
    section_name: 'Environmental Responsibility',
    question_number: 1,
    requirement_text: 'Describe the measures you will take to minimise the carbon footprint and environmental impact of delivering the services.',
    description: 'Carbon footprint and environmental impact measures',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'environmental',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['carbon footprint', 'environmental impact', 'sustainability', 'net zero', 'carbon reduction', 'PPN 06/20'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 750,
  },

  // ── Schedule 8 Section F — Safeguarding (1 question) ──
  {
    section_ref: 'Schedule 8 Section F',
    section_name: 'Safeguarding',
    question_number: 1,
    requirement_text: 'Describe how you will ensure safeguarding responsibilities are met throughout the delivery of the services.',
    description: 'Safeguarding in service delivery',
    requirement_type: 'narrative',
    primary_domain: 'compliance',
    primary_subtopic: 'safeguarding',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['safeguarding', 'vulnerable persons', 'duty of care', 'DBS', 'training', 'supervision'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: 750,
  },

  // ── Schedule 9 — Payment Details (1 question) ──
  {
    section_ref: 'Schedule 9',
    section_name: 'Payment Details',
    question_number: 1,
    requirement_text: 'Provide your bank details for BACS payment, including bank name, sort code, and account number.',
    description: 'Bank details for BACS payment',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['bank details', 'BACS', 'sort code', 'account number', 'payment'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },

  // ── Schedule 15 — Supplier's Contact Information (1 question) ──
  {
    section_ref: 'Schedule 15',
    section_name: "Supplier's Contact Information",
    question_number: 1,
    requirement_text: 'Provide the name, role, email address, and telephone number of the primary contact person for this tender.',
    description: 'Tender contact person details',
    requirement_type: 'data',
    primary_domain: 'corporate',
    primary_subtopic: 'company-overview',
    secondary_domain: null,
    secondary_subtopic: null,
    matching_keywords: ['contact', 'primary contact', 'email', 'telephone', 'tender contact'],
    is_mandatory: true,
    sector_applicability: null,
    word_limit_guidance: null,
  },
];

// ── Entity graph relationships to create ──

const ENTITY_RELATIONSHIPS = [
  { target: 'annual turnover', type: 'requires' },
  { target: 'employers liability insurance', type: 'requires' },
  { target: 'public liability insurance', type: 'requires' },
  { target: 'professional indemnity insurance', type: 'requires' },
  { target: 'environmental policy', type: 'requires' },
  { target: 'equalities statement', type: 'requires' },
  { target: 'health and safety policy', type: 'requires' },
  { target: 'modern slavery statement', type: 'requires' },
  { target: 'safeguarding policy', type: 'requires' },
  { target: 'contract references', type: 'requires' },
  { target: 'method statement', type: 'requires' },
  { target: 'carbon reduction plan', type: 'requires' },
  { target: 'company registration', type: 'requires' },
];

// ── Main ──

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SECRET_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY');
    process.exit(1);
  }

  if (!openaiKey) {
    console.error('Missing OPENAI_API_KEY');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const openai = new OpenAI({ apiKey: openaiKey });

  console.log(`\n📋 Cataloguing: ${TEMPLATE_NAME}`);
  console.log(`   ${REQUIREMENTS.length} requirements across ${new Set(REQUIREMENTS.map(r => r.section_ref)).size} sections`);
  if (DRY_RUN) console.log('   🔸 DRY RUN — no database changes will be made\n');
  else console.log('');

  // ── Step 1: Upsert requirements ──

  console.log('Step 1: Inserting requirements...');

  const rows = REQUIREMENTS.map((req, i) => ({
    template_name: TEMPLATE_NAME,
    template_version: TEMPLATE_VERSION,
    template_type: TEMPLATE_TYPE,
    section_ref: req.section_ref,
    section_name: req.section_name,
    question_number: req.question_number,
    requirement_text: req.requirement_text,
    description: req.description,
    requirement_type: req.requirement_type,
    primary_domain: req.primary_domain,
    primary_subtopic: req.primary_subtopic,
    secondary_domain: req.secondary_domain,
    secondary_subtopic: req.secondary_subtopic,
    matching_keywords: req.matching_keywords,
    is_mandatory: req.is_mandatory,
    is_current: true,
    sector_applicability: req.sector_applicability,
    word_limit_guidance: req.word_limit_guidance,
    display_order: i + 1,
  }));

  if (!DRY_RUN) {
    const { error: insertError } = await supabase
      .from('template_requirements')
      .upsert(rows, {
        onConflict: 'template_name,template_version,section_ref,question_number',
        ignoreDuplicates: false,
      });

    if (insertError) {
      console.error('❌ Insert failed:', insertError.message);
      process.exit(1);
    }
  }

  console.log(`   ✅ ${rows.length} requirements upserted`);

  // ── Step 2: Generate embeddings ──

  console.log('\nStep 2: Generating embeddings...');

  // Fetch inserted rows to get IDs
  const { data: insertedRows, error: fetchError } = await supabase
    .from('template_requirements')
    .select('id, requirement_text, description')
    .eq('template_name', TEMPLATE_NAME)
    .eq('is_current', true)
    .order('display_order');

  if (fetchError) {
    console.error('❌ Failed to fetch inserted rows:', fetchError.message);
    process.exit(1);
  }

  if (!insertedRows || insertedRows.length === 0) {
    console.error('❌ No rows found after insert');
    process.exit(1);
  }

  let embeddingsGenerated = 0;

  for (const row of insertedRows) {
    const textForEmbedding = `${row.requirement_text}${row.description ? ' ' + row.description : ''}`;

    try {
      const response = await openai.embeddings.create({
        model: EMBEDDING_MODEL,
        input: textForEmbedding,
        dimensions: EMBEDDING_DIMENSIONS,
      });

      const embedding = response.data[0].embedding;

      if (!DRY_RUN) {
        const { error: updateError } = await supabase
          .from('template_requirements')
          .update({ requirement_embedding: JSON.stringify(embedding) })
          .eq('id', row.id);

        if (updateError) {
          console.error(`   ⚠️ Failed to update embedding for ${row.id}: ${updateError.message}`);
          continue;
        }
      }

      embeddingsGenerated++;
      process.stdout.write(`   ${embeddingsGenerated}/${insertedRows.length}\r`);
    } catch (err) {
      console.error(`   ⚠️ Embedding failed for ${row.id}:`, err);
    }
  }

  console.log(`   ✅ ${embeddingsGenerated}/${insertedRows.length} embeddings generated`);

  // ── Step 3: Entity graph relationships ──

  console.log('\nStep 3: Creating entity graph relationships...');

  if (!DRY_RUN) {
    const relationshipRows = ENTITY_RELATIONSHIPS.map(rel => ({
      source_entity: TEMPLATE_NAME,
      relationship_type: rel.type,
      target_entity: rel.target,
      confidence: 1.0,
    }));

    // Delete existing relationships for this template first (idempotent)
    await supabase
      .from('entity_relationships')
      .delete()
      .eq('source_entity', TEMPLATE_NAME);

    const { error: relError } = await supabase
      .from('entity_relationships')
      .insert(relationshipRows);

    if (relError) {
      console.error(`   ⚠️ Entity relationships failed: ${relError.message}`);
    } else {
      console.log(`   ✅ ${relationshipRows.length} relationships created`);
    }
  } else {
    console.log(`   🔸 Would create ${ENTITY_RELATIONSHIPS.length} relationships`);
  }

  // ── Summary ──

  console.log('\n────────────────────────────────────────');
  console.log(`✅ ${TEMPLATE_NAME} catalogued successfully`);
  console.log(`   ${rows.length} requirements`);
  console.log(`   ${embeddingsGenerated} embeddings`);
  console.log(`   ${ENTITY_RELATIONSHIPS.length} entity relationships`);
  if (DRY_RUN) console.log('   🔸 DRY RUN — no changes were saved');
  console.log('────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
