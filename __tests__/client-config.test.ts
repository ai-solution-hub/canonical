import { describe, it, expect } from 'vitest';
import {
  CLIENT_CONFIG,
  isFeatureEnabled,
  type FeatureName,
  type LayerKey,
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

  it('has layer vocabulary with brief, detail, reference', () => {
    const keys = CLIENT_CONFIG.layer_vocabulary.map((l) => l.key);
    expect(keys).toContain('brief');
    expect(keys).toContain('detail');
    expect(keys).toContain('reference');
  });

  it('layer vocabulary entries have required fields', () => {
    for (const layer of CLIENT_CONFIG.layer_vocabulary) {
      expect(typeof layer.key).toBe('string');
      expect(typeof layer.label).toBe('string');
      expect(typeof layer.description).toBe('string');
      expect(typeof layer.order).toBe('number');
    }
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

  it('returns false for disabled features', () => {
    expect(isFeatureEnabled('coverage_dashboard')).toBe(false);
    expect(isFeatureEnabled('content_layers')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Layer schema validation
// ═══════════════════════════════════════════════════════════════════════════

describe('getLayerSchema', () => {
  const schema = getLayerSchema();

  it('accepts valid layer keys', () => {
    expect(schema.safeParse('brief').success).toBe(true);
    expect(schema.safeParse('detail').success).toBe(true);
    expect(schema.safeParse('reference').success).toBe(true);
  });

  it('rejects invalid layer keys', () => {
    expect(schema.safeParse('invalid').success).toBe(false);
    expect(schema.safeParse('').success).toBe(false);
    expect(schema.safeParse(123).success).toBe(false);
  });
});

describe('MetadataUpdateBodySchema', () => {
  it('accepts valid layer content', () => {
    const result = MetadataUpdateBodySchema.safeParse({
      brief: 'Executive summary',
      detail: 'More detail here',
    });
    expect(result.success).toBe(true);
  });

  it('accepts empty object', () => {
    const result = MetadataUpdateBodySchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts single layer', () => {
    const result = MetadataUpdateBodySchema.safeParse({
      reference: 'Technical details',
    });
    expect(result.success).toBe(true);
  });
});

describe('getLayerLabel', () => {
  it('returns label for known layer keys', () => {
    expect(getLayerLabel('brief')).toBe('Brief');
    expect(getLayerLabel('detail')).toBe('Detail');
    expect(getLayerLabel('reference')).toBe('Reference');
  });

  it('returns key itself for unknown layer keys', () => {
    expect(getLayerLabel('unknown')).toBe('unknown');
  });
});

describe('getOrderedLayers', () => {
  it('returns layers in order', () => {
    const layers = getOrderedLayers();
    expect(layers[0].key).toBe('brief');
    expect(layers[1].key).toBe('detail');
    expect(layers[2].key).toBe('reference');
  });

  it('returns a new array (not a reference to config)', () => {
    const a = getOrderedLayers();
    const b = getOrderedLayers();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});
