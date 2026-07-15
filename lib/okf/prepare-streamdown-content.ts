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
 */
import { resolveInternalMdLink } from '@/lib/okf/resolve-internal-link';

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
  const currentId = stripMdSuffix(currentPath);

  return markdown.replace(
    MD_LINK_RE,
    (full, target: string, anchor: string) => {
      if (target.includes('://')) return full;
      if (target.startsWith(INTERNAL_LINK_MARKER)) return full;

      if (target.startsWith('/')) {
        // SPEC §5.1 bundle-absolute — strip the leading `/` and mark.
        const id = stripMdSuffix(target.replace(/^\/+/, ''));
        return id ? `](${INTERNAL_LINK_MARKER}${id}.md${anchor})` : full;
      }

      const resolvedId = resolveInternalMdLink(currentId, `${target}${anchor}`);
      if (!resolvedId) return full;

      return `](${INTERNAL_LINK_MARKER}${resolvedId}.md${anchor})`;
    },
  );
}
