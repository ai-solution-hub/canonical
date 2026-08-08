/**
 * Streamdown link-safety compat shim (ID-132 {132.32} G-LANDING-IMPL,
 * OKF-LANDING.md LI-5 — "internal concept links ... resolve within the
 * bundle").
 *
 * Streamdown's default `rehypePlugins` bakes in `rehype-harden` (a security
 * hardening pass — part of DR-040's rationale for adopting Streamdown at
 * all). Empirically (verified against the pinned `rehype-harden` dependency
 * at implementation time): a BARE relative href (no leading `/`, `./`, or
 * `../`) fails `rehype-harden`'s own URL parser outright and is replaced
 * with a `[blocked]` placeholder before it ever reaches `<Streamdown
 * components={{a: ...}}>`. Even a `./`/`../`-prefixed href IS let through,
 * but `rehype-harden` re-resolves it against a FIXED dummy origin
 * (`http://example.com`), not the actual current document's directory —
 * discarding any bundle-tree directory context and always rewriting the
 * result to a root-absolute pathname.
 *
 * The OKF bundle-writer's internal link convention is bare-relative-to-the-
 * current-file (`lib/okf/bundle-graph.ts`'s `LINK_RE` + `extractLinks`'s
 * `path.resolve(docDir, target)`; `lib/okf/parse-index.ts`'s
 * `* [title](path.md)` bullets) — fixed producer output ({132.10}/
 * {132.12}), not a convention this Subtask can change. So rather than fight
 * `rehype-harden`'s dummy-origin resolution, this module does the SAME
 * directory-relative resolution `resolveInternalMdLink` already performs
 * client-side, UP FRONT, and rewrites every internal `.md` link to its
 * bundle-root-relative target behind a reserved `INTERNAL_LINK_MARKER`
 * path prefix:
 *
 *   - The marker always starts with `/`, so `rehype-harden`'s dummy-origin
 *     resolution passes the already-bundle-root-relative path through
 *     byte-identical (there are no further `.`/`..` segments left to
 *     resolve away).
 *   - A leading-`/` `.md` href is the SPEC §5.1 bundle-ABSOLUTE form (the
 *     producer's citation-trailer and body-prose cross-link convention) —
 *     already bundle-root-relative, so it is rewritten behind the marker
 *     directly (leading `/` stripped, no directory-relative resolution).
 *     The marker's own reserved prefix cannot plausibly collide with real
 *     bundle content, so `<FileRenderPane>`'s `a` override can
 *     unambiguously recognise "this href is one of ours" by checking the
 *     marker prefix.
 *
 * An href that fails to resolve (should not happen for a well-formed
 * internal `.md` target — `resolveInternalMdLink` only returns `null` for
 * external/absolute/non-`.md` hrefs, already excluded by the regex + guard
 * below) is left unchanged as a defensive fallback.
 *
 * **{132.49} union-graph namespacing.** The deployment-level union graph
 * serves NAMESPACED node ids (`acme::services/orders` — `lib/okf/union-id.ts`),
 * so a target resolved here must carry the same namespace or it can never
 * match a union node. Resolution therefore runs against the bare
 * bundle-relative half and re-applies the `bundleId` afterwards. Getting
 * this wrong is not cosmetic: `..`-climbing links consumed the namespace
 * segment, and the SPEC §5.1 bundle-absolute (`/foo.md`) citation-trailer
 * form never acquired one, so BOTH rendered as dead off-app anchors in
 * `<UnionGraphView>` while working fine in the per-bundle viewer.
 */
import { resolveInternalMdLink } from '@/lib/okf/resolve-internal-link';
import { namespaceUnionId, splitUnionId } from '@/lib/okf/union-id';

// `](target.md)` or `](target.md#anchor)` — same shape as bundle-graph.ts's LINK_RE.
const MD_LINK_RE = /\]\(([^)\s]+\.md)((?:#[A-Za-z0-9_-]*)?)\)/g;

/**
 * Reserved path marker distinguishing our own resolved-internal-link
 * rewrites from any author-written root-absolute href. Deliberately
 * implausible as real bundle content.
 */
export const INTERNAL_LINK_MARKER = '/__okf-internal-link__/';

function stripMdSuffix(value: string): string {
  return value.endsWith('.md') ? value.slice(0, -3) : value;
}

/**
 * Rewrite every internal `.md` link in `markdown` (written relative to
 * `currentPath`, the file being rendered) to its fully-resolved
 * bundle-root-relative target behind `INTERNAL_LINK_MARKER`. A leading-`/`
 * target (the SPEC §5.1 bundle-absolute form) is already bundle-root
 * relative — rewritten behind the marker directly. External (`://`) links
 * and already-marked hrefs pass through unchanged.
 */
export function normaliseInternalMdLinksForStreamdown(
  markdown: string,
  currentPath: string,
): string {
  // In the UNION graph ({132.49}) `currentPath` arrives namespaced
  // (`acme::services/orders`). Resolve against the BARE bundle-relative id,
  // then re-apply the namespace, so the result matches the namespaced node
  // ids the union route actually serves. Un-namespaced ids (the per-bundle
  // `<BundleViewer>`, and `<FileRenderPane>`'s file paths) split to
  // `bundleId: null` and `requalify` is the identity — behaviour unchanged.
  const { bundleId, conceptId } = splitUnionId(stripMdSuffix(currentPath));
  const requalify = (id: string) =>
    bundleId === null ? id : namespaceUnionId(bundleId, id);

  return markdown.replace(
    MD_LINK_RE,
    (full, target: string, anchor: string) => {
      if (target.includes('://')) return full;
      if (target.startsWith(INTERNAL_LINK_MARKER)) return full;

      if (target.startsWith('/')) {
        // SPEC §5.1 bundle-absolute — strip the leading `/` and mark.
        const id = stripMdSuffix(target.replace(/^\/+/, ''));
        return id
          ? `](${INTERNAL_LINK_MARKER}${requalify(id)}.md${anchor})`
          : full;
      }

      const resolvedId = resolveInternalMdLink(conceptId, `${target}${anchor}`);
      if (!resolvedId) return full;

      return `](${INTERNAL_LINK_MARKER}${requalify(resolvedId)}.md${anchor})`;
    },
  );
}
