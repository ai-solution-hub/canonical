/**
 * Entity name canonicalisation for deduplication.
 *
 * Shared between the classification pipeline (lib/ai/classify.ts) and
 * batch entity extraction scripts. Import from '@/lib/entity-dedup'.
 */

/** Known abbreviations that should remain uppercase */
const ABBREVIATIONS: Record<string, string> = {
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
};

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
 * Normalise an entity name for consistent storage and deduplication.
 *
 * Rules applied (in order):
 * 1. Trim whitespace
 * 2. Convert slug-style names to proper case
 * 3. Normalise ISO standards: "ISO27001" -> "ISO 27001"
 * 4. Normalise Cyber Essentials variants
 * 5. Fix known abbreviation casing
 * 6. Strip trailing periods
 */
export function canonicalise(name: string): string {
  let result = name.trim();
  // Convert slug-style names: "penetration-testing" → "Penetration Testing"
  if (/^[a-z0-9].*[-_]/.test(result) && !/\s/.test(result)) {
    result = slugToProperCase(result);
  }
  // Normalise ISO standards: "ISO27001" -> "ISO 27001", always uppercase "ISO"
  result = result.replace(/^iso\s*(\d)/i, 'ISO $1');
  // Strip ISO version suffixes: "ISO 27001:2022" -> "ISO 27001"
  result = result.replace(/^(ISO \d+):\d{4}$/, '$1');
  // Normalise Cyber Essentials variants (including trailing words like "Plus")
  result = result.replace(/^cyber\s*essentials\b/i, 'Cyber Essentials');
  // Normalise "Cyber Essentials PLUS" / "Cyber Essentials plus" → "Cyber Essentials Plus"
  result = result.replace(/^(Cyber Essentials)\s+plus$/i, '$1 Plus');
  // Fix single-word abbreviations: "gdpr" → "GDPR", "crest" → "CREST"
  const lower = result.toLowerCase();
  if (ABBREVIATIONS[lower]) {
    result = ABBREVIATIONS[lower];
  }
  // Strip trailing periods
  result = result.replace(/\.$/, '');
  return result;
}
