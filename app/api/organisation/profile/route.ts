import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth/client';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { OrganisationProfileUpsertSchema } from '@/lib/validation/schemas';
import {
  getOrganisationProfile,
  getFullPrimaryProfile,
  generateSlug,
} from '@/lib/organisation-profile';
import { sb } from '@/lib/supabase/safe';
import type { SupabaseClient } from '@supabase/supabase-js';

export const maxDuration = 15;

/**
 * GET /api/organisation/profile
 *
 * Returns the primary organisation profile (is_primary=true, is_active=true).
 * Returns { profile: null } when no primary profile exists.
 * Admin + editor only.
 */
export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);

    const profile = await getOrganisationProfile(auth.supabase);
    return NextResponse.json({ profile });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch organisation profile') },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/organisation/profile
 *
 * Upsert the primary organisation profile. Creates a new row with
 * is_primary=true if none exists; updates the existing primary row
 * otherwise. Slug is auto-generated from name.
 *
 * Admin + editor only.
 */
export async function PUT(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin', 'editor']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase, user } = auth;

    const raw = await request.json();
    const parsed = parseBody(OrganisationProfileUpsertSchema, raw);
    if (!parsed.success) return parsed.response;

    const { data: validated } = parsed;
    const existing = await getFullPrimaryProfile(supabase);

    // Resolve slug — auto-generate from name, handle UNIQUE collisions
    const slug = await resolveUniqueSlug(
      supabase,
      generateSlug(validated.name),
      existing?.id,
    );

    // Normalise empty-string website_url to null for consistent DB storage
    const websiteUrl = validated.website_url?.trim() || null;

    if (existing) {
      // Update existing primary profile
      const data = await sb(
        supabase
          .from('company_profiles')
          .update({
            name: validated.name,
            slug,
            description: validated.description ?? null,
            website_url: websiteUrl,
            sectors: validated.sectors,
            services: validated.services,
            certifications: validated.certifications,
            geographic_scope: validated.geographic_scope,
            target_customers: validated.target_customers ?? null,
            value_proposition: validated.value_proposition ?? null,
            key_topics: validated.key_topics,
          })
          .eq('id', existing.id)
          .select(
            'id, name, description, website_url, sectors, services, certifications, geographic_scope, target_customers, value_proposition, key_topics',
          )
          .single(),
      );

      return NextResponse.json({ profile: data });
    } else {
      // Create new primary profile
      const data = await sb(
        supabase
          .from('company_profiles')
          .insert({
            name: validated.name,
            slug,
            description: validated.description ?? null,
            website_url: websiteUrl,
            sectors: validated.sectors,
            services: validated.services,
            certifications: validated.certifications,
            geographic_scope: validated.geographic_scope,
            competitors: [],
            target_customers: validated.target_customers ?? null,
            value_proposition: validated.value_proposition ?? null,
            key_topics: validated.key_topics,
            is_active: true,
            is_primary: true,
            created_by: user.id,
          })
          .select(
            'id, name, description, website_url, sectors, services, certifications, geographic_scope, target_customers, value_proposition, key_topics',
          )
          .single(),
      );

      return NextResponse.json({ profile: data }, { status: 201 });
    }
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to save organisation profile') },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a unique slug by appending a numeric suffix on UNIQUE collision.
 * Excludes the current profile's own ID from the collision check.
 */
async function resolveUniqueSlug(
  supabase: SupabaseClient,
  baseSlug: string,
  excludeId?: string,
): Promise<string> {
  // If baseSlug is empty (edge case), default to 'organisation'
  const slug = baseSlug || 'organisation';

  // Check if slug is taken (by a different profile)
  let candidate = slug;
  let suffix = 0;

  for (;;) {
    const query = supabase
      .from('company_profiles')
      .select('id')
      .eq('slug', candidate)
      .limit(1);

    // Exclude self when updating
    const finalQuery = excludeId ? query.neq('id', excludeId) : query;
    const { data } = await finalQuery;

    if (!data || data.length === 0) {
      return candidate;
    }

    suffix += 1;
    candidate = `${slug}-${suffix}`;
  }
}
