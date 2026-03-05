import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, forbiddenResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';
import { TaxonomySubtopicCreateSchema } from '@/lib/validation/schemas';

/**
 * POST /api/taxonomy/subtopics
 *
 * Create a new subtopic. Admin-only.
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthorisedClient(['admin']);
    if (!auth) return forbiddenResponse();
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(TaxonomySubtopicCreateSchema, raw);
    if (!parsed.success) return parsed.response;

    const { domain_id, name, display_order } = parsed.data;

    // Verify domain exists
    const { data: domain, error: domainError } = await supabase
      .from('taxonomy_domains')
      .select('id')
      .eq('id', domain_id)
      .single();

    if (domainError || !domain) {
      return NextResponse.json(
        { error: 'Domain not found' },
        { status: 400 },
      );
    }

    // Auto-assign display_order if not provided
    let order = display_order;
    if (order === undefined) {
      const { data: maxRow } = await supabase
        .from('taxonomy_subtopics')
        .select('display_order')
        .eq('domain_id', domain_id)
        .order('display_order', { ascending: false })
        .limit(1)
        .single();
      order = (maxRow?.display_order ?? 0) + 10;
    }

    const { data, error } = await supabase
      .from('taxonomy_subtopics')
      .insert({
        domain_id,
        name,
        display_order: order,
        is_active: true,
      })
      .select('id, domain_id, name, display_order, is_active')
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: `A subtopic named '${name}' already exists in this domain` },
          { status: 409 },
        );
      }
      return NextResponse.json(
        { error: 'Failed to create subtopic' },
        { status: 500 },
      );
    }

    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to create subtopic') },
      { status: 500 },
    );
  }
}
