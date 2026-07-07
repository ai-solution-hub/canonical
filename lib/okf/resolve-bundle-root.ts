/**
 * `OKF_BUNDLE_ROOT` bridge helper — resolves a `bundleId` route param to the
 * filesystem directory the viewer reads (ID-132 {132.14} G-VIEWER).
 *
 * TECH-ADDENDUM-reference-agents.md Part 2 §Reframe B: "For the first client
 * the read source is the synced copy D10 already keeps outside the main repo
 * for integration testing... do NOT invent a new hosting mechanism — bundle
 * hosting is ID-134's call." Concretely: `{132.12}` G-GITSYNC (the git writer
 * that physically creates/syncs the bundle repo) has not shipped yet, so
 * there is no real synced-copy path to hardcode. This module mirrors the
 * existing `KH_PRIVATE_DOCS_DIR` bridge-knob pattern (`lib/private-docs.ts`)
 * instead of inventing bespoke resolution: an env var names the bundle-repo
 * PARENT directory (one subdirectory per client bundle, keyed by `bundleId`),
 * unset by default, fail-loud (never silently falls back to an in-repo dir).
 * ID-134/{132.12} may re-home this resolution once the real writer/hosting
 * mechanism lands — see the Executor's discrepancy report.
 */
import path from 'node:path';

/** A bundleId must be a single safe path segment — no traversal, no separators. */
const SAFE_BUNDLE_ID_RE = /^[A-Za-z0-9_-]+$/;

/**
 * Resolve `bundleId` to the OKF bundle's filesystem root.
 *
 * @throws when `OKF_BUNDLE_ROOT` is unset/blank, or `bundleId` is not a
 *   single safe path segment (traversal guard — `bundleId` comes from a URL
 *   route param).
 */
export function resolveOkfBundleRoot(bundleId: string): string {
  const root = process.env.OKF_BUNDLE_ROOT?.trim();
  if (!root) {
    throw new Error(
      'OKF_BUNDLE_ROOT not set — point it at the parent directory of the synced ' +
        'OKF bundle-repo checkouts (D10: a copy kept outside the main repo for ' +
        'integration testing; TECH-ADDENDUM-reference-agents.md Part 2 Reframe B). ' +
        'Set it in .env.local (local/dev) or the deploy environment. There is no ' +
        'fallback to an in-repo bundle directory — the concrete bundle-hosting ' +
        "mechanism is ID-134/{132.12}'s call, not this route's.",
    );
  }
  if (!bundleId || !SAFE_BUNDLE_ID_RE.test(bundleId)) {
    throw new Error(`Invalid bundleId: ${bundleId}`);
  }
  return path.join(root, bundleId);
}
