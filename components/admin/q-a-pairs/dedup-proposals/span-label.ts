// components/admin/q-a-pairs/dedup-proposals/span-label.ts
//
// ID-120 {120.8} — shared "spans" badge-text helper for the dedup curator
// surface. The non-colour-only badge (INV-11/18) renders this exact text so
// the cross-workspace / cross-form provenance is carried by WORDS, not colour
// alone (WCAG 2.1 AA). Both the list row and the detail header render the same
// label, so the wording lives in ONE place. Returns the empty string when the
// proposal spans neither boundary — callers gate the badge on `spansWorkspaces
// || spansForms` before rendering, so that case is never shown.

/**
 * The badge text for a dedup proposal's cross-boundary span. Both booleans
 * false → `''` (callers do not render the badge in that case).
 */
export function spanLabel(
  spansWorkspaces: boolean,
  spansForms: boolean,
): string {
  if (spansWorkspaces && spansForms) return 'spans workspaces/forms';
  if (spansWorkspaces) return 'spans workspaces';
  if (spansForms) return 'spans forms';
  return '';
}
