/**
 * Organisation Profile — shared types and server-side accessor.
 *
 * The "organisation profile" is the primary company_profiles row
 * (is_primary = true, is_active = true). It represents the user's own
 * organisation and provides grounding context across the platform.
 *
 * UI surfaces call this "Organisation" (UK English) to distinguish from
 * the SI "Company Profiles" competitor-tracking surface.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/supabase/types/database.types';
import { logger } from '@/lib/logger/client';

type CompanyProfileRow =
  Database['public']['Tables']['company_profiles']['Row'];

// ---------------------------------------------------------------------------
// Public types (consumed by hooks and downstream features)
// ---------------------------------------------------------------------------

/**
 * Organisation profile shape for app-wide consumers.
 * Deliberately omits: competitors, company_embedding, slug,
 * is_active, is_primary, created_by, created_at, updated_at.
 */
export interface OrganisationProfile {
  id: string;
  name: string;
  description: string | null;
  website_url: string | null;
  sectors: string[];
  services: string[];
  certifications: string[];
  geographic_scope: string[];
  target_customers: string | null;
  value_proposition: string | null;
  key_topics: string[];
}

/**
 * Status object returned by useOrganisationProfile().
 * Superset of P0-4 §5.3 CompanyProfileStatus contract
 * (isComplete + editUrl are present unchanged).
 */
export interface OrganisationProfileStatus {
  profile: OrganisationProfile | null;
  isLoaded: boolean;
  /** true when name + >=1 sector + >=1 service are set */
  isComplete: boolean;
  editUrl: string;
}

// ---------------------------------------------------------------------------
// Completeness check
// ---------------------------------------------------------------------------

/**
 * Determine whether an organisation profile is "complete" per OQ-1 resolution:
 * name is non-empty AND at least one sector AND at least one service.
 */
export function isProfileComplete(
  profile: OrganisationProfile | null,
): boolean {
  if (!profile) return false;
  return (
    profile.name.trim().length > 0 &&
    profile.sectors.length > 0 &&
    profile.services.length > 0
  );
}

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

/**
 * Generate a kebab-case slug from a company name.
 * Strips non-ASCII, collapses whitespace/hyphens, lowercases.
 */
export function generateSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// Column selection (excludes sensitive SI-only fields)
// ---------------------------------------------------------------------------

const ORGANISATION_PROFILE_SELECT =
  'id, name, description, website_url, sectors, services, certifications, geographic_scope, target_customers, value_proposition, key_topics' as const;

// ---------------------------------------------------------------------------
// Server-side accessor
// ---------------------------------------------------------------------------

/**
 * Fetch the primary organisation profile.
 * Returns null when no primary profile exists.
 *
 * Used by API routes and MCP tools for grounding context.
 */
export async function getOrganisationProfile(
  supabase: SupabaseClient<Database>,
): Promise<OrganisationProfile | null> {
  const { data, error } = await supabase
    .from('company_profiles')
    .select(ORGANISATION_PROFILE_SELECT)
    .eq('is_primary', true)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error(
      { err: error },
      '[organisation-profile] Failed to fetch primary profile',
    );
    return null;
  }

  return data as OrganisationProfile | null;
}

/**
 * Fetch the full primary profile row (including slug, is_primary, etc.)
 * for use in the upsert flow. Internal to the API route.
 */
export async function getFullPrimaryProfile(
  supabase: SupabaseClient<Database>,
): Promise<CompanyProfileRow | null> {
  const { data, error } = await supabase
    .from('company_profiles')
    .select('*')
    .eq('is_primary', true)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    logger.error(
      { err: error },
      '[organisation-profile] Failed to fetch full primary profile',
    );
    return null;
  }

  return data;
}
