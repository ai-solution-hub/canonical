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
}));

vi.mock('@/lib/ai/embed', () => ({
  generateEmbedding: vi.fn().mockResolvedValue(new Array(1024).fill(0)),
}));

vi.mock('@/lib/editor-utils', () => ({
  htmlToPlainText: (html: string) => html,
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
    expect(skillContent).toContain('ai_summary');
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

    expect(interpolated).toContain('- security: cyber-security, data-protection');
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
