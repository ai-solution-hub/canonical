/**
 * OKF bundle-root enumeration — the net-new authed server read behind
 * `GET /api/okf/bundles` (ID-132 {132.32} G-LANDING-IMPL, OKF-LANDING.md
 * LI-14: "enumerate ALL bundles").
 *
 * No cross-bundle enumeration helper existed before this Subtask —
 * `lib/okf/bundle-graph.ts`'s `walkMarkdownFiles` walks *within* one already-
 * resolved bundle. This reads the `OKF_BUNDLE_ROOT` PARENT directory itself:
 * every immediate subdirectory is one client bundle, keyed by its directory
 * name (= `bundleId`), filtered against the same `SAFE_BUNDLE_ID_RE` guard
 * `resolveOkfBundleRoot` enforces per-bundle (a directory name that would
 * fail that guard is silently excluded here rather than surfaced — it is not
 * a valid bundleId route param either way).
 *
 * Never throws: an unset/blank `OKF_BUNDLE_ROOT`, a root that does not exist
 * on disk, or a root with zero subdirs all resolve to `[]` — the caller
 * (`GET /api/okf/bundles`) renders the LI-4(a)/(b) graceful empty state.
 */
import fs from 'node:fs';
import {
  resolveOkfBundleRootDirOrNull,
  SAFE_BUNDLE_ID_RE,
} from '@/lib/okf/resolve-bundle-root';

/** Enumerate every configured bundleId under `OKF_BUNDLE_ROOT`, sorted. */
export function enumerateOkfBundles(): string[] {
  const root = resolveOkfBundleRootDirOrNull();
  if (!root) return [];
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return [];

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) => entry.isDirectory() && SAFE_BUNDLE_ID_RE.test(entry.name),
    )
    .map((entry) => entry.name)
    .sort();
}
