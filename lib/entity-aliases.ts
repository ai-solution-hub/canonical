/**
 * Entity alias map — maps known variant names to their canonical form.
 *
 * Applied AFTER canonicalise() rules. This handles cases that require
 * domain knowledge rather than string manipulation.
 *
 * Editable by admins via the Settings > Entities UI (future).
 * For now, maintained as a code constant.
 */
export const ENTITY_ALIASES: Record<string, string> = {
  // ── Company name variants ──────────────────────────────────────────
  example-client: 'Example Client Ltd',
  'example-client Design Ltd': 'Example Client Ltd',

  // ── Product names — ensure consistent canonical form ───────────────
  'example-client Audit': 'example-client Audit System',
  'example-client Audit Platform': 'example-client Audit System',

  'example-client Lms': 'example-client LMS',
  'Learning Management System': 'example-client LMS',

  'example-client Pdms': 'example-client PDMS',

  // ── ISO variants (beyond what canonicalise handles) ────────────────
  'ISO Certification': 'ISO 27001',
  'Iso Certifications': 'ISO 27001',
  'ISO 27001 2013': 'ISO 27001',
  'ISO 27000': 'ISO 27001',
  'ISO 9001 2015': 'ISO 9001',

  // ── Technology normalisation ───────────────────────────────────────────
  wordpress: 'WordPress',
  Wordpress: 'WordPress',
  Csharp: 'C#',
  csharp: 'C#',
  'Asp Net': 'ASP.NET',
  'Asp.net': 'ASP.NET',
  agile: 'Agile',
  Hcaptcha: 'hCaptcha',

  // ── WCAG ───────────────────────────────────────────────────────────
  'Wcag 2 1 Aa': 'WCAG 2.1 AA',
};

/**
 * Resolve an entity name through the alias map.
 * Returns the canonical form if an alias exists, otherwise returns the input.
 */
export function resolveAlias(canonicalName: string): string {
  return ENTITY_ALIASES[canonicalName] ?? canonicalName;
}
