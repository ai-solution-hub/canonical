import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'fs/promises';
import { join } from 'path';

// ──────────────────────────────────────────
// Mock dependencies (only needed for classifyContent import)
// ──────────────────────────────────────────

const mockCreate = vi.fn();

vi.mock('@/lib/anthropic', () => ({
  getAnthropicClient: () => ({
    messages: { create: mockCreate },
  }),
  getAIModel: () => 'claude-sonnet-4-6',
  estimateCost: () => 0.031,
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/content/strip-markdown', () => ({
  stripMarkdown: (text: string) => text,
}));

vi.mock('@/lib/entities/entity-aliases', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/entities/entity-aliases')>();
  return {
    ...actual,
    loadAliases: vi.fn().mockResolvedValue({}),
  };
});

// ──────────────────────────────────────────
// Tests
// ──────────────────────────────────────────

describe('Classification skill file', () => {
  let skillContent: string;

  beforeEach(async () => {
    // Load the actual skill file from disk (not via the loader, to test raw content)
    const skillPath = join(__dirname, '../../lib/ai/skills/classification.md');
    skillContent = await readFile(skillPath, 'utf-8');
  });

  it('loads successfully via loadSkill', async () => {
    // Use the actual loader (not mocked) to verify file discovery works
    const { loadSkill } = await import('@/lib/ai/skills/loader');
    const content = await loadSkill('classification');
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(100);
  });

  // AI-C1 — verify that the entity types reference doc is actually loadable
  // and contains the expected per-entity-type content. The S150 verification
  // flagged this as PARTIAL because no test exercised the real loader for the
  // entity types reference doc — only the main classification skill was tested.
  // Without this guard, a future change that removes loadSkill('classification-
  // entity-types') from classify.ts would not be caught.
  it('classification-entity-types skill loads and contains all 12 entity types', async () => {
    const { loadSkill } = await import('@/lib/ai/skills/loader');
    const content = await loadSkill('classification-entity-types');

    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(1000);

    // Verify the loaded content contains the per-type "The Test:" diagnostic
    // questions (the key content the entity types reference adds beyond the
    // main skill file).
    expect(content).toContain('The Test:');

    // Verify all 12 entity types are present
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];
    for (const type of requiredTypes) {
      expect(content.toLowerCase()).toContain(type);
    }

    // Verify Include/Exclude/Boundary structure is present
    expect(content).toContain('Include');
    expect(content).toContain('Exclude');
    expect(content).toContain('Boundary');
  });

  it('classify.ts source actually calls loadSkill for classification-entity-types', async () => {
    // Guard against the "load and forget" pattern: verify the production
    // classify.ts file actually invokes loadSkill('classification-entity-types').
    // This is a static check — if someone removes the call, this test fails
    // immediately even before the integration tests run.
    const classifyPath = join(__dirname, '../../lib/ai/classify.ts');
    const classifySource = await readFile(classifyPath, 'utf-8');

    expect(classifySource).toContain(
      "loadSkill('classification-entity-types')",
    );
    // Also verify it calls loadSkill('classification') (the main skill)
    expect(classifySource).toContain("loadSkill('classification')");
  });

  it('contains required entity extraction rules section', () => {
    expect(skillContent).toContain('## Entity Extraction Rules');
    expect(skillContent).toContain('Named Entity Test');
    expect(skillContent).toContain('External Reference Test');
    expect(skillContent).toContain('Policy/Procedure/Plan Rule');
    expect(skillContent).toContain('Role Title Rule');
    expect(skillContent).toContain('Generic Concept Rule');
  });

  it('contains required entity type definitions', () => {
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];
    for (const type of requiredTypes) {
      expect(skillContent).toContain(`### ${type}`);
    }
  });

  it('contains the {TAXONOMY} placeholder for runtime injection', () => {
    expect(skillContent).toContain('{TAXONOMY}');
  });

  it('contains the {CLIENT_DISAMBIGUATION} placeholder', () => {
    expect(skillContent).toContain('{CLIENT_DISAMBIGUATION}');
  });

  it('contains the {CLIENT_PRODUCT_NAME} placeholder', () => {
    expect(skillContent).toContain('{CLIENT_PRODUCT_NAME}');
  });

  it('contains the {CLIENT_ORGANISATION_NAME} placeholder', () => {
    expect(skillContent).toContain('{CLIENT_ORGANISATION_NAME}');
  });

  it('contains the {CLIENT_PRODUCT_SHORT} placeholder', () => {
    expect(skillContent).toContain('{CLIENT_PRODUCT_SHORT}');
  });

  it('contains keyword guidance section', () => {
    expect(skillContent).toContain('## Keywords Guidance');
    expect(skillContent).toContain('3\u20135 descriptive keywords');
  });

  it('contains summary and title guidance', () => {
    expect(skillContent).toContain('## Summary and Title Guidance');
    expect(skillContent).toContain('summary');
    expect(skillContent).toContain('suggested_title');
  });

  it('contains temporal reference extraction guidance', () => {
    expect(skillContent).toContain('## Temporal Reference Extraction');
    expect(skillContent).toContain('related_entity');
  });

  it('contains relationship extraction guidance', () => {
    expect(skillContent).toContain('## Relationship Extraction');
    expect(skillContent).toContain('canonical_name');
  });
});

describe('Classification entity types reference', () => {
  let entityTypesContent: string;

  beforeEach(async () => {
    const skillPath = join(
      __dirname,
      '../../lib/ai/skills/classification-entity-types.md',
    );
    entityTypesContent = await readFile(skillPath, 'utf-8');
  });

  it('loads successfully via loadSkill', async () => {
    const { loadSkill } = await import('@/lib/ai/skills/loader');
    const content = await loadSkill('classification-entity-types');
    expect(content).toBeTruthy();
    expect(content.length).toBeGreaterThan(100);
  });

  it('contains all 12 entity type sections', () => {
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];
    for (const type of requiredTypes) {
      expect(entityTypesContent).toContain(`### ${type}`);
    }
  });

  it('contains "The Test" diagnostic question for each type', () => {
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];

    // Each type section should have a "The Test" entry
    for (const type of requiredTypes) {
      const typeIndex = entityTypesContent.indexOf(`### ${type}`);
      expect(typeIndex).toBeGreaterThan(-1);

      // Find the next type section (or end of file)
      const nextTypeIndex =
        requiredTypes
          .filter((t) => t !== type)
          .map((t) => entityTypesContent.indexOf(`### ${t}`, typeIndex + 1))
          .filter((i) => i > typeIndex)
          .sort((a, b) => a - b)[0] ?? entityTypesContent.length;

      const section = entityTypesContent.slice(typeIndex, nextTypeIndex);
      expect(section).toContain('**The Test:**');
    }
  });

  it('contains Include and Exclude guidance for each type', () => {
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];

    for (const type of requiredTypes) {
      const typeIndex = entityTypesContent.indexOf(`### ${type}`);
      const nextTypeIndex =
        requiredTypes
          .filter((t) => t !== type)
          .map((t) => entityTypesContent.indexOf(`### ${t}`, typeIndex + 1))
          .filter((i) => i > typeIndex)
          .sort((a, b) => a - b)[0] ?? entityTypesContent.length;

      const section = entityTypesContent.slice(typeIndex, nextTypeIndex);
      expect(section).toContain('**Include:**');
      expect(section).toContain('**Exclude:**');
    }
  });

  it('contains boundary cases for each type', () => {
    const requiredTypes = [
      'organisation',
      'certification',
      'regulation',
      'framework',
      'capability',
      'person',
      'technology',
      'project',
      'sector',
      'product',
      'standard',
      'methodology',
    ];

    for (const type of requiredTypes) {
      const typeIndex = entityTypesContent.indexOf(`### ${type}`);
      const nextTypeIndex =
        requiredTypes
          .filter((t) => t !== type)
          .map((t) => entityTypesContent.indexOf(`### ${t}`, typeIndex + 1))
          .filter((i) => i > typeIndex)
          .sort((a, b) => a - b)[0] ?? entityTypesContent.length;

      const section = entityTypesContent.slice(typeIndex, nextTypeIndex);
      expect(section).toContain('**Boundary cases:**');
    }
  });
});

describe('Classification skill few-shot examples', () => {
  let skillContent: string;

  beforeEach(async () => {
    const skillPath = join(__dirname, '../../lib/ai/skills/classification.md');
    skillContent = await readFile(skillPath, 'utf-8');
  });

  it('contains the Classification Examples section', () => {
    expect(skillContent).toContain('## Classification Examples');
  });

  it('covers at least 4 different domains', () => {
    const examplesStart = skillContent.indexOf('## Classification Examples');
    const examplesEnd = skillContent.indexOf('## Handling Special Cases');
    const examplesSection = skillContent.slice(examplesStart, examplesEnd);

    const domains = [
      'security',
      'compliance',
      'implementation',
      'legislation-policy',
      'product-feature',
      'methodology',
      'corporate',
      'market-intelligence',
    ];
    const foundDomains = domains.filter((d) => examplesSection.includes(d));
    expect(foundDomains.length).toBeGreaterThanOrEqual(4);
  });

  it('includes at least one q_a_pair and one article example', () => {
    const examplesStart = skillContent.indexOf('## Classification Examples');
    const examplesEnd = skillContent.indexOf('## Handling Special Cases');
    const examplesSection = skillContent.slice(examplesStart, examplesEnd);

    expect(examplesSection).toContain('q_a_pair');
    expect(examplesSection).toContain('article');
  });

  it('includes at least 2 boundary case examples', () => {
    const examplesStart = skillContent.indexOf('## Classification Examples');
    const examplesEnd = skillContent.indexOf('## Handling Special Cases');
    const examplesSection = skillContent.slice(examplesStart, examplesEnd);

    const boundaryMentions = (examplesSection.match(/boundary case/gi) || [])
      .length;
    expect(boundaryMentions).toBeGreaterThanOrEqual(2);
  });

  it('includes at least 6 examples', () => {
    const examplesStart = skillContent.indexOf('## Classification Examples');
    const examplesEnd = skillContent.indexOf('## Handling Special Cases');
    const examplesSection = skillContent.slice(examplesStart, examplesEnd);

    const exampleHeaders = (examplesSection.match(/### Example \d+/g) || [])
      .length;
    expect(exampleHeaders).toBeGreaterThanOrEqual(6);
  });
});

describe('Classification skill token size guard', () => {
  it('combined classification skill + entity types reference stays below token budget', async () => {
    const skillPath = join(__dirname, '../../lib/ai/skills/classification.md');
    const entityTypesPath = join(
      __dirname,
      '../../lib/ai/skills/classification-entity-types.md',
    );

    const [skillContent, entityTypesContent] = await Promise.all([
      readFile(skillPath, 'utf-8'),
      readFile(entityTypesPath, 'utf-8'),
    ]);

    // Rough token estimate: ~4 characters per token for English text
    const CHARS_PER_TOKEN = 4;
    const combinedChars = skillContent.length + entityTypesContent.length;
    const estimatedTokens = Math.ceil(combinedChars / CHARS_PER_TOKEN);

    // Budget: 20,000 tokens. The combined files are currently ~15,000 tokens.
    // This threshold catches unexpected growth (e.g. duplicated sections,
    // unbounded example additions) while leaving room for intentional expansion.
    const TOKEN_BUDGET = 20_000;

    expect(estimatedTokens).toBeLessThan(TOKEN_BUDGET);
  });

  it('classification skill file alone stays below 15,000 tokens', async () => {
    const skillPath = join(__dirname, '../../lib/ai/skills/classification.md');
    const content = await readFile(skillPath, 'utf-8');

    const CHARS_PER_TOKEN = 4;
    const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

    // The skill file is the primary prompt payload. Keep it under 15,000 tokens
    // to leave room for taxonomy injection, user content, and tool schema.
    expect(estimatedTokens).toBeLessThan(15_000);
  });

  it('entity types reference file alone stays below 6,000 tokens', async () => {
    const entityTypesPath = join(
      __dirname,
      '../../lib/ai/skills/classification-entity-types.md',
    );
    const content = await readFile(entityTypesPath, 'utf-8');

    const CHARS_PER_TOKEN = 4;
    const estimatedTokens = Math.ceil(content.length / CHARS_PER_TOKEN);

    // The entity types reference is a supplementary file. Keep it focused.
    expect(estimatedTokens).toBeLessThan(6_000);
  });
});

describe('Classification skill placeholder interpolation', () => {
  let skillContent: string;

  beforeEach(async () => {
    const skillPath = join(__dirname, '../../lib/ai/skills/classification.md');
    skillContent = await readFile(skillPath, 'utf-8');
  });

  it('replaces {TAXONOMY} with sample taxonomy data', () => {
    const sampleTaxonomy = [
      '- security: cyber-security, data-protection',
      '- corporate: financial, staffing',
    ].join('\n');

    const interpolated = skillContent.replace('{TAXONOMY}', sampleTaxonomy);

    expect(interpolated).toContain(
      '- security: cyber-security, data-protection',
    );
    expect(interpolated).toContain('- corporate: financial, staffing');
    expect(interpolated).not.toContain('{TAXONOMY}');
  });

  it('replaces {CLIENT_DISAMBIGUATION} with disambiguation rules', () => {
    const rules = [
      '- "Test Product" is a SOFTWARE PRODUCT, not an auditing process.',
      '- Business continuity belongs in security/cyber-security.',
    ].join('\n');

    const interpolated = skillContent.replace('{CLIENT_DISAMBIGUATION}', rules);

    expect(interpolated).toContain('Test Product');
    expect(interpolated).not.toContain('{CLIENT_DISAMBIGUATION}');
  });

  it('replaces {CLIENT_PRODUCT_NAME} with the product name', () => {
    const interpolated = skillContent.replaceAll(
      '{CLIENT_PRODUCT_NAME}',
      'example-client Audit System',
    );

    expect(interpolated).toContain('example-client Audit System');
    expect(interpolated).not.toContain('{CLIENT_PRODUCT_NAME}');
  });

  it('produces a prompt with no unreplaced placeholders after full interpolation', () => {
    const sampleTaxonomy = '- security: cyber-security';
    const sampleDisambiguation = '- Product is a SOFTWARE PRODUCT.';

    const interpolated = skillContent
      .replace('{TAXONOMY}', sampleTaxonomy)
      .replace('{CLIENT_DISAMBIGUATION}', sampleDisambiguation)
      .replaceAll('{CLIENT_ORGANISATION_NAME}', 'Example Client Ltd')
      .replaceAll('{CLIENT_ORGANISATION_SHORT}', 'example-client')
      .replaceAll('{CLIENT_PRODUCT_NAME}', 'example-client Audit System')
      .replaceAll('{CLIENT_PRODUCT_SHORT}', 'audit system');

    // No unreplaced placeholders should remain
    const placeholderPattern = /\{[A-Z_]+\}/g;
    const remaining = interpolated.match(placeholderPattern);
    expect(remaining).toBeNull();
  });

  it('preserves markdown structure after interpolation', () => {
    const sampleTaxonomy = '- security: cyber-security';
    const sampleDisambiguation = '- Product is a SOFTWARE PRODUCT.';

    const interpolated = skillContent
      .replace('{TAXONOMY}', sampleTaxonomy)
      .replace('{CLIENT_DISAMBIGUATION}', sampleDisambiguation)
      .replaceAll('{CLIENT_ORGANISATION_NAME}', 'Example Client Ltd')
      .replaceAll('{CLIENT_ORGANISATION_SHORT}', 'example-client')
      .replaceAll('{CLIENT_PRODUCT_NAME}', 'example-client Audit System')
      .replaceAll('{CLIENT_PRODUCT_SHORT}', 'audit system');

    // Key section headings should remain intact
    expect(interpolated).toContain('# Classification Skill');
    expect(interpolated).toContain('## Entity Extraction Rules');
    expect(interpolated).toContain('## Entity Types');
    expect(interpolated).toContain('## Confidence Thresholds');
  });
});
