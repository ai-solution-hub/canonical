import { describe, it, expect } from 'vitest';
import { resolveAlias, ENTITY_ALIASES } from '@/lib/entity-aliases';
import { canonicalise } from '@/lib/entity-dedup';

describe('resolveAlias', () => {
  it('resolves known company alias', () => {
    expect(resolveAlias('example-client Design Ltd')).toBe('Example Client Ltd');
  });

  it('resolves short company name', () => {
    expect(resolveAlias('example-client')).toBe('Example Client Ltd');
  });

  it('passes through unknown names unchanged', () => {
    expect(resolveAlias('Unknown Corp')).toBe('Unknown Corp');
  });

  it('resolves product alias', () => {
    expect(resolveAlias('example-client Audit Platform')).toBe('example-client Audit System');
  });

  it('resolves ISO alias', () => {
    expect(resolveAlias('ISO 27001 2013')).toBe('ISO 27001');
  });

  it('resolves technology alias', () => {
    expect(resolveAlias('wordpress')).toBe('WordPress');
  });

  it('resolves LMS alias', () => {
    expect(resolveAlias('example-client Lms')).toBe('example-client LMS');
  });
});

describe('canonicalise → resolveAlias (chained)', () => {
  /** Helper: full normalisation pipeline as used in classify.ts */
  const normalise = (name: string) => resolveAlias(canonicalise(name));

  it('example-client design ltd → Example Client Ltd (canonicalise + alias)', () => {
    // canonicalise: 'example-client design ltd' → 'Example Client Ltd' (title case + Ltd→Limited)
    // resolveAlias: passthrough (already canonical)
    expect(normalise('example-client design ltd')).toBe('Example Client Ltd');
  });

  it('example-client → Example Client Ltd (canonicalise to example-client, then alias)', () => {
    // canonicalise: 'example-client' → 'example-client' (title case)
    // resolveAlias: 'example-client' → 'Example Client Ltd'
    expect(normalise('example-client')).toBe('Example Client Ltd');
  });

  it('ISO/IEC 27001 → ISO 27001 (canonicalise handles it, alias passthrough)', () => {
    expect(normalise('ISO/IEC 27001')).toBe('ISO 27001');
  });

  it('Iso Iec 27001 → ISO 27001', () => {
    expect(normalise('Iso Iec 27001')).toBe('ISO 27001');
  });

  it('example-client Audit Platform → example-client Audit System (alias resolves)', () => {
    expect(normalise('example-client Audit Platform')).toBe('example-client Audit System');
  });

  it('example-client audit → example-client Audit → example-client Audit System', () => {
    // canonicalise: 'example-client audit' → 'example-client Audit' (title case)
    // resolveAlias: 'example-client Audit' → 'example-client Audit System'
    expect(normalise('example-client audit')).toBe('example-client Audit System');
  });

  it('unknown entity passes through both stages', () => {
    expect(normalise('Acme Corporation')).toBe('Acme Corporation');
  });

  it('ISO Certification → ISO 27001 (alias resolves)', () => {
    expect(normalise('ISO Certification')).toBe('ISO 27001');
  });
});

describe('ENTITY_ALIASES map', () => {
  it('exports a non-empty alias map', () => {
    expect(Object.keys(ENTITY_ALIASES).length).toBeGreaterThan(0);
  });

  it('all alias values are non-empty strings', () => {
    for (const [key, value] of Object.entries(ENTITY_ALIASES)) {
      expect(value, `alias for "${key}" should be a non-empty string`).toBeTruthy();
    }
  });
});
