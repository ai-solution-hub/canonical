/**
 * Fixture: NAKED_NO_AUTH — single GET, no `getAuthorisedClient` /
 * `getAuthenticatedClient` import (public route).
 *
 * Modelled on `app/api/health/route.ts` per route-shape-inventory.md §4.8.
 * Codemod verdict: MANUAL per PRODUCT §6.1 — `defineRoute()` presupposes an
 * authenticated handler. The classifier matches the absence of `@/lib/auth`
 * import (after the `/cron/` and `/mcp/` path checks fail) at TECH §2.3
 * priority 3.
 */

import { NextRequest, NextResponse } from 'next/server';

export async function GET(_request: NextRequest) {
  return NextResponse.json({ status: 'ok', uptime: process.uptime() });
}
