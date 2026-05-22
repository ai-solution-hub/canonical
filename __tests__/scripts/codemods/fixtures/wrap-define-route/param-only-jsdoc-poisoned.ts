/**
 * Fixture: PARAM (JSDoc-poisoned) — single GET, `getAuthorisedClient`,
 * `Promise<{ canonical_name }>` params (Next.js 15 async-params style), no body.
 *
 * Regression fixture for Subtask 32.17: the JSDoc block deliberately mentions
 * the body-detection discriminator substrings `request.json()` and `parseBody(`
 * inside prose AND inside a fenced code-style example, but the executable
 * handler body does NOT invoke either function. With the pre-32.17 substring
 * scan (`getFullText().includes(...)`), this route would mis-classify as
 * PARAM_BODY because comment text taints the discriminator. After the 32.17
 * AST refactor (CallExpression walk), classification correctly returns PARAM —
 * comments and JSDoc are excluded from detection.
 *
 * Example of poisoning prose: this route does NOT call request.json() and does
 * NOT call parseBody(payload); it only reads path parameters.
 *
 *   // Hypothetical alternative implementation (NEVER reached):
 *   //   const body = await request.json();
 *   //   const parsed = parseBody(body);
 *
 * Modelled on `app/api/entities/[canonical_name]/route.ts` per
 * route-shape-inventory.md §4.4.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthorisedClient, authFailureResponse } from '@/lib/auth';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ canonical_name: string }> },
) {
  const auth = await getAuthorisedClient(['admin', 'editor']);
  if (!auth.success) return authFailureResponse(auth);
  const { canonical_name } = await params;
  return NextResponse.json({ canonical_name, type: 'organisation' });
}
