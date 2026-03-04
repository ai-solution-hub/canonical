export const DOMAINS = {
  'AI & EMERGING TECH': {
    colour: 'ai',
    subtopics: [
      'ai-models-llms',
      'ai-tools-frameworks',
      'ai-research',
      'ai-implementation-practice',
      'technical-implementation',
      'ai-safety-governance',
    ],
  },
  'STRATEGY & BUSINESS': {
    colour: 'strategy',
    subtopics: [
      'business-model-monetization',
      'market-analysis',
      'organizational-strategy',
      'growth-scaling',
    ],
  },
  'PRODUCTS & INNOVATION': {
    colour: 'products',
    subtopics: [
      'product-ideas',
      'feature-ideas',
      'design-ux',
      'build-tech-stack',
    ],
  },
  'INSIGHTS & ANALYSIS': {
    colour: 'insights',
    subtopics: [
      'customer-feedback',
      'pain-points-problems',
      'success-stories',
      'industry-trends-opinions',
      'market-signals-moves',
      'ai-workforce-impact',
      'ai-society-critique',
      'ai-agents-automation-trends',
    ],
  },
  'LEARNING & DEVELOPMENT': {
    colour: 'learning',
    subtopics: [
      'courses-curricula',
      'how-to-guides',
      'best-practices-frameworks',
      'resources-tools',
    ],
  },
  'META & PERSONAL': {
    colour: 'meta',
    subtopics: [
      'personal-tasks-gtd',
      'system-improvements',
      'learning-about-self',
      'archive-reference',
    ],
  },
} as const;

export type Domain = keyof typeof DOMAINS;
export type Subtopic = (typeof DOMAINS)[Domain]['subtopics'][number];

/** Get all subtopics for a given domain */
export function getSubtopics(domain: Domain): readonly string[] {
  return DOMAINS[domain].subtopics;
}

/** Get the colour key for a domain (maps to CSS var --domain-{key}-*) */
export function getDomainColourKey(domain: string): string {
  const entry = Object.entries(DOMAINS).find(([key]) => key === domain);
  return entry ? entry[1].colour : 'meta';
}

/** Get all domain names */
export function getDomainNames(): Domain[] {
  return Object.keys(DOMAINS) as Domain[];
}

/** Format subtopic for display (kebab-case → Title Case, abbreviations uppercased) */
const ABBREVIATIONS = new Set([
  'ai',
  'ux',
  'gtd',
  'llms',
  'roi',
  'api',
  'css',
  'html',
  'url',
  'crm',
]);

export function formatSubtopic(subtopic: string): string {
  return subtopic
    .split('-')
    .map((word) => {
      if (ABBREVIATIONS.has(word.toLowerCase())) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/** All valid content types (matches DB CHECK constraint) */
export const CONTENT_TYPES = [
  'post',
  'article',
  'blog',
  'pdf',
  'product-page',
  'podcast',
  'video',
  'comment',
  'newsletter',
  'bookmark',
  'transcript',
  'note',
  'course',
  'research',
  'other',
] as const;

export type ContentType = (typeof CONTENT_TYPES)[number];

/** All valid platforms (matches DB CHECK constraint) */
export const PLATFORMS = [
  'web',
  'email',
  'manual',
  'upload',
  'extraction',
  'other',
] as const;

export type Platform = (typeof PLATFORMS)[number];

/** Content type → Lucide icon name mapping */
export const CONTENT_TYPE_ICONS: Record<ContentType, string> = {
  post: 'MessageSquare',
  article: 'FileText',
  blog: 'BookOpen',
  pdf: 'File',
  'product-page': 'Package',
  podcast: 'Headphones',
  video: 'Play',
  comment: 'MessageCircle',
  newsletter: 'Mail',
  bookmark: 'Bookmark',
  transcript: 'ScrollText',
  note: 'StickyNote',
  course: 'GraduationCap',
  research: 'FlaskConical',
  other: 'HelpCircle',
};
