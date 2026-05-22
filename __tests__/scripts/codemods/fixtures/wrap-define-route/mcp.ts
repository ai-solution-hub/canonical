/**
 * Fixture: MCP — GET + POST + DELETE under `/mcp/`, protocol-handler shape.
 *
 * Modelled on `app/api/mcp/[transport]/route.ts` per route-shape-inventory.md
 * §4.10. Codemod verdict: MANUAL per PRODUCT §6.1 — bespoke transport
 * handler, not a data-API route. The classifier matches `/mcp/` in the
 * synthetic path at TECH §2.3 priority 2 (immediately after the `/cron/`
 * check), short-circuiting before any method count or body discriminator
 * runs. The CLAUDE.md "mcp-handler breaks on Vercel" gotcha is the runtime
 * reason this shape is bespoke; for the classifier we only need the path
 * signal.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest) {
  return new NextResponse('mcp-transport-stream', { status: 200 });
}

export async function POST(_request: NextRequest) {
  return new NextResponse('mcp-transport-message', { status: 200 });
}

export async function DELETE(_request: NextRequest) {
  return new NextResponse('mcp-transport-close', { status: 204 });
}
