import { join } from 'node:path';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { VALID_CONTENT_TYPES } from '../lib/validation/schemas';
import {
  parseCanonicalTaxonomy,
  parsePluginTaxonomy,
  parsePluginDomainSlugs,
  parsePluginContentTypes,
  compareSets
} from '../scripts/lib/taxonomy-parser';

const PROJECT_ROOT = join(__dirname, '..');
const CANONICAL_PATH = join(PROJECT_ROOT, 'docs/reference/classification-prompt.md');
const CLASSIFICATION_SKILL_PATH = join(PROJECT_ROOT, '.claude/plugins/knowledge-hub/1.0.0/skills/classification/SKILL.md');
const SEARCH_SKILL_PATH = join(PROJECT_ROOT, '.claude/plugins/knowledge-hub/1.0.0/skills/search-strategy/SKILL.md');
const PLUGIN_ROOT = join(PROJECT_ROOT, '.claude/plugins/knowledge-hub/1.0.0');
const PLUGIN_EXISTS = existsSync(PLUGIN_ROOT);

describe.skipIf(!PLUGIN_EXISTS)('Plugin Taxonomy Consistency', () => {
  const canonicalMap = parseCanonicalTaxonomy(CANONICAL_PATH);
  const canonicalDomains = new Set(canonicalMap.keys());
  
  it('classification skill domains should match canonical domains', () => {
    const pluginMap = parsePluginTaxonomy(CLASSIFICATION_SKILL_PATH);
    const pluginDomains = new Set(pluginMap.keys());
    
    const { missing, extra } = compareSets(canonicalDomains, pluginDomains);
    
    expect(missing, `Missing domains in classification skill: ${missing.join(', ')}`).toHaveLength(0);
    expect(extra, `Extra domains in classification skill: ${extra.join(', ')}`).toHaveLength(0);
  });
  
  it('classification skill subtopics should match canonical subtopics per domain', () => {
    const pluginMap = parsePluginTaxonomy(CLASSIFICATION_SKILL_PATH);
    
    for (const [domain, canonicalSubtopics] of canonicalMap.entries()) {
      const pluginSubtopics = new Set(pluginMap.get(domain) || []);
      const canonicalSlugs = new Set(canonicalSubtopics.map(s => s.slug));
      const { missing, extra } = compareSets(canonicalSlugs, pluginSubtopics);
      
      expect(missing, `Missing subtopics in domain "${domain}": ${missing.join(', ')}`).toHaveLength(0);
      expect(extra, `Extra subtopics in domain "${domain}": ${extra.join(', ')}`).toHaveLength(0);
    }
  });
  
  it('search-strategy skill domain slugs should match canonical domains', () => {
    const pluginSlugs = new Set(parsePluginDomainSlugs(SEARCH_SKILL_PATH));
    
    const { missing, extra } = compareSets(canonicalDomains, pluginSlugs);
    
    expect(missing, `Missing domain slugs in search-strategy skill: ${missing.join(', ')}`).toHaveLength(0);
    // Extra slugs might be okay if they are logical aliases, but for now we expect a 1:1 match
    expect(extra, `Extra domain slugs in search-strategy skill: ${extra.join(', ')}`).toHaveLength(0);
  });
  
  it('classification skill content types should match lib/validation/schemas.ts', () => {
    const pluginTypes = new Set(parsePluginContentTypes(CLASSIFICATION_SKILL_PATH));
    const canonicalTypes = new Set(VALID_CONTENT_TYPES);
    
    const { missing, extra } = compareSets(canonicalTypes, pluginTypes);
    
    expect(missing, `Missing content types in classification skill: ${missing.join(', ')}`).toHaveLength(0);
    expect(extra, `Extra content types in classification skill: ${extra.join(', ')}`).toHaveLength(0);
  });
  
  it('should not contain any stale domain references in any plugin markdown files', () => {
    const forbidden = ["Service Delivery", "People & Culture"]; // Old domain names
    
    function getAllMarkdownFiles(dir: string): string[] {
      let results: string[] = [];
      const list = readdirSync(dir);
      list.forEach((file) => {
        const filePath = join(dir, file);
        const stat = statSync(filePath);
        if (stat && stat.isDirectory()) {
          results = results.concat(getAllMarkdownFiles(filePath));
        } else if (filePath.endsWith('.md')) {
          results.push(filePath);
        }
      });
      return results;
    }
    
    const allMdFiles = getAllMarkdownFiles(PLUGIN_ROOT);
    // Also include settings.template.json
    allMdFiles.push(join(PLUGIN_ROOT, 'settings.template.json'));
    
    for (const filePath of allMdFiles) {
      const content = readFileSync(filePath, 'utf8');
      for (const term of forbidden) {
        expect(content, `File ${filePath} contains forbidden stale domain reference "${term}"`).not.toContain(term);
      }
    }
  });
});
