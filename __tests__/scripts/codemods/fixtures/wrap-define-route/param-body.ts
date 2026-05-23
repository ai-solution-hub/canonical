/**
 * Fixture: PARAM_BODY — single POST, `getAuthorisedClient`, `Promise<{ id }>`
 * params (Next.js 15 async-params style), `parseBody()`.
 *
 * Modelled on `app/api/items/[id]/classify/route.ts` per
 * route-shape-inventory.md §4.2. The `Promise<{ id: string }>` second-argument
 * shape is the 78-of-92 majority pattern per TECH §8.2 and must be preserved
 * verbatim by Subtask 32.10's rewrite logic.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';

const BodySchema = z.object({ note: z.string() });

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  const raw = await request.json();
  const body = parseBody(BodySchema, raw);
  if (!body.success) return body.response;
  return NextResponse.json({ id, note: body.data.note });
}
