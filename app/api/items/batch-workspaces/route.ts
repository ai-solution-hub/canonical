import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthenticatedClient, unauthorisedResponse } from '@/lib/auth';
import { safeErrorMessage } from '@/lib/error';
import { parseBody } from '@/lib/validation';

export const maxDuration = 30;

const BatchWorkspacesBodySchema = z.object({
  item_ids: z
    .array(z.string().uuid('Each item_id must be a valid UUID'))
    .min(1, 'item_ids must contain at least one ID')
    .max(100, 'item_ids must contain at most 100 IDs'),
});

/** POST /api/items/batch-workspaces — return workspace assignments for multiple items */
export async function POST(request: NextRequest) {
  try {
    const auth = await getAuthenticatedClient();
    if (!auth) return unauthorisedResponse();
    const { supabase } = auth;

    const raw = await request.json();
    const parsed = parseBody(BatchWorkspacesBodySchema, raw);
    if (!parsed.success) return parsed.response;

    const { item_ids } = parsed.data;

    const { data, error } = await supabase
      .from('content_item_workspaces')
      .select('content_item_id, workspace_id')
      .in('content_item_id', item_ids);

    if (error) {
      console.error('Failed to fetch batch workspace assignments:', error);
      return NextResponse.json(
        { error: 'Failed to fetch workspace assignments' },
        { status: 500 },
      );
    }

    // Group results by content_item_id — omit items with no assignments
    const assignments: Record<string, string[]> = {};
    for (const row of data ?? []) {
      const itemId = row.content_item_id as string;
      const workspaceId = row.workspace_id as string;
      if (!assignments[itemId]) {
        assignments[itemId] = [];
      }
      assignments[itemId].push(workspaceId);
    }

    return NextResponse.json({ assignments });
  } catch (err) {
    return NextResponse.json(
      { error: safeErrorMessage(err, 'Failed to fetch workspace assignments') },
      { status: 500 },
    );
  }
}
