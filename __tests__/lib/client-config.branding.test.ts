import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  parseOklch,
  oklchToRelativeLuminance,
  contrastRatio,
  validateBrandingContrast,
  deriveDarkVariant,
  derivePrimaryForeground,
  BrandingConfigSchema,
  assertBrandAssetsExist,
  type BrandingConfig,
  type OklchComponents,
} from '@/lib/client-config';

// ---------------------------------------------------------------------------
// parseOklch
// ---------------------------------------------------------------------------

describe('parseOklch', () => {
  it('parses a valid OKLCH string', () => {
    const result = parseOklch('oklch(0.65 0.16 55)');
    expect(result).toEqual({ l: 0.65, c: 0.16, h: 55 });
  });

  it('parses with leading/trailing whitespace', () => {
    const result = parseOklch('  oklch(0.65 0.16 55)  ');
    expect(result).toEqual({ l: 0.65, c: 0.16, h: 55 });
  });

  it('parses edge case L=0', () => {
    const result = parseOklch('oklch(0 0 0)');
    expect(result).toEqual({ l: 0, c: 0, h: 0 });
  });

  it('parses edge case L=1', () => {
    const result = parseOklch('oklch(1 0 0)');
    expect(result).toEqual({ l: 1, c: 0, h: 0 });
  });

  it('rejects H=360 (must be < 360)', () => {
    expect(parseOklch('oklch(0.5 0.1 360)')).toBeNull();
  });

  it('rejects L > 1', () => {
    expect(parseOklch('oklch(1.1 0.1 55)')).toBeNull();
  });

  it('rejects C > 0.4', () => {
    expect(parseOklch('oklch(0.5 0.5 55)')).toBeNull();
  });

  it('rejects negative L', () => {
    expect(parseOklch('oklch(-0.1 0.1 55)')).toBeNull();
  });

  it('rejects invalid format', () => {
    expect(parseOklch('rgb(255, 0, 0)')).toBeNull();
    expect(parseOklch('#ff0000')).toBeNull();
    expect(parseOklch('')).toBeNull();
    expect(parseOklch('oklch()')).toBeNull();
  });

  it('rejects missing components', () => {
    expect(parseOklch('oklch(0.5 0.1)')).toBeNull();
    expect(parseOklch('oklch(0.5)')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// oklchToRelativeLuminance
// ---------------------------------------------------------------------------

describe('oklchToRelativeLuminance', () => {
  it('returns ~1.0 for pure white', () => {
    const white: OklchComponents = { l: 1, c: 0, h: 0 };
    const lum = oklchToRelativeLuminance(white);
    expect(lum).toBeCloseTo(1.0, 1);
  });

  it('returns ~0.0 for pure black', () => {
    const black: OklchComponents = { l: 0, c: 0, h: 0 };
    const lum = oklchToRelativeLuminance(black);
    expect(lum).toBeCloseTo(0.0, 2);
  });

  it('returns ~0.125 for mid grey (L=0.5)', () => {
    const midGrey: OklchComponents = { l: 0.5, c: 0, h: 0 };
    const lum = oklchToRelativeLuminance(midGrey);
    expect(lum).toBeCloseTo(0.125, 2);
  });

  it('returns ~0.26 for KH default primary', () => {
    const khPrimary: OklchComponents = { l: 0.65, c: 0.16, h: 55 };
    const lum = oklchToRelativeLuminance(khPrimary);
    expect(lum).toBeCloseTo(0.26, 1);
  });
});

// ---------------------------------------------------------------------------
// contrastRatio
// ---------------------------------------------------------------------------

describe('contrastRatio', () => {
  it('returns 21:1 for white vs black', () => {
    const ratio = contrastRatio('oklch(1 0 0)', 'oklch(0 0 0)');
    expect(ratio).toBeCloseTo(21, 0);
  });

  it('returns ~2.85:1 for KH default primary vs light bg', () => {
    const ratio = contrastRatio('oklch(0.65 0.16 55)', 'oklch(0.94 0.01 48)');
    expect(ratio).toBeCloseTo(2.85, 1);
  });

  it('throws for invalid OKLCH input', () => {
    expect(() => contrastRatio('#fff', '#000')).toThrow('invalid OKLCH');
  });

  it('returns a ratio >= 1', () => {
    const ratio = contrastRatio('oklch(0.5 0 0)', 'oklch(0.5 0 0)');
    expect(ratio).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// validateBrandingContrast
// ---------------------------------------------------------------------------

describe('validateBrandingContrast', () => {
  function makeBranding(
    overrides: Partial<BrandingConfig> = {},
  ): BrandingConfig {
    return {
      clientId: 'test',
      productName: 'Test',
      productShortName: 'Test',
      organisationName: 'Test Org',
      tagline: 'Test tagline',
      supportEmail: 'test@example.com',
      brandPrimaryColour: 'oklch(0.65 0.16 55)',
      logoUrl: '/favicon.svg',
      logoAlt: 'Test logo',
      logoMaxWidthPx: 140,
      logoAspectRatio: 3,
      faviconSvgUrl: '/favicon.svg',
      faviconPngUrl: '/favicon.png',
      classificationDisambiguation: {
        entityExamples: [],
        selfReferenceRules: [],
      },
      ...overrides,
    };
  }

  it('warns when primary vs light bg is below 3:1 (Tier 1)', () => {
    // KH default primary is ~2.85:1 — below 3:1
    const report = validateBrandingContrast(makeBranding());
    expect(report.warnings.length).toBeGreaterThan(0);
    expect(report.warnings[0]).toContain('3:1');
  });

  it('does not error when auto-derived foreground passes 4.5:1 (Tier 2)', () => {
    // KH default primary auto-derives black foreground at ~5.79:1
    const report = validateBrandingContrast(makeBranding());
    expect(report.errors).toHaveLength(0);
  });

  it('errors when foreground vs primary is below 4.5:1', () => {
    // Force a primary-foreground that is too close to the primary
    const report = validateBrandingContrast(
      makeBranding({
        brandPrimaryForeground: 'oklch(0.6 0.1 55)',
      }),
    );
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain('4.5:1');
  });

  it('uses explicit brandPrimaryColourDark when supplied', () => {
    const report = validateBrandingContrast(
      makeBranding({
        brandPrimaryColourDark: 'oklch(0.75 0.16 55)',
      }),
    );
    // Should not throw — just validate the explicit dark primary
    expect(report).toBeDefined();
  });

  it('no warnings for a high-contrast compliant primary', () => {
    // Use a primary that has good contrast against both light and dark bgs.
    // L=0.55 with moderate chroma gives ~3+:1 against light bg, and the
    // derived dark variant (L~0.62) gives ~3+:1 against dark bg.
    const report = validateBrandingContrast(
      makeBranding({
        brandPrimaryColour: 'oklch(0.55 0.15 250)',
      }),
    );
    expect(report.warnings).toHaveLength(0);
    expect(report.errors).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// deriveDarkVariant
// ---------------------------------------------------------------------------

describe('deriveDarkVariant', () => {
  it('decreases L for bright primaries (L=0.85)', () => {
    const result = deriveDarkVariant('oklch(0.85 0.1 55)');
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.l).toBeCloseTo(0.75, 2);
  });

  it('increases L for darker primaries (L=0.45)', () => {
    const result = deriveDarkVariant('oklch(0.45 0.1 55)');
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.l).toBeCloseTo(0.52, 2);
  });

  it('handles boundary case L=0.75 (not bright, increases)', () => {
    const result = deriveDarkVariant('oklch(0.75 0.1 55)');
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.l).toBeCloseTo(0.82, 2);
  });

  it('preserves C and H', () => {
    const result = deriveDarkVariant('oklch(0.5 0.2 120)');
    const parsed = parseOklch(result);
    expect(parsed).not.toBeNull();
    expect(parsed!.c).toBe(0.2);
    expect(parsed!.h).toBe(120);
  });

  it('throws for invalid OKLCH', () => {
    expect(() => deriveDarkVariant('#fff')).toThrow('invalid OKLCH');
  });
});

// ---------------------------------------------------------------------------
// derivePrimaryForeground
// ---------------------------------------------------------------------------

describe('derivePrimaryForeground', () => {
  it('picks black-ish for light primaries', () => {
    const fg = derivePrimaryForeground('oklch(0.85 0.05 55)');
    const parsed = parseOklch(fg);
    expect(parsed).not.toBeNull();
    expect(parsed!.l).toBeLessThan(0.5);
  });

  it('picks white-ish for dark primaries', () => {
    const fg = derivePrimaryForeground('oklch(0.3 0.05 250)');
    const parsed = parseOklch(fg);
    expect(parsed).not.toBeNull();
    expect(parsed!.l).toBeGreaterThan(0.5);
  });

  it('returns a valid OKLCH string', () => {
    const fg = derivePrimaryForeground('oklch(0.65 0.16 55)');
    expect(parseOklch(fg)).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// BrandingConfigSchema
// ---------------------------------------------------------------------------

describe('BrandingConfigSchema', () => {
  const validConfig = {
    clientId: 'test',
    productName: 'Test Product',
    productShortName: 'Test',
    organisationName: 'Test Org',
    tagline: 'A test tagline',
    supportEmail: 'test@example.com',
    brandPrimaryColour: 'oklch(0.5 0.1 200)',
    logoUrl: '/favicon.svg',
    logoAlt: 'Test logo',
    faviconSvgUrl: '/favicon.svg',
    faviconPngUrl: '/favicon.png',
  };

  it('parses a valid config with defaults', () => {
    const result = BrandingConfigSchema.parse(validConfig);
    expect(result.clientId).toBe('test');
    expect(result.logoMaxWidthPx).toBe(140); // default
    expect(result.logoAspectRatio).toBe(3); // default
    expect(result.classificationDisambiguation).toEqual({
      entityExamples: [],
      selfReferenceRules: [],
    });
  });

  it('rejects missing productName', () => {
    const { productName: _, ...noName } = validConfig;
    expect(() => BrandingConfigSchema.parse(noName)).toThrow();
  });

  it('rejects invalid email', () => {
    expect(() =>
      BrandingConfigSchema.parse({
        ...validConfig,
        supportEmail: 'notanemail',
      }),
    ).toThrow();
  });

  it('rejects invalid OKLCH in brandPrimaryColour', () => {
    expect(() =>
      BrandingConfigSchema.parse({
        ...validConfig,
        brandPrimaryColour: '#ff0000',
      }),
    ).toThrow();
  });

  it('rejects clientId with uppercase', () => {
    expect(() =>
      BrandingConfigSchema.parse({ ...validConfig, clientId: 'Test' }),
    ).toThrow();
  });

  it('accepts optional fields when provided', () => {
    const result = BrandingConfigSchema.parse({
      ...validConfig,
      homepageUrl: 'https://example.com',
      homepageUrlDisplay: 'example.com',
      brandPrimaryColourDark: 'oklch(0.7 0.1 200)',
      brandPrimaryForeground: 'oklch(0.99 0.003 48)',
      logoMaxWidthPx: 200,
      logoAspectRatio: 2,
    });
    expect(result.homepageUrl).toBe('https://example.com');
    expect(result.logoMaxWidthPx).toBe(200);
    expect(result.logoAspectRatio).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// assertBrandAssetsExist (build-time loader fs guardrail — relocated out of the
// schema so scripts/fetch-client-branding.ts can parse the DB config BEFORE the
// bucket assets are downloaded to disk).
// ---------------------------------------------------------------------------

describe('assertBrandAssetsExist', () => {
  // brandAssetExists() short-circuits to `true` when `window` is defined (the
  // browser bundle skips the fs check). The default test env is jsdom, so stub
  // `window` away to exercise the real node fs path this guardrail runs under at
  // build time.
  beforeEach(() => {
    vi.stubGlobal('window', undefined);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const validConfig = {
    clientId: 'test',
    productName: 'Test Product',
    productShortName: 'Test',
    organisationName: 'Test Org',
    tagline: 'A test tagline',
    supportEmail: 'test@example.com',
    brandPrimaryColour: 'oklch(0.5 0.1 200)',
    logoUrl: '/favicon.svg',
    logoAlt: 'Test logo',
    faviconSvgUrl: '/favicon.svg',
    faviconPngUrl: '/favicon.png',
  };

  it('passes when every asset path resolves to a file under public/', () => {
    expect(() =>
      assertBrandAssetsExist(BrandingConfigSchema.parse(validConfig)),
    ).not.toThrow();
  });

  it('throws naming the offending field when an asset path is missing', () => {
    const parsed = BrandingConfigSchema.parse({
      ...validConfig,
      faviconPngUrl: '/clients/does-not-exist/missing.png',
    });
    expect(() => assertBrandAssetsExist(parsed)).toThrow(/faviconPngUrl/);
  });
});
