/**
 * Starter pack feed definitions for Sector Intelligence workspaces.
 *
 * These provide out-of-the-box feed seeding for the four core sector
 * groupings so new intelligence workspaces can be populated with sensible
 * default feeds in a single admin action.
 *
 * Source of truth for source_type: the DB CHECK constraint at
 * supabase/migrations/20260330230240_create_feed_tables.sql:11
 * allows only 'rss', 'web', 'api'. The Zod schema at
 * lib/validation/schemas.ts:771 enforces the same.
 *
 * All feeds — including Google News and Atom — use source_type: 'rss'.
 * Google News URL resolution is handled by resolveGoogleNewsUrl() in
 * lib/intelligence/content-extractor.ts at ingestion time.
 */
import type { Database } from '@/supabase/types/database.types';

type FeedSourceType =
  Database['public']['Tables']['feed_sources']['Row']['source_type'];

export interface StarterPack {
  /** Unique identifier (e.g. 'education', 'health-social-care') */
  id: string;
  /** Human-readable name shown in the UI */
  name: string;
  /** Brief description of what this pack covers */
  description: string;
  /** Target sector(s) — matches company_profiles.sectors */
  sectors: string[];
  /** Feed entries to seed */
  feeds: StarterPackFeed[];
}

export interface StarterPackFeed {
  name: string;
  url: string;
  /**
   * MUST be one of the DB-allowed values: 'rss' | 'web' | 'api'.
   * Google News and Atom feeds are stored as 'rss'.
   */
  source_type: FeedSourceType;
  /** Default polling interval in minutes */
  polling_interval_minutes?: number;
  /** Whether to enable on seed (default true) */
  enabled?: boolean;
  /** Notes shown in admin UI (e.g. "paywalled after N reads") */
  notes?: string;
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id: 'education',
    name: 'Education',
    description:
      'DfE policy, Ofsted research, MAT activity, and sector press for UK education organisations.',
    sectors: ['Education'],
    feeds: [
      {
        name: 'DfE Policy Papers',
        url: 'https://www.gov.uk/search/policy-papers-and-consultations.atom?organisations%5B%5D=department-for-education',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'Atom feed from GOV.UK — covers consultations and policy papers',
      },
      {
        name: 'DfE Guidance',
        url: 'https://www.gov.uk/search/guidance-and-regulation.atom?organisations%5B%5D=department-for-education',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'Atom feed from GOV.UK — statutory and non-statutory guidance',
      },
      {
        name: 'Ofsted Research',
        url: 'https://www.gov.uk/search/research-and-statistics.atom?organisations%5B%5D=ofsted',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Atom feed from GOV.UK — Ofsted research and reports',
      },
      {
        name: 'MAT Activity (Google News)',
        url: 'https://news.google.com/rss/search?q=multi+academy+trust+UK&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — resolved at ingestion time',
      },
      {
        name: 'Schools Week',
        url: 'https://schoolsweek.co.uk/feed/',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'UK education sector news',
      },
      {
        name: 'TES',
        url: 'https://www.tes.com/rss/news.xml',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'Education sector news — may have paywall limits',
      },
    ],
  },
  {
    id: 'safeguarding',
    name: 'Safeguarding',
    description:
      'Safeguarding news, NSPCC learning, CQC safeguarding updates, and LADO activity.',
    sectors: ['Safeguarding'],
    feeds: [
      {
        name: 'Safeguarding News (Google News)',
        url: 'https://news.google.com/rss/search?q=safeguarding+UK+children&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — broad safeguarding coverage',
      },
      {
        name: 'Safeguarding Audit (Google News)',
        url: 'https://news.google.com/rss/search?q=%22safeguarding+audit%22+OR+%22safeguarding+inspection%22&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — safeguarding audit and inspection coverage',
      },
      {
        name: 'NSPCC Learning (Google News)',
        url: 'https://news.google.com/rss/search?q=NSPCC+learning+safeguarding+UK&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes:
          'Google News RSS — NSPCC does not publish a direct RSS feed; covers NSPCC safeguarding learning content',
      },
      {
        name: 'CQC Safeguarding News',
        url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=care-quality-commission',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Atom feed from GOV.UK — CQC news and communications including safeguarding',
      },
      {
        name: 'LADO Updates (Google News)',
        url: 'https://news.google.com/rss/search?q=LADO+local+authority+designated+officer+UK&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 180,
        notes: 'Google News RSS — LADO-specific coverage',
      },
    ],
  },
  {
    id: 'health-social-care',
    name: 'Health & Social Care',
    description:
      'NHS England news, CQC inspections, care quality press releases, and LGA social care updates.',
    sectors: ['Health', 'Social Care'],
    feeds: [
      {
        name: 'NHS England News',
        url: 'https://www.england.nhs.uk/feed/',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'Official NHS England RSS feed',
      },
      {
        name: 'CQC Press Releases',
        url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=care-quality-commission',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Atom feed from GOV.UK — CQC news, press releases, and communications',
      },
      {
        name: 'CQC Inspections (Google News)',
        url: 'https://news.google.com/rss/search?q=CQC+inspection+UK&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — CQC inspection coverage',
      },
      {
        name: 'LGA Social Care Updates (Google News)',
        url: 'https://news.google.com/rss/search?q=LGA+%22social+care%22+UK&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes:
          'Google News RSS — LGA does not publish a direct RSS feed; covers LGA social care policy and updates',
      },
      {
        name: 'Local Government Chronicle',
        url: 'https://www.lgcplus.com/feed/',
        source_type: 'rss',
        polling_interval_minutes: 60,
        notes: 'Local government sector news — cross-sector relevance for health and social care',
      },
    ],
  },
  {
    id: 'procurement',
    name: 'Procurement',
    description:
      'UK public procurement feeds including Contracts Finder, Find a Tender, and Crown Commercial Service.',
    sectors: ['Procurement'],
    feeds: [
      {
        name: 'Contracts Finder (Google News)',
        url: 'https://news.google.com/rss/search?q=%22contracts+finder%22+UK+procurement&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — Contracts Finder coverage',
      },
      {
        name: 'Find a Tender Service (Google News)',
        url: 'https://news.google.com/rss/search?q=%22find+a+tender%22+UK+procurement&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Google News RSS — Find a Tender coverage',
      },
      {
        name: 'Public Contracts Scotland (Google News)',
        url: 'https://news.google.com/rss/search?q=%22public+contracts+scotland%22&hl=en-GB&gl=GB&ceid=GB:en',
        source_type: 'rss',
        polling_interval_minutes: 180,
        notes: 'Google News RSS — Scottish public procurement',
      },
      {
        name: 'Crown Commercial Service News',
        url: 'https://www.gov.uk/government/organisations/crown-commercial-service.atom',
        source_type: 'rss',
        polling_interval_minutes: 120,
        notes: 'Atom feed from GOV.UK — CCS announcements',
      },
    ],
  },
];

/**
 * Look up a starter pack by its unique ID.
 */
export function getStarterPack(id: string): StarterPack | undefined {
  return STARTER_PACKS.find((pack) => pack.id === id);
}
