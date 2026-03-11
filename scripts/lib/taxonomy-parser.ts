import { readFileSync } from 'node:fs';

/**
 * Parses the canonical taxonomy from docs/reference/classification-prompt.md
 * Returns a Map of domain (lowercase slug) to its subtopics { slug, desc }.
 */
export function parseCanonicalTaxonomy(filePath: string): Map<string, { slug: string, desc: string }[]> {
  const content = readFileSync(filePath, 'utf8');
  const startMarker = '<!-- TAXONOMY_START -->';
  const endMarker = '<!-- TAXONOMY_END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error('Canonical taxonomy markers not found');
  }
  
  const taxonomySection = content.substring(startIndex + startMarker.length, endIndex);
  const taxonomyMap = new Map<string, { slug: string, desc: string }[]>();
  
  // Match "#### N. DOMAIN_NAME"
  const domainRegex = /#### \d+\. ([^\n\r]+)/g;
  let domainMatch;
  
  while ((domainMatch = domainRegex.exec(taxonomySection)) !== null) {
    const domainName = domainMatch[1].trim().toLowerCase();
    const domainStart = domainMatch.index;
    
    // Find where this domain section ends (next domain or end of section)
    const nextDomainRegex = /#### \d+\. /g;
    nextDomainRegex.lastIndex = domainRegex.lastIndex;
    const nextDomainMatch = nextDomainRegex.exec(taxonomySection);
    const domainEnd = nextDomainMatch ? nextDomainMatch.index : taxonomySection.length;
    
    const domainScope = taxonomySection.substring(domainStart, domainEnd);
    
    // Match subtopics: - `subtopic-slug`: description
    const subtopicRegex = /- `([^`]+)`:\s*([^ \n\r][^\n\r]+)/g;
    const subtopics: { slug: string, desc: string }[] = [];
    let subtopicMatch;
    
    while ((subtopicMatch = subtopicRegex.exec(domainScope)) !== null) {
      subtopics.push({ 
        slug: subtopicMatch[1].trim().toLowerCase(),
        desc: subtopicMatch[2].trim()
      });
    }
    
    taxonomyMap.set(domainName, subtopics);
  }
  
  return taxonomyMap;
}

/**
 * Parses taxonomy from a plugin skill file (e.g. classification/SKILL.md)
 * between <!-- TAXONOMY_INJECT_START --> markers.
 */
export function parsePluginTaxonomy(filePath: string): Map<string, string[]> {
  const content = readFileSync(filePath, 'utf8');
  const startMarker = '<!-- TAXONOMY_INJECT_START -->';
  const endMarker = '<!-- TAXONOMY_INJECT_END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Plugin taxonomy markers not found in ${filePath}`);
  }
  
  const section = content.substring(startIndex + startMarker.length, endIndex);
  const taxonomyMap = new Map<string, string[]>();
  
  // Match "Domain Name (N subtopics)" at the start of a block
  const domainRegex = /^([A-Z][a-zA-Z- ]+) \(\d+ subtopics\)/gm;
  let domainMatch;
  
  while ((domainMatch = domainRegex.exec(section)) !== null) {
    const domainName = domainMatch[1].trim().toLowerCase();
    const domainStart = domainMatch.index;
    
    // Find where this domain section ends
    const nextDomainRegex = /^([A-Z][a-zA-Z- ]+) \(\d+ subtopics\)/gm;
    nextDomainRegex.lastIndex = domainRegex.lastIndex;
    const nextDomainMatch = nextDomainRegex.exec(section);
    const domainEnd = nextDomainMatch ? nextDomainMatch.index : section.length;
    
    const domainScope = section.substring(domainStart, domainEnd);
    
    // Match subtopics in tree: ├── subtopic-slug (description)
    // Parentheses are optional to handle sync script output before it included them
    const subtopicRegex = /[├└]── ([a-z0-9-]+)(?: \(([^)]+)\))?/g;
    const subtopics: string[] = [];
    let subtopicMatch;
    
    while ((subtopicMatch = subtopicRegex.exec(domainScope)) !== null) {
      subtopics.push(subtopicMatch[1].trim().toLowerCase());
    }
    
    taxonomyMap.set(domainName, subtopics);
  }
  
  return taxonomyMap;
}

/**
 * Parses domain slugs from search-strategy/SKILL.md table
 */
export function parsePluginDomainSlugs(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8');
  const startMarker = '<!-- TAXONOMY_INJECT_START -->';
  const endMarker = '<!-- TAXONOMY_INJECT_END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Plugin taxonomy markers not found in ${filePath}`);
  }
  
  const section = content.substring(startIndex + startMarker.length, endIndex);
  const slugs: string[] = [];
  
  // Match rows in table: | Signal words | slug |
  const tableRowRegex = /\|[^|]+\| ([a-z0-9-]+) \|/g;
  let match;
  
  while ((match = tableRowRegex.exec(section)) !== null) {
    const slug = match[1].trim().toLowerCase();
    // Skip table header or separator if it matches incorrectly
    if (slug === 'domain' || slug === 'slug' || slug === '---') continue;
    slugs.push(slug);
  }
  
  return slugs;
}

/**
 * Parses content types from classification/SKILL.md table
 */
export function parsePluginContentTypes(filePath: string): string[] {
  const content = readFileSync(filePath, 'utf8');
  const startMarker = '<!-- CONTENT_TYPES_INJECT_START -->';
  const endMarker = '<!-- CONTENT_TYPES_INJECT_END -->';
  
  const startIndex = content.indexOf(startMarker);
  const endIndex = content.indexOf(endMarker);
  
  if (startIndex === -1 || endIndex === -1) {
    throw new Error(`Plugin content type markers not found in ${filePath}`);
  }
  
  const section = content.substring(startIndex + startMarker.length, endIndex);
  const types: string[] = [];
  
  // Match rows in table: | **type** | description | ... |
  const tableRowRegex = /\| \*\*([a-z0-9_]+)\*\* \|/g;
  let match;
  
  while ((match = tableRowRegex.exec(section)) !== null) {
    types.push(match[1].trim().toLowerCase());
  }
  
  return types;
}

/**
 * Compares two sets and returns missing and extra items
 */
export function compareSets(canonical: Set<string>, actual: Set<string>): { missing: string[], extra: string[] } {
  const missing = [...canonical].filter(x => !actual.has(x));
  const extra = [...actual].filter(x => !canonical.has(x));
  
  return { missing, extra };
}
