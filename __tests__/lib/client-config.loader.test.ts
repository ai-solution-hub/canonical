import { describe, it, expect, vi } from 'vitest';
import {
  loadBranding,
  BRANDING,
  BRANDING_PRIMARY_FOREGROUND,
  BRANDING_PRIMARY_DARK,
  BRANDING_PRIMARY_FOREGROUND_DARK,
} from '@/lib/client-config';

describe('loadBranding', () => {
  it('resolves default branding with no argument', () => {
    // __tests__/setup.ts sets NEXT_PUBLIC_CLIENT_ID='default' as a
    // deterministic test default; the silent ?? 'default' fallback was
    // removed in WP6 (lib/env.ts) because it caused the S196 incident.
    const branding = loadBranding();
    expect(branding.clientId).toBe('default');
    expect(branding.productName).toBe('Knowledge Hub');
  });

  it('falls back to default for nonexistent client id', () => {
    const branding = loadBranding('nonexistent');
    expect(branding.clientId).toBe('default');
  });

  it('resolves default branding when called with "default"', () => {
    const branding = loadBranding('default');
    expect(branding.clientId).toBe('default');
    expect(branding.productName).toBe('Knowledge Hub');
  });

  it('emits console.warn for KH default primary (below 3:1)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    loadBranding('default');
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[branding]'),
    );
    warnSpy.mockRestore();
  });

  it('resolves example-client branding when called with "example-client"', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const branding = loadBranding('example-client');
    expect(branding.clientId).toBe('example-client');
    expect(branding.productName).toBe('example-client Design - Knowledge Hub');
    expect(branding.faviconSvgUrl).toBe('/clients/example-client/favicon.svg');
    expect(branding.faviconPngUrl).toBe('/clients/example-client/favicon.png');
    warnSpy.mockRestore();
  });
});

describe('module-level BRANDING constants', () => {
  it('BRANDING is non-null after module init', () => {
    expect(BRANDING).toBeDefined();
    expect(BRANDING.clientId).toBe('default');
  });

  it('BRANDING_PRIMARY_FOREGROUND is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_FOREGROUND).toMatch(/^oklch\(/);
  });

  it('BRANDING_PRIMARY_DARK is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_DARK).toMatch(/^oklch\(/);
  });

  it('BRANDING_PRIMARY_FOREGROUND_DARK is a valid OKLCH string', () => {
    expect(BRANDING_PRIMARY_FOREGROUND_DARK).toMatch(/^oklch\(/);
  });
});
