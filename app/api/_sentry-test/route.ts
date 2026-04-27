import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';

// TEMPORARY: WP-QW.1 preview-deploy Sentry verification probe (kh-prod-readiness-S7).
// REVERT BEFORE MERGING TO main. Belt-and-braces: explicit captureException
// + flush before throw, in case the Next.js auto-instrumentation isn't wired
// on the preview build.
export async function GET() {
  const err = new Error(
    'WP-QW.1 Sentry verify — kh-prod-readiness-S7 — preview deploy probe',
  );
  Sentry.captureException(err);
  await Sentry.flush(2000);
  return NextResponse.json(
    {
      ok: false,
      error: err.message,
      note: 'This route exists only for WP-QW.1 verification. Should be removed before merge.',
    },
    { status: 500 },
  );
}
