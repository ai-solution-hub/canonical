/**
 * Fixture: MULTI_PARAM_BODY — GET + PATCH + DELETE on the same parameterised
 * resource path, with a body on PATCH.
 *
 * Modelled on `app/api/items/[id]/route.ts` per route-shape-inventory.md §4.5.
 * Each exported method has its own minimal handler body so Subtask 32.11's
 * multi-method rewrite walks all three independently and emits one
 * `MULTI_METHOD_SCHEMA` entry per method.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';
import { parseBody } from '@/lib/validation';

const PatchBodySchema = z.object({ title: z.string() });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  return NextResponse.json({ id, title: 'untitled' });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  const raw = await request.json();
  const body = parseBody(PatchBodySchema, raw);
  if (!body.success) return body.response;
  return NextResponse.json({ id, title: body.data.title });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await getAuthorisedClient(['admin']);
  if (!auth.success) return authFailureResponse(auth);
  const { id } = await params;
  return NextResponse.json({ id, deleted: true });
}
