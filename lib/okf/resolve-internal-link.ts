/**
 * Client-side internal `.md` link resolver for `<ConceptDetail>`'s rendered
 * markdown body (ID-132 {132.14} G-VIEWER, port of `viz.js`'s
 * `rewriteInternalLinks`).
 *
 * The reference's static-HTML build resolves links server-side at generation
 * time; our runtime React surfaces render the markdown body client-side via
 * Streamdown (pre-resolved through `prepare-streamdown-content.ts`, this
 * module's sole consumer), so a body's `[text](../foo.md)` link is still
 * relative-to-the-source-file, exactly as `lib/okf/bundle-graph.ts`'s
 * `extractLinks` resolves it server-side. This is the same resolution logic
 * re-expressed as a pure string utility (no `node:path`) so it runs in a
 * `'use client'` component without a Node builtin dependency.
 */

/**
 * Resolve a markdown link `href` found in `currentConceptId`'s body to a
 * bundle-root-relative concept id, or `null` when the link is external
 * (has a URL scheme) or not a `.md` link.
 *
 * A leading-`/` href is the SPEC §5.1 bundle-ABSOLUTE form (the producer's
 * `# Citations` trailer and body-prose cross-link convention) — resolved
 * against the BUNDLE ROOT (the leading `/` stripped, no directory-relative
 * walk), never treated as external.
 *
 * Does NOT check the result against the known concept-id set — the caller
 * (`<ConceptDetail>`) does that, so a resolved-but-unknown id (a link to a
 * concept that does not exist in this bundle) still renders as plain text,
 * matching the reference's `rewriteInternalLinks` fallback-to-external
 * behaviour when `nodeIndex[target]` is absent.
 */
export function resolveInternalMdLink(
  currentConceptId: string,
  href: string,
): string | null {
  if (!href || href.includes('://')) return null;

  const isBundleAbsolute = href.startsWith('/');
  const hashIdx = href.indexOf('#');
  const withoutAnchor = hashIdx === -1 ? href : href.slice(0, hashIdx);
  if (!withoutAnchor.endsWith('.md')) return null;

  const currentDirSegments = isBundleAbsolute
    ? []
    : currentConceptId.split('/').slice(0, -1);
  const targetSegments = withoutAnchor.replace(/^\/+/, '').split('/');

  const resolved: string[] = [...currentDirSegments];
  for (const segment of targetSegments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(segment);
  }

  let result = resolved.join('/');
  if (result.endsWith('.md')) result = result.slice(0, -3);
  return result || null;
}
