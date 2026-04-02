import { describe, it, expect } from 'vitest';
import {
  CLIENT_CONFIG,
  isFeatureEnabled,
  type FeatureName,
} from '@/lib/client-config';
import {
  getLayerSchema,
  MetadataUpdateBodySchema,
  getLayerLabel,
  getOrderedLayers,
} from '@/lib/validation/layer-schemas';

// ═══════════════════════════════════════════════════════════════════════════
// CLIENT_CONFIG shape
// ═══════════════════════════════════════════════════════════════════════════

describe('CLIENT_CONFIG', () => {
  it('has required top-level fields', () => {
    expect(CLIENT_CONFIG.client_id).toBe('default');
    expect(CLIENT_CONFIG.client_name).toBe('Knowledge Hub');
    expect(typeof CLIENT_CONFIG.features).toBe('object');
    expect(Array.isArray(CLIENT_CONFIG.layer_vocabulary)).toBe(true);
  });

  it('has all expected feature toggles', () => {
    const expectedFeatures: FeatureName[] = [
      'tag_management',
      'coverage_dashboard',
      'content_layers',
      'draft_status',
      'ai_integration',
      'bid_management',
    ];
    for (const feature of expectedFeatures) {
      expect(CLIENT_CONFIG.features[feature]).toBeDefined();
      expect(typeof CLIENT_CONFIG.features[feature].enabled).toBe('boolean');
      expect(typeof CLIENT_CONFIG.features[feature].label).toBe('string');
      expect(typeof CLIENT_CONFIG.features[feature].description).toBe('string');
    }
  });

  it('has layer vocabulary with sales_brief, bid_detail, company_reference, research', () => {
    const keys = CLIENT_CONFIG.layer_vocabulary.map((l) => l.key);
    expect(keys).toContain('sales_brief');
    expect(keys).toContain('bid_detail');
    expect(keys).toContain('company_reference');
    expect(keys).toContain('research');
  });

  it('layer vocabulary entries have required fields', () => {
    for (const layer of CLIENT_CONFIG.layer_vocabulary) {
      expect(typeof layer.key).toBe('string');
      expect(typeof layer.label).toBe('string');
      expect(typeof layer.description).toBe('string');
      expect(typeof layer.order).toBe('number');
    }
  });

  describe('entity_examples', () => {
    it('has all required entity example fields', () => {
      expect(typeof CLIENT_CONFIG.entity_examples.organisation_name).toBe(
        'string',
      );
      expect(typeof CLIENT_CONFIG.entity_examples.organisation_short).toBe(
        'string',
      );
      expect(typeof CLIENT_CONFIG.entity_examples.product_name).toBe('string');
      expect(typeof CLIENT_CONFIG.entity_examples.product_short).toBe('string');
    });

    it('has non-empty example values', () => {
      expect(
        CLIENT_CONFIG.entity_examples.organisation_name.length,
      ).toBeGreaterThan(0);
      expect(CLIENT_CONFIG.entity_examples.product_name.length).toBeGreaterThan(
        0,
      );
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Feature toggle reads
// ═══════════════════════════════════════════════════════════════════════════

describe('isFeatureEnabled', () => {
  it('returns true for enabled features', () => {
    expect(isFeatureEnabled('tag_management')).toBe(true);
    expect(isFeatureEnabled('draft_status')).toBe(true);
    expect(isFeatureEnabled('ai_integration')).toBe(true);
    expect(isFeatureEnabled('bid_management')).toBe(true);
  });

  it('returns true for coverage_dashboard and content_layers (enabled Session 59)', () => {
    expect(isFeatureEnabled('coverage_dashboard')).toBe(true);
    expect(isFeatureEnabled('content_layers')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer schema validation
// ═══════════════════════════════════════════════════════════════════════════

describe('getLayerSchema', () => {
  const schema = getLayerSchema();

  it('accepts valid layer keys', () => {
    expect(schema.safeParse('sales_brief').success).toBe(true);
    expect(schema.safeParse('bid_detail').success).toBe(true);
    expect(schema.safeParse('company_reference').success).toBe(true);
    expect(schema.safeParse('research').success).toBe(true);
  });

  it('rejects invalid layer keys', () => {
    expect(schema.safeParse('invalid').success).toBe(false);
    expect(schema.safeParse('brief').success).toBe(false);
    expect(schema.safeParse('detail').success).toBe(false);
    expect(schema.safeParse('reference').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse(123).success).toBe(false);
  });
});

describe('MetadataUpdateBodySchema', () => {
  it('accepts valid layer content', () => {
    const result = MetadataUpdateBodySchema.safeParse({
      sales_brief: 'Positioning text',
      bid_detail: 'Factual content',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = MetadataUpdateBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts single layer', () => {
    const result = MetadataUpdateBodySchema.safeParse({
      company_reference: 'Corporate document',
    });
    expect(result.success).toBe(true);
  });
});

describe('getLayerLabel', () => {
  it('returns label for known layer keys', () => {
    expect(getLayerLabel('sales_brief')).toBe('Sales Brief');
    expect(getLayerLabel('bid_detail')).toBe('Bid Detail');
    expect(getLayerLabel('company_reference')).toBe('Company Reference');
    expect(getLayerLabel('research')).toBe('Research');
  });

  it('returns key itself for unknown layer keys', () => {
    expect(getLayerLabel('unknown')).toBe('unknown');
  });
});

describe('getOrderedLayers', () => {
  it('returns layers in order', () => {
    const layers = getOrderedLayers();
    expect(layers[0].key).toBe('sales_brief');
    expect(layers[1].key).toBe('bid_detail');
    expect(layers[2].key).toBe('company_reference');
    expect(layers[3].key).toBe('research');
  });

  it('returns a new array (not a reference to config)', () => {
    const a = getOrderedLayers();
    const b = getOrderedLayers();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
