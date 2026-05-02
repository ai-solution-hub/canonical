import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

// TEMPORARY: WP-S8c.1 prod-readiness Hold (f) re-probe — verify Sentry
// stack-trace-bearing capture against a release that includes the WP-S8c.1
// Turbopack source-map fix (commit 8b69ef54). REVERT IMMEDIATELY AFTER
// SYMBOLICATION CONFIRMED. Two-helper indirection produces a multi-frame
// stack so we can confirm symbolication resolves frames at different call
// depths back to this file's original TS line numbers.
function throwInner(): never {
  throw new Error('WP-S8c.1 S219 — prod sourcemap re-probe (Hold (f))');
}

function throwOuter(): never {
  throwInner();
}

export async function GET() {
  try {
    throwOuter();
  } catch (err) {
    Sentry.captureException(err, {
      tags: { probe: 'WP-S8c.1-S219', track: 'production-readiness' },
    });
    await Sentry.flush(2000);
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        note: 'WP-S8c.1 temporary re-probe — remove immediately after verification.',
      },
      { status: 500 },
    );
  }
}
