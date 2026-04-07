import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TaxonomyDomainCreateSchema } from '@/lib/validation/schemas';
import { sb } from '@/lib/supabase/safe';

export const maxDuration = 30;

/**
 * GET /api/taxonomy/domains
 *
 * List all domains including inactive (admin-only).
 * Returns subtopic count per domain for the admin UI.
 */
export async function GET() {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    // Fetch all domains with subtopic counts via relational count
    const { data: domains, error } = await supabase
      .from('taxonomy_domains')
      .select(
        'id, name, display_order, colour, key_signal, is_active, provenance, taxonomy_subtopics(count)',
      )
      .order('display_order', { ascending: true });

    if (error) {
      return NextResponse.json(
        { error: 'Failed to fetch domains' },
        { status: 500 },
      );
    }

    // Reshape: extract count from the nested relation
    const result = (domains ?? []).map((d) => {
      const { taxonomy_subtopics, ...rest } = d as Record<string, unknown> & {
        taxonomy_subtopics: Array<{ count: number }>;
      };
      return {
        ...rest,
        subtopic_count: taxonomy_subtopics?.[0]?.count ?? 0,
      };
    });

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch domains') },
      { status: 500 },
    );
  }
}

/**
 * POST /api/taxonomy/domains
 *
 * Create a new domain. Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth.success) return authFailureResponse(auth);
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(TaxonomyDomainCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { name, colour, display_order, key_signal } = parsed.data;

    // Auto-assign display_order if not provided
    let order = display_order;
    if (order === undefined) {
      const maxRow = await sb(
        supabase
          .from('taxonomy_domains')
          .select('display_order')
          .order('display_order', { ascending: false })
          .limit(1)
          .maybeSingle(),
        'taxonomy.domains.list',
      );
      order = (maxRow?.display_order ?? 0) + 10;
    }

    const { data, error } = await supabase
      .from('taxonomy_domains')
      .insert({
        name,
        colour: colour ?? null,
        key_signal: key_signal ?? null,
        display_order: order,
        is_active: true,
        provenance: 'client',
      })
      .select('id, name, display_order, colour, is_active, provenance')
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A domain named '${name}' already exists` },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to create domain' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create domain') },
      { status: 500 },
    );
  }
}
