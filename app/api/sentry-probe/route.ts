import * as Sentry from "@sentry/nextjs";
import { NextResponse } from "next/server";

// TEMPORARY: WP-S8c kh-prod-readiness-S10 — prod source-map verification.
// REVERT IMMEDIATELY AFTER VERIFICATION. Two-helper indirection produces a
// multi-frame stack so we can confirm symbolication resolves frames at
// different call depths back to this file's original TS line numbers.
function throwInner(): never {
  throw new Error("WP-S8c S10 — prod sourcemap verify probe");
}

function throwOuter(): never {
  throwInner();
}

export async function GET() {
  try {
    throwOuter();
  } catch (err) {
    Sentry.captureException(err, {
      tags: { probe: "WP-S8c-S10", track: "production-readiness" },
    });
    await Sentry.flush(2000);
    return NextResponse.json(
      {
        ok: false,
        error: (err as Error).message,
        note: "WP-S8c temporary probe — remove immediately after verification.",
      },
      { status: 500 },
    );
  }
}
