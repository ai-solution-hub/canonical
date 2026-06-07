/**
 * KH_PRIVATE_DOCS_DIR bridge helper (ID-68.16 — TECH PC-25/PC-28/PC-29).
 *
 * `KH_PRIVATE_DOCS_DIR` is the single standing bridge knob (PRODUCT Inv 25)
 * naming the local checkout of `knowledge-hub-docs-site`. Read direction is
 * public→private only. Consumers never implement their own resolution
 * (Inv 28) — they call `resolvePrivateDocsDir()` (TypeScript) or use the
 * documented shell one-liner below.
 *
 * Resolution routes (Inv 28):
 * - Local/dev: point the knob at the sibling checkout
 *   (`../knowledge-hub-docs-site`) explicitly — in `.env.local` or your
 *   shell profile. Never auto-discovered.
 * - CI: the reusable step at `.github/actions/resolve-private-docs` mints a
 *   GitHub-App installation token, checks out `knowledge-hub-docs-site`
 *   into `${{ runner.temp }}/kh-private-docs`, and exports the knob.
 *
 * Failure behaviour (Inv 29): when the knob is unset or blank, fail loudly
 * with an actionable error naming the knob and both resolution routes.
 * Explicitly NO fallback to the in-repo `docs/` duplicate; no partial
 * output.
 *
 * Shell one-liner for skill/sh consumers (AC-D3 contract — exits non-zero
 * naming the knob when unset):
 *
 *   "${KH_PRIVATE_DOCS_DIR:?KH_PRIVATE_DOCS_DIR not set — point it at the
 *   knowledge-hub-docs-site checkout (sibling clone locally; GitHub-App
 *   token checkout in CI)}"
 *
 * Public-repo self-sufficiency (Inv 30): no PR-blocking CI job sets this
 * knob — bridge consumers are opt-in lanes only. Keep it that way.
 *
 * Import directly (`@/lib/private-docs`) — no barrel re-exports.
 */

/**
 * Resolve the private-docs checkout directory from `KH_PRIVATE_DOCS_DIR`.
 *
 * @returns the directory path the knob names.
 * @throws when the knob is unset or blank — actionable error naming
 *   `KH_PRIVATE_DOCS_DIR` and both resolution routes (Inv 29). Never falls
 *   back to in-repo `docs/`.
 */
export function resolvePrivateDocsDir(): string {
  const dir = process.env.KH_PRIVATE_DOCS_DIR?.trim();
  if (!dir) {
    throw new Error(
      'KH_PRIVATE_DOCS_DIR not set — point it at the knowledge-hub-docs-site checkout. ' +
        'Local/dev: set it explicitly (in .env.local or your shell profile) to the sibling ' +
        'clone at ../knowledge-hub-docs-site — it is never auto-discovered. ' +
        'CI: use the resolve-private-docs reusable step (.github/actions/resolve-private-docs), ' +
        'which performs a GitHub-App installation-token checkout and exports the knob. ' +
        'There is no fallback to the in-repo docs/ directory.',
    );
  }
  return dir;
}
