/**
 * Content creation templates — code constants (Phase 1).
 *
 * These templates pre-fill the create content form with suggested structure
 * and metadata. In a future phase, they will be backed by the
 * content_templates database table.
 */

export interface ContentTemplate {
  id: string;
  slug: string;
  name: string;
  description: string;
  contentType: string;
  titleTemplate: string;
  contentTemplate: string;
  briefTemplate?: string;
  suggestedDomain?: string;
  defaultTags?: string[];
}

export const CONTENT_TEMPLATES: ContentTemplate[] = [
  {
    id: 'policy',
    slug: 'policy',
    name: 'Policy Document',
    description:
      'Company policy with scope, requirements, and compliance information',
    contentType: 'policy',
    titleTemplate: '',
    contentTemplate: [
      '## Policy Statement',
      '',
      'Describe the policy and its purpose.',
      '',
      '## Scope',
      '',
      'Who and what does this policy apply to?',
      '',
      '## Requirements',
      '',
      'What are the specific requirements?',
      '',
      '## Compliance',
      '',
      'How is compliance measured and enforced?',
      '',
      '## Review Date',
      '',
      'When will this policy next be reviewed?',
    ].join('\n'),
    suggestedDomain: 'Governance & Compliance',
    defaultTags: ['policy'],
  },
  {
    id: 'case-study',
    slug: 'case-study',
    name: 'Case Study',
    description: 'Client project with challenge, approach, and outcomes',
    contentType: 'case_study',
    titleTemplate: '',
    contentTemplate: [
      '## Client and Context',
      '',
      'Who was the client and what was the situation?',
      '',
      '## Challenge',
      '',
      'What problem needed solving?',
      '',
      '## Our Approach',
      '',
      'What did we do and why?',
      '',
      '## Outcomes',
      '',
      'What were the results? Include metrics where possible.',
      '',
      '## Lessons Learned',
      '',
      'What would we do differently?',
    ].join('\n'),
    suggestedDomain: 'Track Record',
    defaultTags: ['case-study'],
  },
  {
    id: 'capability',
    slug: 'capability',
    name: 'Capability Statement',
    description:
      'Service or capability description with evidence and differentiators',
    contentType: 'capability',
    titleTemplate: '',
    contentTemplate: [
      '## Capability Overview',
      '',
      'What is this capability?',
      '',
      '## Our Experience',
      '',
      'How long have we been doing this? Key statistics.',
      '',
      '## Approach',
      '',
      'How do we deliver this capability?',
      '',
      '## Differentiators',
      '',
      'What makes our approach unique?',
      '',
      '## Evidence',
      '',
      'Certifications, awards, client references.',
    ].join('\n'),
    suggestedDomain: 'Company Overview',
    defaultTags: [],
  },
  {
    id: 'methodology',
    slug: 'methodology',
    name: 'Methodology',
    description:
      'Process or methodology description with stages and governance',
    contentType: 'methodology',
    titleTemplate: '',
    contentTemplate: [
      '## Overview',
      '',
      'What is this methodology and when is it used?',
      '',
      '## Stages',
      '',
      'List the key stages or phases.',
      '',
      '## Governance',
      '',
      'How is quality assured at each stage?',
      '',
      '## Tools and Techniques',
      '',
      'What tools or techniques support this methodology?',
    ].join('\n'),
    suggestedDomain: 'Technical & Delivery',
    defaultTags: [],
  },
  {
    id: 'qa-pair',
    slug: 'qa-pair',
    name: 'Q&A Pair',
    description: 'Standard question and answer for bid library',
    contentType: 'q_a_pair',
    titleTemplate: '',
    contentTemplate: '',
    briefTemplate: '',
  },
];
