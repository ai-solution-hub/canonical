import { NextRequest, NextResponse } from 'next/server';
import {
  getAuthenticatedClient,
  unauthorisedResponse,
  rateLimitResponse,
} from '@/lib/auth';
import { checkRateLimit } from '@/lib/rate-limit';
import { safeErrorMessage } from '@/lib/error';

export async function GET(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { user, supabase } = auth;

    const { allowed } = checkRateLimit(`insights:${user.id}`, 20, 60 * 1000);
    if (!allowed) return rateLimitResponse();

    const { searchParams } = new URL(request.url);
    const type = searchParams.get('type') ?? 'trends';
    const days = parseInt(searchParams.get('days') ?? '30', 10);

    switch (type) {
      case 'trends': {
        const minCount = parseInt(searchParams.get('min_count') ?? '2', 10);
        const { data, error } = await supabase.rpc('get_trend_analysis', {
          p_days: days,
          p_min_count: minCount,
        });
        if (error) {
          return NextResponse.json(
            { error: 'Failed to fetch trend analysis' },
            { status: 500 },
          );
        }
        return NextResponse.json({ trends: data ?? [] });
      }

      case 'topic': {
        const keyword = searchParams.get('keyword');
        if (!keyword) {
          return NextResponse.json(
            { error: 'Missing keyword parameter' },
            { status: 400 },
          );
        }
        const { data, error } = await supabase.rpc('get_topic_deep_dive', {
          p_keyword: keyword,
        });
        if (error) {
          return NextResponse.json(
            { error: 'Failed to fetch topic deep dive' },
            { status: 500 },
          );
        }
        return NextResponse.json({ topic: data });
      }

      case 'author': {
        const author = searchParams.get('author');
        if (!author) {
          return NextResponse.json(
            { error: 'Missing author parameter' },
            { status: 400 },
          );
        }
        const { data, error } = await supabase.rpc('get_author_analysis', {
          p_author_name: author,
        });
        if (error) {
          return NextResponse.json(
            { error: 'Failed to fetch author analysis' },
            { status: 500 },
          );
        }
        return NextResponse.json({ author: data });
      }

      case 'gaps': {
        const { data, error } = await supabase.rpc('get_content_gaps');
        if (error) {
          return NextResponse.json(
            { error: 'Failed to fetch content gaps' },
            { status: 500 },
          );
        }
        return NextResponse.json({ gaps: data });
      }

      case 'reading': {
        const { data, error } = await supabase.rpc('get_reading_patterns', {
          p_days: days,
        });
        if (error) {
          return NextResponse.json(
            { error: 'Failed to fetch reading patterns' },
            { status: 500 },
          );
        }
        return NextResponse.json({ reading: data });
      }

      default:
        return NextResponse.json(
          { error: `Unknown insight type: ${type}. Valid types: trends, topic, author, gaps, reading` },
          { status: 400 },
        );
    }
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch insights') },
      { status: 500 },
    );
  }
}
