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
      '<h2>Policy Statement</h2>',
      '<p>Describe the policy and its purpose.</p>',
      '<h2>Scope</h2>',
      '<p>Who and what does this policy apply to?</p>',
      '<h2>Requirements</h2>',
      '<p>What are the specific requirements?</p>',
      '<h2>Compliance</h2>',
      '<p>How is compliance measured and enforced?</p>',
      '<h2>Review Date</h2>',
      '<p>When will this policy next be reviewed?</p>',
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
      '<h2>Client and Context</h2>',
      '<p>Who was the client and what was the situation?</p>',
      '<h2>Challenge</h2>',
      '<p>What problem needed solving?</p>',
      '<h2>Our Approach</h2>',
      '<p>What did we do and why?</p>',
      '<h2>Outcomes</h2>',
      '<p>What were the results? Include metrics where possible.</p>',
      '<h2>Lessons Learned</h2>',
      '<p>What would we do differently?</p>',
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
      '<h2>Capability Overview</h2>',
      '<p>What is this capability?</p>',
      '<h2>Our Experience</h2>',
      '<p>How long have we been doing this? Key statistics.</p>',
      '<h2>Approach</h2>',
      '<p>How do we deliver this capability?</p>',
      '<h2>Differentiators</h2>',
      '<p>What makes our approach unique?</p>',
      '<h2>Evidence</h2>',
      '<p>Certifications, awards, client references.</p>',
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
      '<h2>Overview</h2>',
      '<p>What is this methodology and when is it used?</p>',
      '<h2>Stages</h2>',
      '<p>List the key stages or phases.</p>',
      '<h2>Governance</h2>',
      '<p>How is quality assured at each stage?</p>',
      '<h2>Tools and Techniques</h2>',
      '<p>What tools or techniques support this methodology?</p>',
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
