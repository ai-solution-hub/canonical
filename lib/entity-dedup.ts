/**
 * Entity name canonicalisation for deduplication.
 *
 * Shared between the classification pipeline (lib/ai/classify.ts) and
 * batch entity extraction scripts. Import from '@/lib/entity-dedup'.
 */

/** Known abbreviations that should remain uppercase */
export const ABBREVIATIONS: Record<string, string> = {
  gdpr: 'GDPR',
  ico: 'ICO',
  owasp: 'OWASP',
  crest: 'CREST',
  csv: 'CSV',
  pdf: 'PDF',
  sla: 'SLA',
  ims: 'IMS',
  uk: 'UK',
  dpo: 'DPO',
  tls: 'TLS',
  ssl: 'SSL',
  https: 'HTTPS',
  http: 'HTTP',
  mysql: 'MySQL',
  api: 'API',
  sql: 'SQL',
  hmrc: 'HMRC',
  sme: 'SME',
  saml: 'SAML',
  sso: 'SSO',
  aws: 'AWS',
  mfa: 'MFA',
  nhs: 'NHS',
  plc: 'PLC',
  lms: 'LMS',
  pdms: 'PDMS',
  wcag: 'WCAG',
};

/** Entity types where trailing plural 's' should be stripped */
const DEPLURAL_TYPES = new Set([
  'capability',
  'framework',
  'regulation',
  'certification',
  'technology',
]);

/**
 * Convert a slug-style name to Title Case, preserving known abbreviations.
 * "penetration-testing" → "Penetration Testing"
 * "uk-gdpr" → "UK GDPR"
 */
function slugToProperCase(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ABBREVIATIONS[lower]) return ABBREVIATIONS[lower];
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Title-case a multi-word string, preserving known abbreviations.
 */
function titleCase(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => {
      const lower = w.toLowerCase();
      if (ABBREVIATIONS[lower]) return ABBREVIATIONS[lower];
      return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
    })
    .join(' ');
}

/**
 * Normalise an entity name for consistent storage and deduplication.
 *
 * Rules applied (in order):
 *  1. Trim whitespace
 *  2. Convert slug-style names to proper case
 *  3. Normalise ISO standards (basic): "ISO27001" → "ISO 27001"
 *  4. Normalise ISO extended formats: "ISO/IEC 27001", "ISO-27001", "Iso Iec 27001"
 *  5. Strip ISO version suffixes: "ISO 27001:2022" → "ISO 27001"
 *  6. Normalise Cyber Essentials variants
 *  7. WCAG normalisation: "Wcag 2 1 Aa" → "WCAG 2.1 AA"
 *  8. Company suffix normalisation: "Ltd" → "Limited"
 *  9. Fix single-word abbreviations: "gdpr" → "GDPR"
 * 10. Multi-word title case for all-lowercase inputs
 * 11. Plural normalisation (type-aware)
 * 12. Strip trailing periods
 *
 * @param name       The entity name to normalise
 * @param entityType Optional entity type for type-aware rules (e.g. plural stripping)
 */
export function canonicalise(name: string, entityType?: string): string {
  let result = name.trim();

  // 1 → 2. Convert slug-style names: "penetration-testing" → "Penetration Testing"
  if (/^[a-z0-9].*[-_]/.test(result) && !/\s/.test(result)) {
    result = slugToProperCase(result);
  }

  // 3. Normalise ISO standards (basic): "ISO27001" → "ISO 27001"
  result = result.replace(/^iso\s*(\d)/i, 'ISO $1');

  // 4. Normalise ISO extended formats:
  //    "ISO/IEC 27001" → "ISO 27001"
  //    "Iso Iec 27001" → "ISO 27001"
  //    "ISO-27001"     → "ISO 27001"
  result = result.replace(/^iso[/\-\s]*(?:iec[/\-\s]*)?(\d)/i, 'ISO $1');

  // 5. Strip ISO version suffixes: "ISO 27001:2022" → "ISO 27001"
  result = result.replace(/^(ISO \d+)[:\s]\d{4}$/, '$1');

  // 6. Normalise Cyber Essentials variants
  result = result.replace(/^cyber\s*essentials\b/i, 'Cyber Essentials');
  result = result.replace(/^(Cyber Essentials)\s+plus$/i, '$1 Plus');

  // 7. WCAG normalisation: "Wcag 2 1 Aa" → "WCAG 2.1 AA"
  result = result.replace(
    /^wcag\s+(\d)\s+(\d)\s*(aa|a)$/i,
    (_m, maj, min, level) => `WCAG ${maj}.${min} ${level.toUpperCase()}`,
  );
  result = result.replace(/\bwcag\b/gi, 'WCAG');

  // 8. Company suffix normalisation: "Ltd" / "Ltd." → "Limited"
  result = result.replace(/\bLtd\.?$/i, 'Limited');
  result = result.replace(/\bPLC$/i, 'PLC');
  result = result.replace(/\bInc\.?$/i, 'Inc');

  // 9. Fix single-word abbreviations: "gdpr" → "GDPR"
  const lower = result.toLowerCase();
  if (ABBREVIATIONS[lower]) {
    result = ABBREVIATIONS[lower];
  }

  // 10. Multi-word title case for all-lowercase inputs (not single-word abbreviations)
  if (/^[a-z]/.test(result) && !ABBREVIATIONS[result.toLowerCase()]) {
    result = titleCase(result);
  }

  // 11. Plural normalisation — strip trailing 's' for applicable entity types
  if (
    entityType &&
    DEPLURAL_TYPES.has(entityType) &&
    result.endsWith('s') &&
    !result.endsWith('ss') &&
    result.length > 4
  ) {
    result = result.slice(0, -1);
  }

  // 12. Strip trailing periods
  result = result.replace(/\.$/, '');

  return result;
}
