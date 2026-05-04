export const MCP_EVAL_SEED_TITLE_PREFIX = '[MCP-SEED]';
export const MCP_EVAL_SEED_VERSION = 1;
export const MCP_EVAL_SEED_METADATA_FLAG = 'mcp_eval_seed';
export const MCP_EVAL_SEED_ROLE_SIMILARITY_SOURCE = 'similarity_source';
export const MCP_EVAL_SEED_GUIDE_ID = '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00201';
export const MCP_EVAL_SEED_GUIDE_SLUG = 'mcp-eval-guide';

export interface McpEvalSeedItem {
  id: string;
  key: string;
  role?: string;
  question: string;
  answerStandard: string;
  answerAdvanced?: string;
  primaryDomain: string;
  primarySubtopic: string;
  secondaryDomain?: string;
  secondarySubtopic?: string;
  layer: string;
  keywords: string[];
  summary: string;
}

export interface McpEvalSeedGuideSection {
  id: string;
  sectionName: string;
  description: string;
  expectedLayer: string;
  subtopicFilter: string;
  displayOrder: number;
}

export const MCP_EVAL_SEED_METADATA = {
  [MCP_EVAL_SEED_METADATA_FLAG]: true,
  mcp_eval_seed_suite: 'mcp-eval',
  mcp_eval_seed_version: MCP_EVAL_SEED_VERSION,
  source: 'synthetic',
} as const;

export const MCP_EVAL_SEED_GUIDE_SECTIONS: McpEvalSeedGuideSection[] = [
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00202',
    sectionName: 'Security and Compliance',
    description:
      'Deterministic MCP eval guide section covering security and compliance responses.',
    expectedLayer: 'bid_detail',
    subtopicFilter: 'iso-27001',
    displayOrder: 1,
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00203',
    sectionName: 'Data Protection',
    description:
      'Deterministic MCP eval guide section covering GDPR and data protection responses.',
    expectedLayer: 'bid_detail',
    subtopicFilter: 'data-protection',
    displayOrder: 2,
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00204',
    sectionName: 'Service Levels',
    description:
      'Deterministic MCP eval guide section covering support SLA responses.',
    expectedLayer: 'bid_detail',
    subtopicFilter: 'sla',
    displayOrder: 3,
  },
];

export const MCP_EVAL_SEED_ITEMS: McpEvalSeedItem[] = [
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00101',
    key: 'iso-27001-isms-overview',
    role: MCP_EVAL_SEED_ROLE_SIMILARITY_SOURCE,
    question: 'Describe your ISO 27001 certification and ISMS controls.',
    answerStandard:
      'We operate an ISO 27001-aligned information security management system with documented policies, risk assessment, internal audit, management review, supplier assurance, and continuous improvement controls. Security responsibilities are assigned to named owners and evidence is maintained for audit and bid assurance.',
    answerAdvanced:
      'Our ISMS is structured around risk ownership, control monitoring, internal audit, and management review. It covers asset management, access control, supplier assurance, incident response, vulnerability management, and continual improvement. Evidence packs can include policy registers, audit schedules, risk treatment plans, and security governance minutes.',
    primaryDomain: 'security',
    primarySubtopic: 'iso-27001',
    secondaryDomain: 'compliance',
    secondarySubtopic: 'standards',
    layer: 'bid_detail',
    keywords: ['ISO 27001', 'ISMS', 'security', 'certification', 'audit'],
    summary:
      'Reusable Q&A answer covering ISO 27001 certification and ISMS governance controls.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00102',
    key: 'iso-27001-access-control',
    question: 'How do you control user access under ISO 27001?',
    answerStandard:
      'User access is controlled through role-based permissions, least privilege, joiner-mover-leaver reviews, multi-factor authentication where appropriate, and periodic access recertification. Access requests are approved by authorised owners and privileged accounts are monitored.',
    primaryDomain: 'security',
    primarySubtopic: 'access-control',
    secondaryDomain: 'compliance',
    secondarySubtopic: 'audit',
    layer: 'bid_detail',
    keywords: ['ISO 27001', 'access control', 'MFA', 'least privilege'],
    summary:
      'Reusable Q&A answer for access-control evidence and ISO 27001 user-permission controls.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00103',
    key: 'iso-27001-incident-response',
    question:
      'What is your incident response process for information security events?',
    answerStandard:
      'Security incidents are triaged, prioritised, contained, investigated, and remediated through a documented incident response process. Lessons learned are captured after material incidents and feed into risk reviews, control improvements, and staff awareness activity.',
    primaryDomain: 'security',
    primarySubtopic: 'iso-27001',
    secondaryDomain: 'support',
    secondarySubtopic: 'incident',
    layer: 'bid_detail',
    keywords: [
      'ISO 27001',
      'incident response',
      'security event',
      'remediation',
    ],
    summary:
      'Reusable Q&A answer covering security incident response and continual improvement.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00104',
    key: 'gdpr-data-processing',
    question: 'How do you comply with GDPR and data protection requirements?',
    answerStandard:
      'We apply GDPR principles through data minimisation, lawful processing, privacy-by-design controls, documented retention periods, role-based access, secure transfer, and supplier due diligence. Data protection responsibilities are assigned and reviewed through governance processes.',
    primaryDomain: 'security',
    primarySubtopic: 'data-protection',
    secondaryDomain: 'compliance',
    secondarySubtopic: 'regulatory',
    layer: 'bid_detail',
    keywords: ['GDPR', 'data protection', 'privacy', 'processing', 'retention'],
    summary:
      'Reusable Q&A answer for GDPR compliance and data-protection governance.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00105',
    key: 'gdpr-subject-rights',
    question: 'How are data subject rights and DSAR requests handled?',
    answerStandard:
      'Data subject requests are logged, verified, assessed, and responded to within statutory timescales. The process covers access, rectification, erasure, restriction, portability, and objection requests, with escalation to the data protection lead where required.',
    primaryDomain: 'security',
    primarySubtopic: 'data-protection',
    secondaryDomain: 'compliance',
    secondarySubtopic: 'regulatory',
    layer: 'bid_detail',
    keywords: ['GDPR', 'DSAR', 'subject access', 'data protection', 'privacy'],
    summary: 'Reusable Q&A answer for DSAR handling and data subject rights.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00106',
    key: 'gdpr-retention-deletion',
    question: 'What is your approach to data retention and secure deletion?',
    answerStandard:
      'Retention periods are defined according to contractual, legal, and operational requirements. Data is reviewed against retention schedules and securely deleted or anonymised when no longer required, with disposal activities controlled through documented procedures.',
    primaryDomain: 'security',
    primarySubtopic: 'data-protection',
    secondaryDomain: 'compliance',
    secondarySubtopic: 'audit',
    layer: 'bid_detail',
    keywords: ['GDPR', 'retention', 'secure deletion', 'data protection'],
    summary:
      'Reusable Q&A answer for retention schedules and secure data disposal.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00107',
    key: 'sla-response-times',
    question: 'What SLA response times do you provide for support requests?',
    answerStandard:
      'Support SLAs define target response and resolution times by priority. Critical incidents receive the fastest response, high-priority issues are triaged promptly, and standard requests are managed through agreed service windows with status updates until closure.',
    primaryDomain: 'support',
    primarySubtopic: 'sla',
    secondaryDomain: 'support',
    secondarySubtopic: 'incident',
    layer: 'bid_detail',
    keywords: ['SLA', 'response times', 'support', 'incident', 'resolution'],
    summary:
      'Reusable Q&A answer for service-level response and resolution targets.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00108',
    key: 'sla-availability-monitoring',
    question:
      'How do you monitor availability and service performance against SLAs?',
    answerStandard:
      'Availability and service performance are monitored using operational dashboards, incident records, and service review reporting. SLA performance is reviewed with stakeholders, with corrective actions tracked where targets are missed.',
    primaryDomain: 'support',
    primarySubtopic: 'sla',
    secondaryDomain: 'support',
    secondarySubtopic: 'maintenance',
    layer: 'bid_detail',
    keywords: [
      'SLA',
      'availability',
      'performance monitoring',
      'service review',
    ],
    summary:
      'Reusable Q&A answer for SLA monitoring, availability reporting, and service reviews.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00109',
    key: 'staff-qualifications-cvs',
    question: 'How do you evidence staff qualifications, experience, and CVs?',
    answerStandard:
      'Key personnel are selected for relevant qualifications, role experience, delivery capability, and sector knowledge. CVs can be provided for named roles and include responsibilities, certifications, project experience, and escalation coverage.',
    primaryDomain: 'corporate',
    primarySubtopic: 'staffing',
    secondaryDomain: 'methodology',
    secondarySubtopic: 'delivery',
    layer: 'bid_detail',
    keywords: [
      'staff qualifications',
      'CVs',
      'personnel',
      'experience',
      'delivery',
    ],
    summary:
      'Reusable Q&A answer for bid questions about staffing, qualifications, and CV evidence.',
  },
  {
    id: '2f1d83c0-8b43-4b9a-94d9-f0f8a7e00110',
    key: 'implementation-onboarding',
    question: 'Describe your implementation and onboarding approach.',
    answerStandard:
      'Implementation is managed through discovery, planning, configuration, migration, testing, training, go-live, and hypercare. The approach uses clear milestones, named responsibilities, risk tracking, and structured stakeholder communication.',
    primaryDomain: 'implementation',
    primarySubtopic: 'onboarding',
    secondaryDomain: 'methodology',
    secondarySubtopic: 'project-management',
    layer: 'bid_detail',
    keywords: [
      'implementation',
      'onboarding',
      'migration',
      'training',
      'go-live',
    ],
    summary:
      'Reusable Q&A answer for implementation planning, onboarding, and go-live support.',
  },
];
